# Smart Factory

The canonical repository contains three independently configured components:

- `smart-factory-frontend/` — responsive dashboard, application API and release tools.
- `smart-factory-backend/` — .NET backend services and telemetry workers.
- `smart-factory-edge/` — gateway integrations and device firmware.

Authoritative quality and controlled release workflows live in `.github/workflows/`.
They validate the complete source, including browser journeys, real broker/service
contracts, native ARM64 images and isolated rollback compatibility. Nested frontend
workflows remain compatibility templates; `scripts/consolidate_workflows.py --check`
ensures their quality jobs and test commands remain represented at the root.

**Production cutover and old-repository deletion are not yet established.** The
manual frontend workflow is gated and must not be enabled before exact-source
qualification, verified API installation and reviewed infrastructure configuration.
Do not delete or archive the legacy component repositories until production and
operational rollback evidence, independent backups and dependency removal are
complete. See [the consolidated release runbook](docs/consolidated-release.md).

The consolidated Git history is filtered: diagnostic evidence and non-example
environment files were excluded, so historical commit IDs differ from the original
component repositories. Preserve those original histories independently before
retirement. Local tools, credentials, deployment evidence and extra worktrees belong
in ignored `local-tools/`, never in Git.

## Shared Onesa account sign-in

The dashboard supports optional Portal sign-in alongside its existing local
accounts. Apply dashboard migration `0040_onesa_identity.sql`, register the exact
HTTPS Factory callback in Portal, and configure the server-only
`ONESA_IDENTITY_*` values in the frontend component's environment example.
See [the identity contract](smart-factory-frontend/docs/ONESA_IDENTITY.md).

A new ordinary Onesa account signs in as a pending viewer with no asset access.
A local administrator explicitly approves access in User Access. A person with
an existing local account can link it by proving its password; the account keeps
its existing role. This deployment has a global factory role boundary, not
per-organization memberships. Portal administrators require current MFA and a
live Factory administrator grant. Revocation, role downgrade and logout invalidate
the corresponding local session; provider outages deny access without discarding
an otherwise valid session.

## Optional, isolated automation engines

Smart Factory may run a **Node-RED OT edge sidecar** next to its existing Python
gateway. The gateway retains commissioned source identities, provenance,
quality checks, read-only FX/TSN diagnostics, durable MQTT spool, security
collector and all command authorization. Node-RED is **not** the trusted
gateway; its sources and live eligibility are separately allowlisted.
See [Node-RED commissioning](smart-factory-edge/deploy/node-red/README.md).

A separate **Activepieces** instance is an optional IT/business automation
consumer. Application incidents remain authoritative even if an automation
webhook is unavailable. No business flow is installed or enabled by default.
See [Activepieces installation candidate](smart-factory-frontend/deploy/automation/activepieces/README.md).

Smart Factory, IMSOP and Smart Farmer have **no shared automation runtime**.
Each application manages independent Node-RED, Python agent, Activepieces,
identity/policy and storage. No production cutover is implied by merging the
optional manifests.
