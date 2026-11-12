# Onesa identity contract

The optional Portal connection leaves standalone local-account login available.
Enable it only after registering a confidential Portal client for product
`factory` and applying all dashboard migrations through
`0040_onesa_identity.sql`. Schema source stays in `drizzle/`; local migration
execution records belong in `local-tools/migrations` at the repository root.

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
