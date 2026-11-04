"use strict";
const requireEnv = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(name + " is required");
  return value.trim();
};
const adminUser = requireEnv("NODE_RED_ADMIN_USER");
const adminPasswordHash = requireEnv("NODE_RED_ADMIN_PASSWORD_HASH");
if (!/^\$2[aby]\$\d{2}\$/.test(adminPasswordHash))
  throw new Error("NODE_RED_ADMIN_PASSWORD_HASH must be a bcrypt hash");

module.exports = {
  uiPort: 1880,
  uiHost: "127.0.0.1",
  flowFile: "flows.json",
  credentialSecret: requireEnv("NODE_RED_CREDENTIAL_SECRET"),
  adminAuth: {
    type: "credentials",
    users: [{
      username: adminUser,
      password: adminPasswordHash,
      permissions: "*"
    }]
  },
  httpAdminRoot: "/admin",
  // Node-RED cannot publish a public HTTP endpoint through this deployment.
  // Only explicitly commissioned MQTT output reaches the Python agent.
  httpNodeRoot: false,
  diagnostics: { enabled: true, ui: false },
  runtimeState: { enabled: false, ui: false },
  logging: {
    console: { level: "info", metrics: false, audit: true }
  },
  editorTheme: { projects: { enabled: false }, tours: false },
  functionGlobalContext: {}
};
