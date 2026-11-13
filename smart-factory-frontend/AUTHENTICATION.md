# Authentication and access

Hosted operators and customers use Company Portal to sign in, register and recover their account. The Factory callback verifies the Portal grant, maps the subject to its Factory membership and returns the user to the requested screen. See the [hosted identity contract](docs/ONESA_IDENTITY.md).

In standalone development, the Node API verifies local bcrypt passwords and issues an eight-hour HS256 HttpOnly cookie. Every protected request checks persisted current role, disabled state, session generation, recovery restriction and revocation. Browser code never stores the JWT. Sockets retain identity and expiry and enforce revocation; .NET delegated routes independently verify the persisted session and current role. Unsafe cookie requests enforce the exact allowed origin.

Private installations support viewer, operator, engineer and administrator roles. Shared reserved demo identities and public-demo deployments are always read-only and limited to approved demonstration records. A displayed engineer/admin role never grants a shared identity operational writes. Fixture records remain read-only even for individual users. Disabling demo sign-in rejects already-issued reserved sessions too.

New passwords require at least 12 characters within bcrypt's 72-byte UTF-8 limit. PostgreSQL login counters apply across replicas. Configure trusted proxy attribution for Vercel/Caddy and retain ingress rate limits. Production requires verified TLS, distinct secrets and exact allowed origins.

For standalone account administration, see [account access](docs/account-access.md). Local registration produces a pending request for an administrator. Where delivery is configured, local recovery supports a verified email reset link. Administrator-assisted recovery, revocation and the last-usable-admin check are documented there. See the [access and publication policy](docs/access-and-publication.md) for the demo boundary.

Demonstration identity creation is separate from fixture seeding. The persisted visibility setting never seeds. See [operations](docs/operations.md) and [Oracle deployment](deploy/oracle/README.md). AAS service credentials are server-only OAuth identities; they do not provide user SSO. See [AAS authorization](docs/authorization-and-aas.md).
