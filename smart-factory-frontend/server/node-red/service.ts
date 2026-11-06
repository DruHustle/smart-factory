import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  installRequest,
  packageSelection,
  pendingInstall,
  type InstallOperation,
  type NodeRedStatus,
  type PackageReview,
} from "../../shared/node-red";
import { nativeEvent } from "../security/runtime";
import { NodeRedClient } from "./client";
import {
  INSTALL_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  REVIEW_LIFETIME_MS,
  NodeRedError,
  nodeRedConfiguration,
  safeNodeRedError,
  type NodeRedConfiguration,
} from "./configuration";
import { postgresInstallStore, type InstallStore } from "./store";

const reviewPayload = packageSelection
  .extend({
    actorId: z.number().int().positive(),
    runtimeId: z.string().uuid(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    expires: z.number().int(),
  })
  .strict();
type ReviewPayload = z.infer<typeof reviewPayload>;
const stamp = () => new Date().toISOString();
const matches = (
  item: Awaited<ReturnType<NodeRedClient["installed"]>>,
  version: string,
) =>
  !!item && item.version === version && !item.pendingVersion && !item.loadError;
function sign(body: string, config: NodeRedConfiguration) {
  return createHmac("sha256", config.token).update(body).digest("base64url");
}
function encodeReview(payload: ReviewPayload, config: NodeRedConfiguration) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + sign(body, config);
}
function decodeReview(
  token: string,
  actorId: number,
  config: NodeRedConfiguration,
) {
  const parts = token.split(".");
  const [body, signature] = parts;
  const expected = Buffer.from(sign(body ?? "", config));
  const received = Buffer.from(signature ?? "");
  if (
    parts.length !== 2 ||
    received.byteLength !== expected.byteLength ||
    !timingSafeEqual(received, expected)
  )
    throw new NodeRedError(
      "The package review is invalid or the runtime configuration changed. Review the package again.",
      true,
    );
  let parsed: ReturnType<typeof reviewPayload.safeParse>;
  try {
    parsed = reviewPayload.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    throw new NodeRedError(
      "The package review is invalid. Review the package again.",
      true,
    );
  }
  if (
    !parsed.success ||
    parsed.data.actorId !== actorId ||
    parsed.data.runtimeId !== config.target.id ||
    parsed.data.revision !== config.target.revision ||
    parsed.data.expires <= Date.now() ||
    parsed.data.expires > Date.now() + REVIEW_LIFETIME_MS
  )
    throw new NodeRedError(
      "The package review expired or no longer matches this administrator and runtime. Review the package again.",
      true,
    );
  return parsed.data;
}

