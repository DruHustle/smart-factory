# Canonical Smart Factory release and repository retirement

## Status and safety boundary

`DruHustle/smart-factory` contains the application, API, backend and edge sources.
Root workflows now perform full component, browser, renderer, cross-service and
native ARM64 qualification. Nested component workflows remain compatibility
inputs/documentation for the old tooling, not a second authoritative release.
The migration generator retains their test jobs and test commands.

**Production cutover and repository retirement are not established by source
qualification. Do not delete or archive any legacy repository yet.** The initial
consolidated candidate `5b09231a9bcc8c7b5eee18ac8e1d70146088de62` passed native
ARM64 qualification in run `41762739067`; artifact `13291687868` has SHA-256
`b436b41142842762c886b6215f6bd53de6a599d19f131b77087fd37af3936ad5`.
Its actual OCI image configuration/manifest identities were independently read
and verified from the downloaded archive. That result applies to that revision,
not later changes. It is an isolated compatibility proof, not a live receipt.

No deployment, DNS change, environment-secret change, Terraform apply, database
restoration, repository deletion or production rollback was performed by this
source migration. No guarantee of zero defects is implied.

## Outstanding component changes reconciled

| Original PR | Source disposition |
| --- | --- |
| Frontend #56, `2bc638879ecd1277deff5e988b2782154ebc5303` | Domain/SSH-target/allowlist/callback validation and tests were already incorporated. Keep newer Factory-domain and sender documentation rather than replacing it with older text. |
| Frontend #37, `1d1046197f413cb0dc0db59c57af0deb035fe1cd` | Preserve incorporated authentication budgets, password recovery, pending-approval credential checks, delivery metadata and real SMTP recovery. Keep subsequent role-selection, first-admin help, identity-locking and race-safety changes. Full authentication/browser/native packaged tests remain required. |
| Frontend #19, `12d1a629e989843d7e221e54c3a919ed9c70cce6` | Provider/model selection, list-filter normalization and provider transports are present with subsequent cancellation and equipment-context improvements. Restore missing private integration/resource test execution, script entries and bounded assertion waits. Preserve **optional** provider-selection capability plus UI feature detection: making it globally required again would break compatible rollback. Retain the old feature-review document explicitly as historical evidence. Existing full experience and renderer suites replace the older duplicate matrix entries. |
| Backend #17, `8315e63b77e5f8934105bc5b3941161844a9e40a` | Migration source is present. Preserve the later approved sender `notifications-factory@onesa.eu`, not the superseded subdomain sender. |
| Backend #15, `0990a5815e0597614306ebd2ff0eb925cc11c354` | Port display-name separation without changing Terraform resource addresses, DNS/hostname identities, network rules, machine size, disk size or image selection. Use the owner's newer Onesa UG display identity. Source changes only: never apply an unreviewed Terraform plan. |
| Backend #13, `39602d8cdc6f6c937341ef4e43bf9aa47d16cd97` | Both authenticated STARTTLS transport test files are already identical. |

The read-only source audit preserves upstream PR heads and classifies changes at
file/patch level. A textual conflict can be an intentional later implementation;
the table records those dispositions rather than blindly reapplying old patches.
Keep the old PRs and their discussions until the canonical changes are merged and
qualified. Then close them with a link to the canonical merge and evidence, not by
merging their outdated deployment workflows back into production.

## Qualify the canonical source

Every main push runs the complete required quality suites. The guarded release
also accepts an exact-source manual rerun on main, never PR artifacts or a fork.
A newer failed or in-progress run cannot be masked by an older successful run.

```sh
python3 scripts/release_gate.py --revision "$REVIEWED_MAIN_SHA"
```

This requires all seven workflows: component quality, full dashboard quality,
ARM64 bundle qualification, documentation, renderer, release contracts and the
restored private/resource journeys. Source identity must remain the current main
revision before and after inspection. None of these read-only checks deploys.

## Prepare and install the exact API/worker artifact

Use a clean checkout of the reviewed canonical main commit. Keep private work
under ignored `local-tools/`, not in tracked files. Download durable backups to a
separate, owner-controlled store before eventual retirement.

Create a private reviewed **installed-runtime** baseline containing `sources`
(frontend/backend/edge), `schema` (revision/digest), and required `capabilities`.
Obtain those values from the current verified installation. The CI fallback in
`release/qualification.json` is not evidence of the currently installed version.

```sh
python3 scripts/prepare_consolidated_release.py \
  --revision "$REVIEWED_MAIN_SHA" \
  --artifact-id "$QUALIFIED_ARTIFACT_ID" \
  --baseline local-tools/reviewed-installed-baseline.json \
  --output-dir local-tools/canonical-qualified-release
```

The preparer uses only the canonical repository. It checks GitHub run and
artifact identity, expiry, digest and size, real OCI metadata, exact image labels,
all packaged runtime/recovery/rollback flags, and the existing strict VM verifier.
It never rebuilds a qualified image, contacts the production host or installs
anything. The legacy preparation module contributes only its pure OCI-byte
verifier; its legacy repository cloning/preparation functions are not executed.

