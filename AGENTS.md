<!-- smart-factory-workspace-layout:v1 -->
## Smart Factory workspace location

This smart-factory directory is the canonical parent for the existing
smart-factory-frontend, smart-factory-backend and smart-factory-edge repositories.
Preserve their separate Git histories and existing remotes.
Keep all Smart Factory project checkouts, worktrees, local tools and release
evidence within this parent. Use local-tools/worktrees for extra worktrees,
local-tools/deployment-evidence for release evidence and local-tools/migrations
for local migration records. Use the existing component directories for source.
Do not create or clone smart-factory-iot or smart-factory-iot-* workspace folders,
or create sibling Smart Factory checkouts outside this parent.
Recovered legacy files under local-tools/recovered are preserved copies for
review, not the active source checkouts. Do not execute tasks from those copies.
Do not rename deployed database identities, URLs, JWT issuers, service accounts,
or remote /etc and /var/lib paths as part of a local folder cleanup.
