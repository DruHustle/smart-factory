import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { MANAGEMENT_PERMISSIONS } from "./configuration";

const source = readFileSync(
  new URL(
    "../../../smart-factory-edge/deploy/node-red/settings.js",
    import.meta.url,
  ),
  "utf8",
);
const runtimeId = "8d70df1b-5722-4e7f-8dfc-e90cfa875a77";
const token = "b".repeat(64);
function settings(management: Record<string, string> = {}) {
  const module = { exports: {} as any };
  runInNewContext(source, {
    module,
    require: createRequire(import.meta.url),
    Buffer,
    process: {
      env: {
        NODE_RED_ADMIN_USER: "synthetic-editor-admin",
        NODE_RED_ADMIN_PASSWORD_HASH: "$2b$12$synthetic-hash",
        NODE_RED_CREDENTIAL_SECRET: "synthetic-flow-credential-secret",
        ...management,
      },
    },
  });
  return module.exports;
}
describe("optional Node-RED gateway management policy", () => {
  it("preserves the existing loopback editor login when management is not enrolled", () => {
    const policy = settings();
    expect(policy.uiHost).toBe("127.0.0.1");
    expect(policy.httpAdminRoot).toBe("/admin");
    expect(policy.httpNodeRoot).toBe(false);
    expect(policy.adminAuth.users[0].permissions).toBe("*");
    expect(policy.adminAuth.tokens).toBeUndefined();
    expect(policy.externalModules).toBeUndefined();
  });
  it("grants the dedicated token only package permissions and identifies the enrolled runtime", async () => {
    const policy = settings({
      NODE_RED_RUNTIME_ID: runtimeId,
      NODE_RED_ADMIN_TOKEN: token,
    });
    expect(await policy.adminAuth.tokens(token)).toEqual({
      username: "smart-factory-package-manager",
      permissions: MANAGEMENT_PERMISSIONS,
    });
    for (const invalid of ["c".repeat(64), "short", "é".repeat(64), null])
      expect(await policy.adminAuth.tokens(invalid)).toBeNull();
    expect(policy.externalModules.palette).toEqual({
      allowInstall: true,
      allowUpdate: false,
      allowUpload: false,
    });
    const set = vi.fn(),
      next = vi.fn();
    policy.httpAdminMiddleware({}, { set }, next);
    expect(set).toHaveBeenCalledWith(
      "X-Smart-Factory-Node-RED-Runtime",
      runtimeId,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(policy.uiHost).toBe("127.0.0.1");
    expect(policy.httpNodeRoot).toBe(false);
  });
  it("refuses incomplete or weak enrollment at startup", () => {
    expect(() => settings({ NODE_RED_ADMIN_TOKEN: token })).toThrow(/UUID/);
    expect(() =>
      settings({
        NODE_RED_RUNTIME_ID: runtimeId,
        NODE_RED_ADMIN_TOKEN: "weak-token",
      }),
    ).toThrow(/token/);
  });
});
