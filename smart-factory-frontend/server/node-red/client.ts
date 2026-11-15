import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  exactPackageVersion,
  packageSelection,
  type NodeRedPackage,
} from "../../shared/node-red";
import {
  INSTALL_TIMEOUT_MS,
  MANAGEMENT_PERMISSIONS,
  NodeRedError,
  REQUEST_TIMEOUT_MS,
  type NodeRedConfiguration,
} from "./configuration";

const LIMIT = 1_048_576;
const TARBALL_LIMIT = 25 * 1024 * 1024;
const settingSchema = z.object({
  version: exactPackageVersion,
  user: z.object({
    permissions: z.array(z.string()).max(16),
    anonymous: z.boolean().optional(),
  }),
  externalModules: z.object({
    palette: z.object({
      allowInstall: z.boolean(),
      allowUpdate: z.boolean(),
      allowUpload: z.boolean(),
    }),
  }),
});
const setSchema = z.object({
  module: z.string().min(1).max(214),
  version: z.string().min(1).max(96),
  err: z.unknown().optional(),
  pending_version: z.string().max(96).optional(),
});
const setList = z.array(setSchema).max(10_000);
const moduleSchema = z.object({
  name: z.string(),
  version: exactPackageVersion,
  nodes: setList,
  plugins: setList.optional().default([]),
  pending_version: z.string().max(96).optional(),
});

/** Never return an upstream response body or exception to the browser/logs. */
async function boundedJson(response: Response): Promise<unknown> {
  const size = Number(response.headers.get("content-length"));
  if (
    (size && size > LIMIT) ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    await response.body?.cancel();
    throw new NodeRedError(
      "The management service returned an unsupported response.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new NodeRedError(
      "The management service returned an empty response.",
    );
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > LIMIT)
        throw new NodeRedError(
          "The management response exceeded its size limit.",
        );
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof NodeRedError) throw error;
    throw new NodeRedError(
      "The management service returned an unreadable response.",
    );
  } finally {
    reader.releaseLock();
  }
}

