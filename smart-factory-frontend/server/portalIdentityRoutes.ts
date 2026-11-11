import type { Express } from "express";
import { parse } from "cookie";
import { sql, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { users } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import { sharedDemoIdentity } from "../shared/access-policy";
import { sdk } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { recordLoginAttempt } from "./db";
import {
  digest,
  InactivePortalIdentity,
  issuerPost,
  livePortalIdentity,
  portalConfig,
  portalDatabase,
  randomValue,
  safeReturnPath,
  sealGrant,
} from "./portalIdentity";

const cookieName = "__Host-onesa_factory_login";
const cookieOptions = {
  secure: true,
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};
export function installPortalIdentity(app: Express) {
  app.get("/api/auth/onesa/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ enabled: !!portalConfig() });
    } catch {
      res.status(503).json({ error: "Onesa sign-in is unavailable." });
    }
  });
  app.post("/api/auth/onesa/start", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const config = portalConfig();
      if (!config) return res.sendStatus(503);
      if (req.headers.origin !== config.origin) return res.sendStatus(403);
      const input = z
        .object({
          returnTo: z.string().max(2048).optional(),
          link: z
            .object({
              email: z.email().max(320),
              password: z.string().min(1).max(128),
            })
            .strict()
            .optional(),
        })
        .strict()
        .safeParse(req.body);
      if (!input.success) return res.sendStatus(400);
      const ids = [
        "ip:" + (req.ip || "unknown"),
        ...(input.data.link
          ? ["account:" + input.data.link.email.toLowerCase()]
          : []),
      ];
      for (const id of ids) {
        const window = await recordLoginAttempt(
          digest("onesa:" + id),
          15 * 60_000,
        );
        if (window.attempts > 15) {
          res.setHeader("Retry-After", "900");
          return res.sendStatus(429);
        }
      }
      const db = await portalDatabase();
      let linkUserId: number | null = null,
        linkVersion: number | null = null;
      if (input.data.link) {
        const [user] = await db
          .select()
          .from(users)
          .where(
            sql`lower(${users.email})=${input.data.link.email.toLowerCase()}`,
          )
          .limit(1);
        if (
          !user ||
          user.disabledAt ||
          user.passwordChangeRequired ||
          sharedDemoIdentity(user) ||
          !user.password ||
          !(await sdk.comparePassword(input.data.link.password, user.password))
        )
          return res
            .status(401)
            .json({ error: "Could not confirm this local Factory account." });
        linkUserId = user.id;
        linkVersion = user.authVersion;
      }
      const state = randomValue(),
        browser = randomValue(),
        verifier = randomValue();
      await db.execute(
        sql`DELETE FROM onesa_factory_transactions WHERE expires_at<=now()`,
      );
      await db.execute(
        sql`DELETE FROM onesa_factory_sessions WHERE expires_at<=now()`,
      );
      await db.execute(sql`INSERT INTO onesa_factory_transactions(state_hash,browser_hash,verifier,return_to,link_user_id,link_version)
        VALUES(${digest(state)},${digest(browser)},${verifier},${safeReturnPath(input.data.returnTo)},${linkUserId},${linkVersion})`);
      res.cookie(cookieName, browser, { ...cookieOptions, maxAge: 300000 });
      const params = new URLSearchParams({
        response_type: "code",
        scope: "openid email profile onesa",
        client_id: config.client,
        redirect_uri: config.redirect,
        state,
        nonce: randomValue(),
        code_challenge: digest(verifier),
        code_challenge_method: "S256",
      });
      return res.json({ url: config.issuer + "/auth?" + params });
    } catch {
      return res
        .status(503)
        .json({ error: "Onesa sign-in is temporarily unavailable." });
    }
  });
  app.get("/api/auth/onesa/callback", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    let config;
    try {
      config = portalConfig();
    } catch {
      return res.sendStatus(503);
    }
    if (!config) return res.sendStatus(503);
    let returnTo = "#/";
    const retry = (reason: string) =>
      res.redirect(
        303,
        config.origin +
          "/#/login?onesa=" +
          reason +
          "&returnTo=" +
          encodeURIComponent(returnTo),
      );
    const query = z
      .object({
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        code: z.string().min(1).max(4096),
        iss: z.literal(config.issuer).optional(),
      })
      .safeParse(req.query);
    const browser = parse(req.headers.cookie || "")[cookieName];
    if (!query.success || !browser || !/^[A-Za-z0-9_-]{43}$/.test(browser))
      return retry("restart");
    try {
      const db = await portalDatabase();
      const [txn] = await db.execute(
        sql`DELETE FROM onesa_factory_transactions WHERE state_hash=${digest(query.data.state)} AND browser_hash=${digest(browser)} AND expires_at>now() RETURNING *`,
      );
      if (!txn) return retry("restart");
      returnTo = safeReturnPath(txn.return_to);
      res.clearCookie(cookieName, cookieOptions);
      const exchange = z
        .object({
          access_token: z.string().min(20).max(4096),
          token_type: z.string().regex(/^bearer$/i),
        })
        .parse(
          await issuerPost(
            config,
            "/token",
            new URLSearchParams({
              grant_type: "authorization_code",
              code: query.data.code,
              code_verifier: String(txn.verifier),
              redirect_uri: config.redirect,
            }),
          ),
        );
      const claim = await livePortalIdentity(config, exchange.access_token);
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${claim.iss + ":" + claim.sub},0))`,
        );
        let [link] = await tx.execute(
          sql`SELECT user_id FROM onesa_factory_links WHERE issuer=${claim.iss} AND subject=${claim.sub}::uuid`,
        );
        if (txn.link_user_id !== null) {
          const [local] = await tx
            .select()
            .from(users)
            .where(eq(users.id, Number(txn.link_user_id)))
            .for("update");
          if (
            !local ||
            local.disabledAt ||
            local.passwordChangeRequired ||
            local.authVersion !== Number(txn.link_version) ||
            local.email?.toLowerCase() !== claim.email.toLowerCase() ||
            sharedDemoIdentity(local) ||
            (local.role === "admin" &&
              claim.onesa_product_roles.factory !== "admin")
          )
            throw new InactivePortalIdentity();
          await tx.execute(
            sql`INSERT INTO onesa_factory_links(issuer,subject,user_id,local_access_approved) VALUES(${claim.iss},${claim.sub}::uuid,${local.id},true) ON CONFLICT DO NOTHING`,
          );
          [link] = await tx.execute(
            sql`SELECT user_id FROM onesa_factory_links WHERE issuer=${claim.iss} AND subject=${claim.sub}::uuid`,
          );
          if (!link || Number(link.user_id) !== local.id)
            throw new InactivePortalIdentity();
        }
        if (!link) {
          const [created] = await tx
            .insert(users)
            .values({
              openId: "onesa-" + digest(claim.iss + ":" + claim.sub),
              name: claim.name,
              email: claim.email.toLowerCase(),
              password: null,
              loginMethod: "onesa",
              role: "viewer",
            })
            .onConflictDoNothing()
            .returning();
          if (!created) return null;
          await tx.execute(
            sql`INSERT INTO onesa_factory_links(issuer,subject,user_id,local_access_approved) VALUES(${claim.iss},${claim.sub}::uuid,${created.id},false)`,
          );
          link = { user_id: created.id };
        }
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, Number(link.user_id)));
        if (
          !user ||
          user.disabledAt ||
          (user.role === "admin" &&
            claim.onesa_product_roles.factory !== "admin")
        )
          throw new InactivePortalIdentity();
        const sessionId = randomUUID();
        await tx.execute(
          sql`INSERT INTO onesa_factory_sessions(session_id,user_id,encrypted_grant,expires_at) VALUES(${sessionId}::uuid,${user.id},${sealGrant(JSON.stringify({ token: exchange.access_token, role: claim.onesa_product_roles.factory }))},to_timestamp(${claim.exp}))`,
        );
        return { user, sessionId };
      });
      if (!result) return retry("link");
      const lifetime = Math.min(8 * 3600_000, claim.exp * 1000 - Date.now());
      res.cookie(
        COOKIE_NAME,
        await sdk.createSessionToken(result.user, {
          sessionId: result.sessionId,
          expiresInMs: lifetime,
          onesa: true,
        }),
        { ...getSessionCookieOptions(req), maxAge: lifetime },
      );
      return res.redirect(
        303,
        config.origin + "/" + safeReturnPath(txn.return_to),
      );
    } catch (error) {
      return retry(
        error instanceof InactivePortalIdentity ? "denied" : "unavailable",
      );
    }
  });
}
