import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { installPortalIdentity } from "./portalIdentityRoutes";
import {
  livePortalIdentity,
  portalConfig,
  portalDatabase,
  safeReturnPath,
} from "./portalIdentity";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import { changeUserAccess } from "./accountAccess";
import { createUser } from "./db";
import { COOKIE_NAME } from "../shared/const";
import { disposableDatabase } from "./test/disposableDatabase";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { ENV } from "./_core/env";

it("rejects unsafe destinations and incomplete identity configuration", () => {
  expect(safeReturnPath("#/monitoring?asset=17")).toBe("#/monitoring?asset=17");
  for (const path of [
    undefined,
    "https://evil.example",
    "#//evil.example",
    "#/\\evil.example",
    "#/login?token=x",
    "#/register",
    "#/a\nb",
    "#/" + "a".repeat(2048),
  ])
    expect(safeReturnPath(path)).toBe("#/");
  expect(portalConfig({})).toBeNull();
  expect(() => portalConfig({ ONESA_IDENTITY_ENABLED: "true" })).toThrow();
});

it("separates federated tokens from legacy rollback audiences and rejects audience/identity mismatches", async () => {
  const payload = {
    openId: randomUUID(),
    appId: "smart-factory",
    name: "Synthetic audience test",
  };
  const key = new TextEncoder().encode(ENV.cookieSecret);
  const local = await sdk.signSession(payload);
  const federated = await sdk.signSession({ ...payload, onesa: true });
  expect((await sdk.verifySession(local))?.onesa).toBe(false);
  expect((await sdk.verifySession(federated))?.onesa).toBe(true);
  await expect(
    jwtVerify(federated, key, {
      issuer: "smart-factory-iot",
      audience: "smart-factory-iot-api",
    }),
  ).rejects.toThrow();
  for (const claims of [
    { ...decodeJwt(local), oi: true },
    { ...decodeJwt(federated), oi: false },
    {
      ...decodeJwt(federated),
      aud: ["smart-factory-iot-api", "smart-factory-onesa-api"],
    },
  ]) {
    const confused = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(key);
    expect(await sdk.verifySession(confused)).toBeNull();
  }
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Factory Portal identity with real PostgreSQL",
  () => {
    disposableDatabase("factory_portal");
    const issuer = "https://portal.example.test/api/v1/identity",
      origin = "https://factory.example.test";
    let server: Server,
      base = "",
      subject = randomUUID(),
      role = "user",
      active = true,
      mfa = true,
      unavailable = false,
      authAge = 2;
    const actualFetch = globalThis.fetch;
    let duringIntrospection: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      for (const [name, value] of Object.entries({
        ONESA_IDENTITY_ENABLED: "true",
        ONESA_IDENTITY_ISSUER: issuer,
        ONESA_IDENTITY_CLIENT_ID: "factory-test-client",
        ONESA_IDENTITY_CLIENT_SECRET: "s".repeat(64),
        ONESA_IDENTITY_REDIRECT_URI: origin + "/api/auth/onesa/callback",
        ALLOWED_ORIGIN: origin,
        JWT_SECRET: "synthetic-factory-test-secret-2026-xxxx",
      }))
        vi.stubEnv(name, value);
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, options?: RequestInit) => {
          if (String(input) === issuer + "/token")
            return Response.json({
              token_type: "Bearer",
              access_token: "synthetic-central-grant-".repeat(2),
            });
          if (String(input) === issuer + "/session") {
            const hook = duringIntrospection;
            duringIntrospection = undefined;
            if (hook) await hook();
            if (unavailable) return new Response(null, { status: 503 });
            const now = Math.floor(Date.now() / 1000);
            return Response.json({
              active,
              iss: issuer,
              aud: "factory-test-client",
              sub: subject,
              email: subject + "@example.test",
              email_verified: true,
              name: "Synthetic Factory member",
              exp: now + 600,
              auth_time: now - authAge,
              amr: role === "admin" && mfa ? ["pwd", "otp"] : ["pwd"],
              onesa_roles: role === "admin" ? ["global_admin"] : [],
              onesa_applications: ["factory"],
              onesa_product_roles: { factory: role },
            });
          }
          return actualFetch(input, options);
        },
      );
      const app = express();
      app.use(express.json());
      installPortalIdentity(app);
      server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw Error("Missing listener");
      base = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
      vi.unstubAllGlobals();
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    function request(
      path: string,
      cookie = "",
      body?: unknown,
      requestOrigin = origin,
    ) {
      return fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "manual",
        headers: {
          Origin: requestOrigin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    const authenticate = (cookie: string) =>
      sdk.authenticateRequestWithSession({
        headers: { cookie },
      } as express.Request);
    async function signIn(link?: { email: string; password: string }) {
      const start = await request("/api/auth/onesa/start", "", {
        returnTo: "#/monitoring?asset=17",
        ...(link ? { link } : {}),
      });
      expect(start.status).toBe(200);
      const state = new URL((await start.json()).url).searchParams.get(
        "state",
      )!;
      const browser = start.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const path =
        "/api/auth/onesa/callback?code=synthetic-code&state=" + state;
      const response = await request(path, browser);
      expect(response.status).toBe(303);
      const replay = await request(path, browser);
      expect(replay.headers.get("location")).toContain("onesa=restart");
      return {
        response,
        cookie:
          response.headers
            .getSetCookie()
            .find((value) => value.startsWith(COOKIE_NAME + "="))
            ?.split(";")[0] || "",
      };
    }
    it("keeps new ordinary users pending, blocks data, reuses identity and resolves through explicit local approval", async () => {
      expect(
        (await request("/api/auth/onesa/start", "", {}, "https://evil.example"))
          .status,
      ).toBe(403);
      const first = await signIn();
      expect(first.response.headers.get("location")).toBe(
        origin + "/#/monitoring?asset=17",
      );
      const { user, session } = await authenticate(first.cookie);
      expect(user.role).toBe("viewer");
      expect(user.onesaAccessPending).toBe(true);
      await expect(
        sdk.authenticateRequest({
          headers: { cookie: first.cookie },
        } as express.Request),
      ).rejects.toThrow(/approval/);
      const caller = appRouter.createCaller({
        user,
        session,
        req: { headers: { cookie: first.cookie } } as any,
        res: {} as any,
      });
      expect((await caller.auth.me())?.access.provisioningRequired).toBe(true);
      await expect(caller.assets.list()).rejects.toThrow(
        /approve local access/,
      );
      const again = await signIn();
      expect((await authenticate(again.cookie)).user.id).toBe(user.id);
      const db = await portalDatabase();
      const [count] = await db.execute(
        sql`SELECT count(*)::int AS count FROM onesa_factory_links WHERE subject=${subject}::uuid`,
      );
      expect(count.count).toBe(1);
      await changeUserAccess(user.id, {
        role: "viewer",
        expectedVersion: user.authVersion,
      });
      await expect(authenticate(first.cookie)).rejects.toThrow(
        /no longer active/,
      );
      const approved = await signIn();
      expect(
        (await authenticate(approved.cookie)).user.onesaAccessPending,
      ).toBe(false);
      unavailable = true;
      await expect(authenticate(approved.cookie)).rejects.toThrow();
      unavailable = false;
      expect((await authenticate(approved.cookie)).user.id).toBe(user.id);
      active = false;
      await expect(authenticate(approved.cookie)).rejects.toThrow();
      active = true;
      await expect(authenticate(approved.cookie)).rejects.toThrow();
      await sdk.revokeRequestSession({
        headers: { cookie: approved.cookie },
      } as express.Request);
      await expect(authenticate(approved.cookie)).rejects.toThrow();
    });
    it("links an existing approved local account only after password proof and preserves its role", async () => {
      subject = randomUUID();
      const password = "Synthetic-Factory-link-2026!";
      const local = await createUser({
        openId: randomUUID(),
        name: "Existing local engineer",
        email: subject + "@example.test",
        password: await sdk.hashPassword(password),
        role: "engineer",
        loginMethod: "email",
      });
      const collision = await signIn();
      expect(collision.response.headers.get("location")).toContain(
        "onesa=link",
      );
      expect(collision.cookie).toBe("");
      expect(
        (
          await request("/api/auth/onesa/start", "", {
            link: { email: local.email, password: "wrong-password" },
          })
        ).status,
      ).toBe(401);
      const linked = await signIn({ email: local.email!, password });
      const authenticated = await authenticate(linked.cookie);
      expect(authenticated.user.id).toBe(local.id);
      expect(authenticated.user.role).toBe("engineer");
      expect(authenticated.user.onesaAccessPending).toBe(false);
      active = false;
      await expect(authenticate(linked.cookie)).rejects.toThrow();
      active = true;
      await expect(authenticate(linked.cookie)).rejects.toThrow();
    });
    it("requires live central MFA for admin access and removes elevation after downgrade", async () => {
      subject = randomUUID();
      role = "admin";
      mfa = false;
      await expect(
        livePortalIdentity(portalConfig()!, "synthetic-token"),
      ).rejects.toThrow();
      mfa = true;
      const admin = await signIn();
      expect((await authenticate(admin.cookie)).user.role).toBe("admin");
      role = "user";
      await expect(authenticate(admin.cookie)).rejects.toThrow();
      role = "admin";
      await expect(authenticate(admin.cookie)).rejects.toThrow();
    });
    it("expires authentication at eight hours even when the provider token remains active", async () => {
      authAge = 28800;
      await expect(
        livePortalIdentity(portalConfig()!, "synthetic-token"),
      ).rejects.toThrow();
      authAge = 28799;
      await expect(
        livePortalIdentity(portalConfig()!, "synthetic-token"),
      ).resolves.toMatchObject({ active: true });
      authAge = 2;
    });
    it.each(["logout", "role change", "grant expiry"])(
      "rejects %s racing live introspection",
      async (change) => {
        subject = randomUUID();
        role = "user";
        active = true;
        const signedIn = await signIn();
        const { user, session } = await authenticate(signedIn.cookie);
        duringIntrospection = async () => {
          if (change === "logout")
            await sdk.revokeRequestSession({
              headers: { cookie: signedIn.cookie },
            } as express.Request);
          else if (change === "role change")
            await changeUserAccess(user.id, {
              role: "viewer",
              expectedVersion: user.authVersion,
            });
          else {
            const db = await portalDatabase();
            await db.execute(
              sql`UPDATE onesa_factory_sessions SET expires_at=now()-interval '1 second' WHERE session_id=${session.sessionId}::uuid`,
            );
          }
        };
        await expect(authenticate(signedIn.cookie)).rejects.toThrow();
      },
    );
  },
);