On the owner's existing trusted SSH workstation, use the maintained installer:

```sh
python3 smart-factory-frontend/scripts/deploy-vm.py --check \
  --bundle local-tools/canonical-qualified-release/qualified-arm64-bundle.zip \
  --manifest local-tools/canonical-qualified-release/release-manifest.json \
  --ssh-target "$VERIFIED_ONESA_SSH_TARGET" \
  --api-origin "$VERIFIED_FACTORY_API_ORIGIN" \
  --ui-origin https://factory.onesa.eu
```

The selected SSH alias retains its private route and configured identity. The
helper does not require an Ed25519 key when the workstation already uses another
authorized identity. For a separate local key file, pass `--ssh-identity` or set
`SMART_FACTORY_SSH_IDENTITY`; the key is used locally for SSH/SCP and is never
uploaded to the VM.

This installer updates an existing healthy API/worker pair. It cannot bootstrap
a blank Onesa destination. Host relocation first needs the live source inventory
and a coordinated transfer of its retained configuration, images and any local
data. Include the separate Factory BaSyx/Caddy network, MQTT identities,
certificates and broker/session storage in that inventory, and check the shared
destination's ports and capacity. Keep Factory's ingress independently managed
from Logistics. Stop the source singleton before activating the destination
worker, retain the current frontend deployment, and preserve the source VM's
disks until the replacement and recovery path are verified. Starting another
worker merely to satisfy the existing-release preflight is not a bootstrap path.

Only after that read-only preflight succeeds, run the same command with
`--deploy` instead of `--check`. Use its private receipt and `--status` to reconnect;
never start another deployment just because the local session disconnected.
Strict host-key checks, exact installed baseline, API-before-worker ordering,
additive-migration compatibility, existing credentials and singleton-worker checks
remain mandatory. A failed gate is a stop condition, not permission to override.
No database backup or restore is implied by this installer.

## Controlled frontend cutover

The root `deploy-vercel-oracle.yml` is **manual only** and must run on main in the
`production` environment. Configure and review that environment's approval rules,
secrets and non-secret variables before enabling it. Merely merging the workflow
must not be treated as configuring those controls.

The owning Vercel team's access is required. Independently confirm its project,
canonical Git link, frontend root directory and currently active deployment.
Freeze the legacy deployment producers and record that evidence before setting
`SMART_FACTORY_LEGACY_DEPLOYMENT_FROZEN=true`; do not disable the running services.
Set `SMART_FACTORY_MONOREPO_PRODUCTION_ENABLED=true` only after the reviewed API
release is installed. Set the selected API/UI origins explicitly; there is no
silent fallback to an older hostname.

Required private configuration is `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`, and, for protected staging, the owner-configured
`VERCEL_AUTOMATION_BYPASS_SECRET`. Never commit or upload these values, `.vercel/`,
or fetched environment files. The bypass is sent only in a header to the exact
validated staged deployment, with redirects refused; protection is not disabled.

Dispatch with the exact main SHA and reviewed prior production deployment ID.
The workflow verifies installed API identity and worker compatibility, builds
from the monorepo root, stages a prebuilt production artifact with `--skip-domain`,
checks its project/source/HTTP/API identity and byte-exact industrial assets,
rechecks current main and the previous production deployment, then explicitly
promotes that same artifact. It verifies the public UI and API proxy afterwards.
An unverified staged build never replaces the production domains. The previous
deployment is retained; a failed post-promotion check requires the reviewed
rollback procedure and must never authorize cleanup.

## Retirement gate — still closed

Do not remove `smart-factory-frontend`, `smart-factory-backend`, or
`smart-factory-edge` until **all** of the following are evidenced:

1. Exact canonical main qualification, successful production API/worker/UI
   deployment, source/schema/asset checks and authenticated user workflows on
   `factory.onesa.eu`, including actual approved recovery-email delivery.
2. A reviewed operational rollback/recovery rehearsal that preserves production
   data, credentials, telemetry identities and the singleton worker. The isolated
   CI fallback alone is not a production rollback receipt. Retain and verify both
   backend images, frontend deployment identities, database backups and restore
   instructions before any controlled rehearsal.
3. No active dependency on the old repositories: Vercel Git links, legacy Actions
   producers, VM source pulls, image/package ownership, deployment hooks, release
   downloads, environment configuration, and operator recovery instructions.
4. Durable independent exports of all branches/tags/PR heads, release assets,
   relevant issues/PR discussions, LFS/package assets and deployment evidence.
   Verify restore in an empty workspace. The audit's seven-day GitHub artifacts
   are temporary review copies, **not** durable retirement backups.
5. A final human review of the exact three repositories and evidence. Archive
   first when possible; deletion is a separate action after the conditions above.

No workflow or script in this migration deletes or archives a repository. Keep
legacy production paths available until the replacement is actually proven.
