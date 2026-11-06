import { createHash } from "node:crypto";
import { publicDemoDeployment } from "../../shared/access-policy";
import type { NodeRedTarget } from "../../shared/node-red";

export class NodeRedError extends Error {
  constructor(
    message: string,
    readonly rejected = false,
  ) {
    super(message);
  }
}
export type NodeRedConfiguration = {
  target: NodeRedTarget;
  adminUrl: string;
  token: string;
};
export const MANAGEMENT_PERMISSIONS = [
  "nodes.read",
  "nodes.write",
  "plugins.read",
  "settings.read",
];
export const REQUEST_TIMEOUT_MS = 8_000;
export const INSTALL_TIMEOUT_MS = 120_000;
export const REVIEW_LIFETIME_MS = 10 * 60_000;

export function nodeRedConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): NodeRedConfiguration | null {
  if (env.NODE_RED_MANAGEMENT_ENABLED !== "true") return null;
  if (publicDemoDeployment(env))
    throw new NodeRedError(
      "Node-RED package management requires a private installation with shared demonstration accounts disabled.",
    );
  if (env.NODE_RED_INTEGRATION_ENABLED !== "true")
    throw new NodeRedError(
      "The Node-RED integration must be commissioned before package management is enabled.",
    );
  let url: URL;
  try {
    url = new URL(env.NODE_RED_ADMIN_URL ?? "");
  } catch {
    throw new NodeRedError(
      "The private Node-RED management route is not configured.",
    );
  }
  // Literal loopback avoids DNS rebinding and keeps the Pi editor off the network.
  // A supervised SSH forward must share this API process's network namespace.
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/admin", "/admin/"].includes(url.pathname)
  )
    throw new NodeRedError(
      "Use the approved loopback SSH forward ending in /admin for Node-RED management.",
    );
  const id = env.NODE_RED_RUNTIME_ID ?? "";
  const token = env.NODE_RED_ADMIN_TOKEN ?? "";
  const version = env.NODE_RED_RUNTIME_VERSION ?? "";
  const label = env.NODE_RED_RUNTIME_LABEL ?? "Factory OT gateway";
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    ) ||
    !/^[a-f0-9]{64}$/i.test(token) ||
    !/^4\.1\.(0|[1-9]\d*)$/.test(version) ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(label)
  )
    throw new NodeRedError(
      "Configure the enrolled runtime ID, dedicated management token, exact Node-RED 4.1.x version and runtime label.",
    );
  const adminUrl = url.origin + "/admin";
  const revision = createHash("sha256")
    .update(JSON.stringify([adminUrl, id, version, label, token]))
    .digest("hex");
  return { adminUrl, token, target: { id, label, version, revision } };
}
export function safeNodeRedError(error: unknown): string {
  return error instanceof NodeRedError
    ? error.message
    : "Node-RED management is unavailable. Check the private route and service logs.";
}
