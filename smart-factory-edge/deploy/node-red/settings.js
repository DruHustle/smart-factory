"use strict";

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

const adminUser = required("NODE_RED_ADMIN_USER");
const adminPasswordHash = required("NODE_RED_ADMIN_PASSWORD_HASH");
if (!/^\$2[aby]\$\d{2}\$/.test(adminPasswordHash))
  throw new Error("NODE_RED_ADMIN_PASSWORD_HASH must be a bcrypt hash");

module.exports = {
  uiPort: 1880,
  credentialSecret: required("NODE_RED_CREDENTIAL_SECRET"),
  flowFile: "flows.json",
  adminAuth: {
    type: "credentials",
    users: [
      {
        username: adminUser,
        password: adminPasswordHash,
        permissions: "*",
      },
    ],
  },
  httpNodeAuth: {
    user: adminUser,
    pass: adminPasswordHash,
  },
  httpAdminRoot: "/admin",
  httpNodeRoot: "/automation",
  diagnostics: { enabled: true, ui: false },
  runtimeState: { enabled: false, ui: false },
  logging: {
    console: {
      level: process.env.NODE_RED_LOG_LEVEL || "info",
      metrics: false,
      audit: true,
    },
  },
  editorTheme: {
    projects: { enabled: false },
    tours: false,
  },
  functionGlobalContext: {},
};
