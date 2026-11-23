import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;
const sessionId = "9a60ca04-d1ba-4487-b629-771a8bcbb032";
const factoryOrigin = "https://factory.onesa.eu";
const client = "fixture-factory-web-client";
const jwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "oauth",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function configureManagedFactory() {
  const settings = {
    ONESA_IDENTITY_ENABLED: "true",
    ONESA_IDENTITY_BROWSER_LOGOUT_ENABLED: "true",
    ONESA_IDENTITY_ISSUER: "https://auth.onesa.eu/",
    ONESA_IDENTITY_CLIENT_ID: client,
    ONESA_IDENTITY_CLIENT_SECRET: "s".repeat(48),
    ONESA_IDENTITY_REDIRECT_URI: factoryOrigin + "/api/auth/onesa/callback",
    ONESA_IDENTITY_AUDIENCE: "https://api.factory.onesa.eu",
    ONESA_IDENTITY_MAPPING_ISSUER: "https://portal.onesa.eu/api/v1/identity",
    ONESA_IDENTITY_ACCOUNT_ORIGIN: "https://account.onesa.eu",
    ONESA_IDENTITY_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...jwk, kid: "fixture-factory-key" }] }),
    JWT_SECRET: "k".repeat(32),
    ALLOWED_ORIGIN: factoryOrigin,
  };
  for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
}

function createManagedBrowserContext() {
  const fixture = createAuthContext();
  fixture.ctx.req.headers.origin = factoryOrigin;
  fixture.ctx.req.headers.cookie = `${COOKIE_NAME}=synthetic-session`;
  fixture.ctx.session = {
    openId: "sample-user",
    appId: "factory",
    name: "Sample User",
    sessionId,
    onesa: true,
  };
  return fixture;
}

describe("auth.logout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
  it("clears local credentials but does not claim persisted revocation when storage fails", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    vi.spyOn(sdk, "revokeRequestSession").mockRejectedValue(new Error("Revocation storage unavailable"));
    await expect(appRouter.createCaller(ctx).auth.logout()).rejects.toThrow("Revocation storage unavailable");
    expect(clearedCookies).toHaveLength(1);
  });

  it("offers the pinned Auth0 logout after local revocation and cookie clearing", async () => {
    configureManagedFactory();
    const { ctx, clearedCookies } = createManagedBrowserContext();
    const revoke = vi.spyOn(sdk, "revokeRequestSession").mockImplementation(async () => {
      expect(clearedCookies).toHaveLength(0);
      return sessionId;
    });
    const result = await appRouter.createCaller(ctx).auth.logout();
    const destination = new URL("https://auth.onesa.eu/oidc/logout");
    destination.searchParams.set("client_id", client);
    destination.searchParams.set("post_logout_redirect_uri", factoryOrigin + "/");
    expect(result).toEqual({ success: true, browserLogoutUrl: destination.href });
    expect(revoke).toHaveBeenCalledOnce();
    expect(clearedCookies).toHaveLength(1);
  });

  it("keeps the browser handoff off unless it is explicitly enabled", async () => {
    configureManagedFactory();
    vi.stubEnv("ONESA_IDENTITY_BROWSER_LOGOUT_ENABLED", "false");
    vi.spyOn(sdk, "revokeRequestSession").mockResolvedValue(sessionId);
    const { ctx } = createManagedBrowserContext();
    await expect(appRouter.createCaller(ctx).auth.logout()).resolves.toEqual({ success: true });
  });

  it.each(["foreign origin", "native bearer", "unrevoked session"])(
    "clears the local cookie without an Auth0 handoff for %s",
    async (scenario) => {
      configureManagedFactory();
      const { ctx, clearedCookies } = createManagedBrowserContext();
      if (scenario === "foreign origin") ctx.req.headers.origin = "https://preview.example.test";
      if (scenario === "native bearer") ctx.req.headers.authorization = "Bearer native-fixture";
      vi.spyOn(sdk, "revokeRequestSession").mockResolvedValue(
        scenario === "unrevoked session" ? null : sessionId,
      );
      await expect(appRouter.createCaller(ctx).auth.logout()).resolves.toEqual({ success: true });
      expect(clearedCookies).toHaveLength(1);
    },
  );
});
