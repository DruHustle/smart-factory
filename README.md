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
