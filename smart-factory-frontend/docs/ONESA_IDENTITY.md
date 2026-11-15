# Onesa identity contract

Hosted Smart Factory has a legacy Portal provider mode and an opt-in managed Identity mode. The following configuration describes the legacy provider. See **Managed Identity pilot** below for the managed client.
**Sign in with Onesa** starts authorization for the requested Factory screen.
**Register** leads to the Portal registration page. Password and recovery links
lead to Portal account security. If the issuer is unavailable, keep the
hosted workspace unavailable for sign-in and restore the Portal connection.

The hosted browser uses the central account flow on every non-loopback origin.
The server requires it when `NODE_ENV=production` or
`ONESA_IDENTITY_ENABLED=true`. Standalone development on loopback can use a
local account with both conditions off. The explicitly selected demo identities
exercise the demo experience. An existing Factory user may be asked for one-time
password proof to link their retained account during the Portal flow.

Before connecting the hosted product, register a confidential client for
product `factory` with Company Portal and apply all dashboard migrations through
`0040_onesa_identity.sql`. The schema source lives in `drizzle/`. Keep local migration
execution records in `local-tools/migrations` at the repository root.

Configure `ONESA_IDENTITY_ENABLED=true`, `ONESA_IDENTITY_ISSUER` (exact HTTPS
Portal origin plus `/api/v1/identity`), `ONESA_IDENTITY_CLIENT_ID` (16–128 URL-safe
characters), `ONESA_IDENTITY_CLIENT_SECRET` (48–256 characters), and
`ONESA_IDENTITY_REDIRECT_URI` (exact HTTPS Factory origin plus
`/api/auth/onesa/callback`). Include that Factory origin in `ALLOWED_ORIGIN` and
retain a private `JWT_SECRET` of at least 32 bytes. These values are server-only;
no `VITE_` setting may contain the secret. `PUBLIC_URL` is not required.

`GET /api/auth/onesa/config` advertises only whether the connection is enabled.
`POST /api/auth/onesa/start` accepts an optional local hash `returnTo` and optional
`link: { email, password }` proof. It checks the exact request Origin, rate limits
attempts using PostgreSQL, and creates a five-minute, single-use transaction with
PKCE S256, random state, and a Secure HttpOnly browser binding. The HTTPS callback
exchanges the code server-side, introspects the grant, and restores the validated
local destination. No bearer grant is returned to JavaScript or a URL. Failed
linking returns a retry screen retaining the safe destination.

Identity is keyed by the stable `(issuer, subject)` pair. A matching email alone
never links a local account. An existing active local account requires password
proof, matching verified Portal email, and an unchanged local account version.
Its local role is preserved. A new ordinary account receives a viewer role and
an unapproved link. It can read only its account state and sign out; tRPC, direct
HTTP routes and WebSockets reject asset access. The existing User Access screen
allows an administrator to approve the viewer or set an appropriate local role.
Approval changes the account version, so the person must sign in again. The
current Factory deployment uses global roles; this is not a multi-tenant
organization membership implementation.

Every authenticated shared-account request introspects the encrypted server-side
grant. The client, issuer, stable subject, verified email, Factory application and
product role must match. Authentication expires after eight hours even when a
provider token remains active. Global administrators need `global_admin`, Factory
`admin`, and current MFA; an ordinary account cannot inherit that elevation. An
explicit inactive grant, invalid identity or administrator downgrade permanently
deletes that local grant/session. A later restoration requires a new sign-in.
An unavailable provider denies the current request but permits a later retry.
Logout removes the local grant. Central-only accounts cannot bypass these checks
through the standalone password login flow.

Federated local JWTs use the separate `smart-factory-onesa-api` audience, bound
to their federated session marker. Older releases reject that audience on rollback;
standalone local sessions keep their original audience. After provider verification,
the API rechecks the local session, expiration and account version to reject logout
or access changes that happened while introspection was in flight.

Local verification uses disposable PostgreSQL databases:

```
TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/factory_e2e pnpm exec vitest run server/portalIdentity.test.ts
pnpm exec playwright test --config=playwright.overview-contract.config.ts e2e/portal-signin.spec.ts
```

These tests prove the application boundary with a synthetic issuer and the browser
flow with controlled responses. Real Portal pairing, TLS configuration and provider
deployment must be recorded separately against the same final revisions. Hardware
telemetry qualification remains an independent requirement.


## Managed Identity pilot

Set `ONESA_IDENTITY_ENABLED=true` with the issuer `https://auth.onesa.eu/`, the registered confidential client ID and secret, exact `/api/auth/onesa/callback` URI and existing public dashboard origin. Set `ONESA_IDENTITY_AUDIENCE` to the Factory API identifier (proposed `https://api.factory.onesa.eu`), `ONESA_IDENTITY_ACCOUNT_ORIGIN` to the central Identity UI and `ONESA_IDENTITY_PUBLIC_JWKS` to the managed issuer’s trusted public current/next RS256 signing keys. Stage replacement keys before enabling their use. The callback uses code + S256 and verifies the signed ID token nonce and the signed access token. Only the Factory grant and `user` role authorize entry. Factory retains its own role and equipment permissions. An approved local admin additionally needs an MFA timestamp within 300 seconds.

Configure `ONESA_IDENTITY_MAPPING_ISSUER` to the exact old Portal issuer already used by verified Factory links in this environment. The managed issuer’s signed stable Onesa UUID maps to that existing identity. For unlinked accounts the existing dual-authentication flow proves local ownership. Existing subject links, operator recovery access, equipment identity and control-plane credentials remain owned by Factory.

During an Identity outage, an issued session is bounded by its locally validated signed grant (maximum 300 seconds) including after API restart with the configured keys. New login, renewal through sign-in and fresh factor verification require service recovery. Local deactivation and authorization remain in force during that period. A new authorization code is required after expiry. `ONESA_IDENTITY_AUDIENCE` must remain unset for the legacy provider during pre-cutover operation or rollback; sessions using the other token format will require sign-in again. Record and reconcile local changes before reverting issuer settings.