export class NodeRedPackageService {
  constructor(
    private readonly store: InstallStore = postgresInstallStore,
    private readonly configuration = nodeRedConfiguration,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private config() {
    const config = this.configuration();
    if (!config)
      throw new NodeRedError(
        "Node-RED package management is not enabled for this installation.",
      );
    return config;
  }
  private client(config: NodeRedConfiguration) {
    return new NodeRedClient(config, this.fetcher);
  }

  async status(actorId: number): Promise<NodeRedStatus> {
    let target: NodeRedStatus["target"] = null;
    let operation: InstallOperation | null = null;
    try {
      const config = this.configuration();
      if (!config)
        return {
          state: "disabled",
          message:
            "Package management is not configured. An administrator must enroll the private gateway route and dedicated credential.",
          target: null,
          packages: [],
          operation: null,
        };
      await this.store.authorize(actorId);
      target = config.target;
      operation = await this.store.current(target.id);
      const client = this.client(config);
      await client.checkRuntime();
      return {
        state: "ready",
        message: "Connected to the enrolled Node-RED runtime.",
        target,
        packages: await client.packages(),
        operation,
      };
    } catch (error) {
      return {
        state: "unavailable",
        message: safeNodeRedError(error),
        target,
        packages: [],
        operation,
      };
    }
  }

  async review(
    actorId: number,
    selection: z.infer<typeof packageSelection>,
  ): Promise<PackageReview> {
    const input = packageSelection.parse(selection);
    const config = this.config();
    await this.store.authorize(actorId);
    if (pendingInstall(await this.store.current(config.target.id)))
      throw new NodeRedError(
        "Check the pending installation's outcome before reviewing another package.",
        true,
      );
    const client = this.client(config);
    await client.checkRuntime();
    if (await client.installed(input))
      throw new NodeRedError(
        "This package is already present. Updates and reinstalls require a separate gateway maintenance review.",
        true,
      );
    const metadata = await client.packageMetadata(input);
    const expires = Date.now() + REVIEW_LIFETIME_MS;
    return {
      ...input,
      ...metadata,
      target: config.target,
      expiresAt: new Date(expires).toISOString(),
      reviewToken: encodeReview(
        {
          ...input,
          actorId,
          runtimeId: config.target.id,
          revision: config.target.revision,
          expires,
        },
        config,
      ),
    };
  }

  async install(actorId: number, request: z.infer<typeof installRequest>) {
    const input = installRequest.parse(request);
    const config = this.config();
    const reviewed = decodeReview(input.reviewToken, actorId, config);
    const operation: InstallOperation = {
      id: input.requestId,
      runtimeId: config.target.id,
      targetRevision: config.target.revision,
      actorId,
      module: reviewed.module,
      version: reviewed.version,
      state: "installing",
      message:
        "Installation reserved. The gateway will verify the request before running the package installer.",
      startedAt: stamp(),
      updatedAt: stamp(),
    };
    const claimed = await this.store.claim(operation);
    if (claimed.accepted) {
      // The durable reservation is committed before any mutating remote request.
      // A process restart never replays it. Status can be read by every replica.
      void this.run(operation, config).catch(() => {
        // If persistence itself fails, leave the saved pending reservation in
        // place. It must be reconciled; never release or retry it optimistically.
      });
    }
    return claimed.operation;
  }

  private async run(operation: InstallOperation, config: NodeRedConfiguration) {
    const client = this.client(config);
    const selection = { module: operation.module, version: operation.version };
    let transmitted = false;
    let postCompleted = false;
    let outcome: InstallOperation;
    try {
      await client.checkRuntime();
      const installed = await client.installed(selection);
      if (installed) {
        if (!matches(installed, operation.version))
          throw new NodeRedError(
            "The package is already present with another version or needs runtime attention. No update was requested.",
            true,
          );
        outcome = {
          ...operation,
          state: "installed",
          message:
            "The exact package version was already present with no reported load errors. No installation request was sent.",
          updatedAt: stamp(),
        };
      } else {
        if (this.config().target.revision !== operation.targetRevision)
          throw new NodeRedError(
            "Runtime configuration changed after approval. Review the package again.",
            true,
          );
        await this.store.authorize(operation.actorId);
        const current = await this.store.current(operation.runtimeId);
        if (
          !current ||
          current.id !== operation.id ||
          current.state !== "installing"
        )
          return;
        transmitted = true;
        await client.install(selection);
        postCompleted = true;
        await client.checkRuntime();
        const verified = await client.installed(selection);
        if (!matches(verified, operation.version))
          throw new NodeRedError(
            "Node-RED did not report the exact version without pending changes or load errors. Check the runtime before another installation.",
          );
        outcome = {
          ...operation,
          state: "installed",
          message:
            "The exact package version is present in the enrolled runtime with no reported load errors. Commission its nodes separately before OT use.",
          updatedAt: stamp(),
        };
      }
    } catch (error) {
      outcome = {
        ...operation,
        state:
          transmitted &&
          (postCompleted || !(error instanceof NodeRedError && error.rejected))
            ? "unconfirmed"
            : "failed",
        message: safeNodeRedError(error),
        updatedAt: stamp(),
      };
    }
    await this.store.finish(outcome);
    await nativeEvent(
      "config.changed",
      {
        configRevision: operation.id,
        changedKeys: ["node_red.packages"],
      },
      "A Node-RED package installation outcome was recorded. Review the saved operation for its result.",
    );
  }

  async reconcile(actorId: number) {
    const config = this.config();
    await this.store.authorize(actorId);
    const operation = await this.store.current(config.target.id);
    if (!operation || !pendingInstall(operation)) return operation;
    if (operation.targetRevision !== config.target.revision)
      throw new NodeRedError(
        "The runtime configuration changed since this request. Restore or review the original enrollment before reconciling it.",
        true,
      );
    if (
      operation.state === "installing" &&
      Date.now() - Date.parse(operation.startedAt) <
        INSTALL_TIMEOUT_MS + 4 * REQUEST_TIMEOUT_MS
    )
      throw new NodeRedError(
        "The installation request is still within its response window. Wait for the saved result before checking for recovery.",
        true,
      );
    const client = this.client(config);
    await client.checkRuntime();
    const installed = await client.installed({
      module: operation.module,
      version: operation.version,
    });
    return this.store.finish({
      ...operation,
      state: matches(installed, operation.version)
        ? "installed"
        : "unconfirmed",
      message: matches(installed, operation.version)
        ? "Read-back confirmed the exact package version is currently present with no reported load errors. This verifies package inventory, not commissioning or active flow behavior."
        : "The exact version is not confirmed without pending changes or load errors. The installer may still be running or may have changed runtime files. New installations remain blocked until the gateway is reviewed.",
      updatedAt: stamp(),
    });
  }
}
export const nodeRedPackages = new NodeRedPackageService();
