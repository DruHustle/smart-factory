"use strict";
const { timingSafeEqual } = require("node:crypto");
const requireEnv = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(name + " is required");
  return value.trim();
};
const adminUser = requireEnv("NODE_RED_ADMIN_USER");
const adminPasswordHash = requireEnv("NODE_RED_ADMIN_PASSWORD_HASH");
if (!/^\$2[aby]\$\d{2}\$/.test(adminPasswordHash))
  throw new Error("NODE_RED_ADMIN_PASSWORD_HASH must be a bcrypt hash");
const managementToken = process.env.NODE_RED_ADMIN_TOKEN || "";
const runtimeId = process.env.NODE_RED_RUNTIME_ID || "";
if (managementToken || runtimeId) {
  if (
    !/^[a-f0-9]{64}$/i.test(managementToken) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      runtimeId,
    )
  )
    throw new Error(
      "Package management requires an enrolled runtime UUID and a dedicated 64-character hexadecimal token",
    );
}
const managementPermissions = [
  "nodes.read",
  "nodes.write",
  "plugins.read",
  "settings.read",
];

module.exports = {
  uiPort: 1880,
  uiHost: "127.0.0.1",
  flowFile: "flows.json",
  credentialSecret: requireEnv("NODE_RED_CREDENTIAL_SECRET"),
  adminAuth: {
    type: "credentials",
    users: [
      {
        username: adminUser,
        password: adminPasswordHash,
        permissions: "*",
      },
    ],
    // Optional service token grants no flow, credential, library or runtime-write
    // permission. Keep the existing separately authenticated editor administrator.
    ...(managementToken
      ? {
          tokens: async (token) => {
            if (
              typeof token !== "string" ||
              !/^[a-f0-9]{64}$/i.test(token) ||
              !timingSafeEqual(Buffer.from(token), Buffer.from(managementToken))
            )
              return null;
            return {
              username: "smart-factory-package-manager",
              permissions: managementPermissions,
            };
          },
        }
      : {}),
  },
  httpAdminRoot: "/admin",
  ...(managementToken
    ? {
        httpAdminMiddleware: (_req, res, next) => {
          res.set("X-Smart-Factory-Node-RED-Runtime", runtimeId);
          next();
        },
        // The installer enforces this policy too, including an external-editor race
        // between the Factory preflight and its POST /nodes.
        externalModules: {
          palette: {
            allowInstall: true,
            allowUpdate: false,
            allowUpload: false,
          },
        },
      }
    : {}),
  // Node-RED cannot publish a public HTTP endpoint through this deployment.
  // Only explicitly commissioned MQTT output reaches the Python agent.
  httpNodeRoot: false,
  diagnostics: { enabled: true, ui: false },
  runtimeState: { enabled: false, ui: false },
  logging: {
    console: { level: "info", metrics: false, audit: true },
  },
  editorTheme: { projects: { enabled: false }, tours: false },
  functionGlobalContext: {},
};
