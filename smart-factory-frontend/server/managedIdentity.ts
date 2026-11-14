import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";

const ns = "https://onesa.eu/claims/";
const signedProfile = z.object({
  sub: z.string().min(1),
  email_verified: z.literal(true),
  email: z.email().max(254),
  name: z.string().min(1).max(200).optional(),
});

export function managedConfiguration(env: NodeJS.ProcessEnv) {
  const audience = env.ONESA_IDENTITY_AUDIENCE;
  if (!audience) return null;
  const mappingIssuer = env.ONESA_IDENTITY_MAPPING_ISSUER || "";
  const accountOrigin = env.ONESA_IDENTITY_ACCOUNT_ORIGIN || "";
  const keys = JSON.parse(
    env.ONESA_IDENTITY_PUBLIC_JWKS || "{}",
  ) as JSONWebKeySet;
  if (
    new URL(audience).protocol !== "https:" ||
    !/^https:\/\/[^/]+\/api\/v1\/identity$/.test(mappingIssuer) ||
    new URL(accountOrigin).origin !== accountOrigin ||
    !accountOrigin.startsWith("https://") ||
    !Array.isArray(keys.keys) ||
    !keys.keys.length ||
    keys.keys.length > 8 ||
    new Set(keys.keys.map((k) => k.kid)).size !== keys.keys.length ||
    keys.keys.some(
      (k) =>
        !k.kid ||
        k.kty !== "RSA" ||
        (k.use && k.use !== "sig") ||
        (k.alg && k.alg !== "RS256") ||
        !k.n ||
        Buffer.from(k.n, "base64url").length < 256 ||
        ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((name) => name in k),
    )
  ) {
    throw Error("Invalid managed Onesa identity configuration");
  }
  return {
    audience,
    mappingIssuer,
    accountOrigin,
    keys: createLocalJWKSet(keys),
  };
}

export async function verifyManagedGrant(
  managed: NonNullable<ReturnType<typeof managedConfiguration>>,
  issuer: string,
  client: string,
  packed: string,
  nonce?: string,
) {
  const pair = z
    .object({
      access_token: z.string().max(12000),
      id_token: z.string().max(12000),
    })
    .parse(JSON.parse(packed));
  const validate = (token: string, audience: string) =>
    jwtVerify(token, managed.keys, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
  const [{ payload: access }, { payload: id }] = await Promise.all([
    validate(pair.access_token, managed.audience),
    validate(pair.id_token, client),
  ]);
  const profile = signedProfile.parse(id);
  const roles = access[ns + "roles"];
  const products = access[ns + "products"];
  const now = Math.floor(Date.now() / 1000);
  const factor = access[ns + "mfa_time"];
  if (
    id.sub !== access.sub ||
    (nonce !== undefined && (!nonce || id.nonce !== nonce)) ||
    (id.azp !== undefined && id.azp !== client) ||
    (Array.isArray(id.aud) && id.aud.length > 1 && id.azp !== client) ||
    (access.azp !== undefined && access.azp !== client) ||
    (Array.isArray(access.aud) &&
      access.aud.some(
        (a) => a !== managed.audience && a !== issuer + "userinfo",
      )) ||
    !Array.isArray(products) ||
    products.length !== 1 ||
    products[0] !== "factory" ||
    !Array.isArray(roles) ||
    roles.length !== 1 ||
    roles[0] !== "user" ||
    !Number.isSafeInteger(access.iat) ||
    !Number.isSafeInteger(access.exp) ||
    access.iat! > now ||
    access.exp! <= access.iat! ||
    access.exp! - access.iat! > 300
  )
    throw Error("Invalid Factory grant");
  return {
    active: true as const,
    iss: issuer,
    sub: z.uuid().parse(access[ns + "user_id"]),
    aud: client,
    exp: Math.min(id.exp!, access.exp!),
    email: profile.email,
    email_verified: true as const,
    name: profile.name || profile.email,
    auth_time:
      typeof factor === "number" &&
      Number.isSafeInteger(factor) &&
      factor > 0 &&
      factor <= now
        ? factor
        : 0,
    amr:
      typeof factor === "number" &&
      Number.isSafeInteger(factor) &&
      factor > 0 &&
      factor <= now
        ? ["mfa"]
        : [],
    onesa_roles: [] as string[],
    onesa_applications: ["factory"],
    onesa_product_roles: { factory: "user" as "user" | "admin" },
  };
}
