import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import type { User } from "../drizzle/schema";

export type PortalUser = User & { onesaAccessPending?: boolean };
export const randomValue = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export function portalConfig(env = process.env) {
  if (env.ONESA_IDENTITY_ENABLED !== "true") return null;
  const issuer = env.ONESA_IDENTITY_ISSUER || "",
    client = env.ONESA_IDENTITY_CLIENT_ID || "";
  const secret = env.ONESA_IDENTITY_CLIENT_SECRET || "",
    redirect = env.ONESA_IDENTITY_REDIRECT_URI || "";
  const authority = new URL(issuer),
    callback = new URL(redirect);
  const origins = (env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim());
  if (
    authority.protocol !== "https:" ||
    issuer !== authority.origin + "/api/v1/identity" ||
    callback.protocol !== "https:" ||
    redirect !== callback.origin + "/api/auth/onesa/callback" ||
    !origins.includes(callback.origin) ||
    !/^[\w-]{16,128}$/.test(client) ||
    secret.length < 48 ||
    secret.length > 256 ||
    Buffer.byteLength(env.JWT_SECRET || "") < 32
  )
    throw Error("Invalid Onesa identity configuration");
  return { issuer, client, secret, redirect, origin: callback.origin };
}
export type PortalConfig = NonNullable<ReturnType<typeof portalConfig>>;
export class InactivePortalIdentity extends Error {}
export async function portalDatabase() {
  const db = await getDb();
  if (!db) throw Error("Account storage unavailable");
  return db;
}
export async function issuerPost(
  config: PortalConfig,
  path: "/token" | "/session",
  body: URLSearchParams | { token: string },
) {
  const form = body instanceof URLSearchParams;
  const encode = (value: string) =>
    new URLSearchParams({ v: value }).toString().slice(2);
  const response = await fetch(config.issuer + path, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          encode(config.client) + ":" + encode(config.secret),
        ).toString("base64"),
      Accept: "application/json",
      "Content-Type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
    },
    body: form ? body : JSON.stringify(body),
  });
  if ([400, 401, 403].includes(response.status))
    throw new InactivePortalIdentity();
  if (response.status !== 200 || !response.body)
    throw Error("Onesa identity unavailable");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) {
      await reader.cancel();
      throw Error("Onesa response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const assertion = z.object({
  active: z.literal(true),
  iss: z.string(),
  aud: z.string(),
  sub: z.uuid(),
  email: z.email().max(254),
  email_verified: z.literal(true),
  name: z.string().min(1).max(200),
  exp: z.number().int(),
  auth_time: z.number().int().positive(),
  amr: z.array(z.string()),
  onesa_roles: z.array(z.string()),
  onesa_applications: z.array(z.string()),
  onesa_product_roles: z.object({ factory: z.enum(["user", "admin"]) }),
});
export async function livePortalIdentity(config: PortalConfig, token: string) {
  const parsed = assertion.safeParse(
    await issuerPost(config, "/session", { token }),
  );
  if (!parsed.success) throw new InactivePortalIdentity();
  const claim = parsed.data,
    now = Math.floor(Date.now() / 1000),
    admin = claim.onesa_roles.includes("global_admin");
  if (
    claim.iss !== config.issuer ||
    claim.aud !== config.client ||
    claim.exp <= now ||
    claim.exp > now + 86400 ||
    claim.auth_time > now + 30 ||
    now - claim.auth_time >= 28800 ||
    !claim.onesa_applications.includes("factory") ||
    admin !== (claim.onesa_product_roles.factory === "admin") ||
    (admin && !claim.amr.some((method) => method === "otp" || method === "mfa"))
  )
    throw new InactivePortalIdentity();
  return claim;
}
function key() {
  if (Buffer.byteLength(process.env.JWT_SECRET || "") < 32)
    throw Error("Identity storage key unavailable");
  return createHash("sha256")
    .update("factory-portal-grant:v1:" + process.env.JWT_SECRET)
    .digest();
}
export function sealGrant(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
function openGrant(value: string) {
  const bytes = Buffer.from(value, "base64url"),
    cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function safeReturnPath(value: unknown) {
  return typeof value === "string" &&
    value.length <= 2048 &&
    /^#\/(?!\/)/.test(value) &&
    !/[\\\u0000-\u0020\u007f]/.test(value) &&
    !/^#\/(?:login|register|reset-password|forgot-password)(?:[/?#]|$)/.test(
      value,
    )
    ? value
    : "#/";
}
export async function verifyPortalSession(
  user: User,
  sessionId: string,
): Promise<PortalUser> {
  const config = portalConfig();
  if (!config) throw new InactivePortalIdentity();
  const db = await portalDatabase();
  const [row] =
    await db.execute(sql`SELECT l.issuer,l.subject,l.local_access_approved,s.encrypted_grant FROM onesa_factory_sessions s
    JOIN onesa_factory_links l ON l.user_id=s.user_id WHERE s.session_id=${sessionId}::uuid AND s.user_id=${user.id} AND s.expires_at>now()`);
  if (!row) throw new InactivePortalIdentity();
  let claim;
  try {
    const saved = z
      .object({ token: z.string(), role: z.enum(["user", "admin"]) })
      .parse(JSON.parse(openGrant(String(row.encrypted_grant))));
    claim = await livePortalIdentity(config, saved.token);
    if (
      claim.iss !== row.issuer ||
      claim.sub !== row.subject ||
      ((user.role === "admin" || saved.role === "admin") &&
        claim.onesa_product_roles.factory !== "admin")
    )
      throw new InactivePortalIdentity();
  } catch (error) {
    if (error instanceof InactivePortalIdentity)
      await db.execute(
        sql`DELETE FROM onesa_factory_sessions WHERE session_id=${sessionId}::uuid AND user_id=${user.id}`,
      );
    throw error;
  }
  // Introspection is an external await. Logout and local role/account changes
  // during that wait must still invalidate this in-flight request.
  const [current] =
    await db.execute(sql`SELECT 1 FROM onesa_factory_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.session_id=${sessionId}::uuid AND s.user_id=${user.id} AND s.expires_at>now()
      AND s.encrypted_grant=${row.encrypted_grant} AND u.auth_version=${user.authVersion} AND u.disabled_at IS NULL`);
  if (!current) throw new InactivePortalIdentity();
  const admin = claim.onesa_product_roles.factory === "admin";
  return {
    ...user,
    role: admin ? "admin" : user.role,
    onesaAccessPending: !admin && row.local_access_approved !== true,
  };
}
