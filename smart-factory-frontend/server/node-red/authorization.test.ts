import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../drizzle/schema";
import { dataWorkspaceCookie } from "../../shared/data-workspace";
import { createContext, type TrpcContext } from "../_core/context";
import { sdk } from "../_core/sdk";
import * as db from "../db";
import * as accounts from "../accountAccess";
import { appRouter } from "../routers";
import { nodeRedPackages } from "./service";

const individual = (role: User["role"]): User => ({
  id: 7,
  openId: "individual-node-red-fixture",
  name: "Synthetic administrator",
  email: "fixture@example.test",
  role,
  loginMethod: "password",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
  authVersion: 0,
  disabledAt: null,
  passwordChangeRequired: false,
});
function context(user: User | null, workspace = "live"): TrpcContext {
  return {
    user,
    req: {
      protocol: "http",
      headers: { cookie: `${dataWorkspaceCookie}=${workspace}` },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
beforeEach(() => {
  vi.stubEnv("SECURITY_ENABLED", "false");
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
  vi.spyOn(nodeRedPackages, "status").mockResolvedValue({
    state: "disabled",
    message: "Synthetic",
    target: null,
    packages: [],
    operation: null,
  });
  vi.spyOn(nodeRedPackages, "review").mockRejectedValue(
    Error("Unexpected management call"),
  );
  vi.spyOn(nodeRedPackages, "install").mockRejectedValue(
    Error("Unexpected install call"),
  );
  vi.spyOn(nodeRedPackages, "reconcile").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Node-RED server authorization", () => {
  it.each(["user", "viewer", "operator", "engineer"] as const)(
    "refuses every Node-RED endpoint for %s before service I/O",
    async (role) => {
      const caller = appRouter.createCaller(context(individual(role))).nodeRed;
      await expect(caller.status()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.review({ module: "node-red-contrib-fixture", version: "1.2.3" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.install({
          reviewToken: "not-approved",
          requestId: crypto.randomUUID(),
          acknowledgeCodeExecution: true,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.reconcile()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(nodeRedPackages.status).not.toHaveBeenCalled();
      expect(nodeRedPackages.install).not.toHaveBeenCalled();
    },
  );
  it("refuses unauthenticated, shared-demo, disabled, password-change and demo-workspace requests", async () => {
    const fixtures = [
      context(null),
      context({ ...individual("admin"), openId: "demo-admin" }),
      context({ ...individual("admin"), disabledAt: new Date() }),
      context({ ...individual("admin"), passwordChangeRequired: true }),
      context(individual("admin"), "demo"),
    ];
    for (const fixture of fixtures) {
      const caller = appRouter.createCaller(fixture).nodeRed;
      await expect(caller.status()).rejects.toThrow();
      await expect(
        caller.install({
          reviewToken: "not-approved",
          requestId: crypto.randomUUID(),
          acknowledgeCodeExecution: true,
        }),
      ).rejects.toThrow();
    }
    expect(nodeRedPackages.status).not.toHaveBeenCalled();
    expect(nodeRedPackages.install).not.toHaveBeenCalled();
  });
  it("takes the administrative role from the verified user's current database row, not a signed stale role claim", async () => {
    const admin = individual("admin");
    const token = await sdk.createSessionToken(admin);
    const loadUser = vi
      .spyOn(db, "getUserByOpenId")
      .mockResolvedValue(individual("engineer"));
    vi.spyOn(accounts, "sessionRevoked").mockResolvedValue(false);
    const request = {
      headers: {
        authorization: "Bearer " + token,
        cookie: `${dataWorkspaceCookie}=live`,
        "x-role": "admin",
      },
    } as TrpcContext["req"];
    const resolved = await createContext({
      req: request,
      res: {} as TrpcContext["res"],
    } as Parameters<typeof createContext>[0]);
    expect(resolved.session?.role).toBe("admin");
    expect(resolved.user?.role).toBe("engineer");
    await expect(
      appRouter.createCaller(resolved).nodeRed.status(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(nodeRedPackages.status).not.toHaveBeenCalled();
    loadUser.mockResolvedValue(admin);
    const active = await createContext({
      req: request,
      res: {} as TrpcContext["res"],
    } as Parameters<typeof createContext>[0]);
    await expect(
      appRouter.createCaller(active).nodeRed.status(),
    ).resolves.toMatchObject({ state: "disabled" });
    expect(nodeRedPackages.status).toHaveBeenCalledWith(admin.id);
  });
  it("does not derive identity or role from an unsigned bearer token", async () => {
    const request = {
      headers: { authorization: "Bearer fake-admin", "x-role": "admin" },
    } as TrpcContext["req"];
    const resolved = await createContext({
      req: request,
      res: {} as TrpcContext["res"],
    } as Parameters<typeof createContext>[0]);
    expect(resolved.user).toBeNull();
    await expect(
      appRouter.createCaller(resolved).nodeRed.status(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(nodeRedPackages.status).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied destinations and shell fields even for administrators", async () => {
    const caller = appRouter.createCaller(context(individual("admin"))).nodeRed;
    await expect(
      caller.review({
        module: "node-red-contrib-fixture",
        version: "1.2.3",
        host: "https://example.test",
        command: "npm install",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(nodeRedPackages.review).not.toHaveBeenCalled();
  });
});