export class NodeRedClient {
  constructor(
    readonly config: NodeRedConfiguration,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    path: string,
    mutation?: { body: BodyInit },
  ) {
    const installing = mutation !== undefined;
    const signal = AbortSignal.timeout(
      installing ? INSTALL_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await this.fetcher(this.config.adminUrl + path, {
        method: installing ? "POST" : "GET",
        redirect: "error",
        signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.token}`,
        },
        ...(mutation ? { body: mutation.body } : {}),
      });
    } catch {
      throw new NodeRedError(
        installing
          ? "The installation response was lost or timed out. Its outcome is unconfirmed; check the saved operation before any further installation."
          : "The private Node-RED route is unreachable or timed out. Check the supervised SSH forward.",
      );
    }
    if (
      response.headers.get("x-smart-factory-node-red-runtime") !==
      this.config.target.id
    ) {
      await response.body?.cancel();
      throw new NodeRedError(
        "The route did not identify the enrolled Node-RED runtime. Installation is unavailable.",
      );
    }
    if (!response.ok) {
      // 401/403 are authoritative pre-handler refusals. Other install failures
      // can follow npm side effects; retain an unconfirmed operation for review.
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new NodeRedError(
          "Node-RED refused the dedicated package-management credential. Review its permissions and rotation.",
          true,
        );
      throw new NodeRedError(
        "Node-RED did not confirm the request. Review the runtime logs and saved installation status.",
      );
    }
    return boundedJson(response);
  }

  async checkRuntime() {
    const result = settingSchema.safeParse(await this.request("/settings"));
    if (!result.success)
      throw new NodeRedError(
        "Node-RED has not been configured with the reviewed package-management policy.",
      );
    const settings = result.data;
    if (settings.version !== this.config.target.version)
      throw new NodeRedError(
        "The running Node-RED version differs from the enrolled version. Review the gateway release before installing packages.",
      );
    const permissions = settings.user.permissions;
    if (
      settings.user.anonymous ||
      permissions.length !== MANAGEMENT_PERMISSIONS.length ||
      !MANAGEMENT_PERMISSIONS.every((permission) =>
        permissions.includes(permission),
      )
    )
      throw new NodeRedError(
        "Use a dedicated Node-RED token with only the reviewed package-management permissions.",
      );
    const palette = settings.externalModules.palette;
    if (!palette.allowInstall || palette.allowUpdate || palette.allowUpload)
      throw new NodeRedError(
        "Node-RED must allow package additions and refuse package updates and archive uploads through this management route.",
      );
  }

  async packages(): Promise<NodeRedPackage[]> {
    const responses = await Promise.all([
      this.request("/nodes"),
      this.request("/plugins"),
    ]);
    const result = new Map<string, NodeRedPackage>();
    responses.forEach((raw, index) => {
      const parsed = setList.safeParse(raw);
      if (!parsed.success)
        throw new NodeRedError(
          "Node-RED returned an unsupported package inventory.",
        );
      for (const set of parsed.data) {
        const current = result.get(set.module) ?? {
          name: set.module,
          version: set.version,
          nodeSets: 0,
          pluginSets: 0,
          loadError: false,
          pendingVersion: null,
        };
        if (current.version !== set.version)
          throw new NodeRedError(
            "The Node-RED package inventory is inconsistent. Review the runtime before installing packages.",
          );
        if (index === 0) current.nodeSets++;
        else current.pluginSets++;
        current.loadError ||= Boolean(set.err);
        current.pendingVersion = set.pending_version ?? current.pendingVersion;
        result.set(set.module, current);
      }
    });
    return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async installed(selection: { module: string; version: string }) {
    const inventory = await this.packages();
    const match = inventory.find((item) => item.name === selection.module);
    if (!match) return null;
    // The module endpoint also exposes pending versions for plugin-only modules.
    const parsed = moduleSchema.safeParse(
      await this.request("/nodes/" + encodeURIComponent(selection.module)),
    );
    if (!parsed.success || parsed.data.name !== selection.module)
      throw new NodeRedError(
        "Node-RED could not verify the selected package inventory.",
      );
    const module = parsed.data;
    if (module.version !== match.version)
      throw new NodeRedError(
        "The Node-RED inventory changed during verification. Check the saved outcome before another installation.",
      );
    return {
      ...match,
      version: module.version,
      pendingVersion: module.pending_version ?? match.pendingVersion,
      loadError:
        match.loadError ||
        [...module.nodes, ...module.plugins].some((set) => Boolean(set.err)),
    };
  }

  async downloadVerifiedTarball(urlValue: string, integrity: string) {
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new NodeRedError("The reviewed npm tarball URL is invalid.", true);
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "registry.npmjs.org" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
    )
      throw new NodeRedError(
        "Only an immutable SHA-512 tarball from the official npm registry can be installed.",
        true,
      );
    const expected = Buffer.from(integrity.slice("sha512-".length), "base64");
    if (expected.byteLength !== 64)
      throw new NodeRedError("The reviewed npm integrity value is invalid.", true);

    let response: Response;
    try {
      response = await this.fetcher(url.href, {
        headers: { Accept: "application/octet-stream" },
        redirect: "error",
        signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
      });
    } catch {
      throw new NodeRedError(
        "The exact reviewed npm tarball could not be downloaded. No Node-RED installation request was sent.",
        true,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new NodeRedError(
        "The exact reviewed npm tarball is no longer available. No Node-RED installation request was sent.",
        true,
      );
    }
    const size = Number(response.headers.get("content-length"));
    if (Number.isFinite(size) && size > TARBALL_LIMIT) {
      await response.body?.cancel();
      throw new NodeRedError(
        "The reviewed package exceeds the 25 MiB installation limit.",
        true,
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new NodeRedError("The npm registry returned an empty tarball.", true);
    const chunks: Uint8Array[] = [];
    const hash = createHash("sha512");
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > TARBALL_LIMIT)
          throw new NodeRedError(
            "The reviewed package exceeds the 25 MiB installation limit.",
            true,
          );
        hash.update(value);
        chunks.push(value);
      }
      const actual = hash.digest();
      if (!timingSafeEqual(actual, expected))
        throw new NodeRedError(
          "The downloaded package does not match the reviewed SHA-512 integrity. No Node-RED installation request was sent.",
          true,
        );
      return new Blob(chunks, { type: "application/x-compressed-tar" });
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof NodeRedError) throw error;
      throw new NodeRedError(
        "The reviewed npm tarball could not be verified. No Node-RED installation request was sent.",
        true,
      );
    } finally {
      reader.releaseLock();
    }
  }

  async installTarball(
    selection: { module: string; version: string },
    tarball: Blob,
  ) {
    const input = packageSelection.parse(selection);
    const filename = `${input.module.replace(/^@/, "").replaceAll("/", "-")}-${input.version}.tgz`;
    const form = new FormData();
    form.append("tarball", tarball, filename);
    // Node-RED's Admin API supports exact tarball uploads as multipart/form-data.
    // It does not accept version qualifiers in the JSON module-name form.
    return this.request("/nodes", { body: form });
  }

  async packageMetadata(selection: { module: string; version: string }) {
    const input = packageSelection.parse(selection);
    let response: Response;
    try {
      response = await this.fetcher(
        `https://registry.npmjs.org/${encodeURIComponent(input.module)}/${encodeURIComponent(input.version)}`,
        {
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new NodeRedError(
        "The npm registry is unavailable. Package review did not start an installation.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new NodeRedError(
        "That exact package version could not be found in the npm registry.",
      );
    }
    const raw = await boundedJson(response);
    const parsed = z
      .object({
        name: z.literal(input.module),
        version: z.literal(input.version),
        description: z.string().max(4_000).optional(),
        "node-red": z.object({
          nodes: z.record(z.string().max(160), z.string().max(1024)).optional(),
          plugins: z
            .record(z.string().max(160), z.string().max(1024))
            .optional(),
        }),
        dist: z.object({
          tarball: z.string().url().max(2048),
          integrity: z.string().max(256),
        }),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new NodeRedError(
        "Choose a Node-RED node library or plugin package. General Function-node dependencies use a separate reviewed flow change.",
      );
    const nodeSets = Object.keys(parsed.data["node-red"].nodes ?? {});
    const pluginSets = Object.keys(parsed.data["node-red"].plugins ?? {});
    if (
      (!nodeSets.length && !pluginSets.length) ||
      nodeSets.length + pluginSets.length > 256
    )
      throw new NodeRedError(
        "The package does not declare a supported set of Node-RED nodes or plugins.",
      );
    const tarballUrl = new URL(parsed.data.dist.tarball);
    const integrity = parsed.data.dist.integrity
      .split(/\s+/)
      .find((value) => value.startsWith("sha512-"));
    if (
      tarballUrl.protocol !== "https:" ||
      tarballUrl.hostname !== "registry.npmjs.org" ||
      tarballUrl.port ||
      tarballUrl.username ||
      tarballUrl.password ||
      tarballUrl.search ||
      tarballUrl.hash ||
      !integrity ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
    )
      throw new NodeRedError(
        "The npm registry did not provide a supported official SHA-512 package tarball.",
      );
    const clean = (text: string) =>
      text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
    return {
      description: clean(parsed.data.description ?? ""),
      nodeSets: nodeSets.map(clean),
      pluginSets: pluginSets.map(clean),
      tarballUrl: tarballUrl.href,
      integrity,
    };
  }
}
