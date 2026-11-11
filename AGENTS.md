# Smart Factory engineering guidance

`DruHustle/smart-factory` is the canonical consolidated Git repository.
`smart-factory-frontend`, `smart-factory-backend` and `smart-factory-edge` are
component source directories, not independent active Git checkouts. Preserve
the separate original histories and remotes in their recovery custody; do not
delete legacy repositories until production cutover and rollback are verified.
Read README.md, docs/consolidated-release.md, current open PRs and affected
component documentation before changes. Record starting and final revisions.

Keep extra worktrees in `local-tools/worktrees`, release/deployment evidence in
`local-tools/deployment-evidence`, release verification in
`local-tools/release-verification`, and local migration records in
`local-tools/migrations`, all inside this repository and ignored by Git.
Versioned schema migrations retain their existing source paths.
Do not create verification or evidence directories above the product repositories.
Do not create or clone smart-factory-iot or smart-factory-iot-* workspace folders,
or create sibling Smart Factory checkouts outside this parent.
Recovered legacy files under local-tools/recovered are preserved copies for
review, not the active source checkouts. Do not execute tasks from those copies.
Do not rename deployed database identities, URLs, JWT issuers, service accounts,
or remote /etc and /var/lib paths as part of a local folder cleanup.

## Implementation and verification

Use the root .github/workflows as the authoritative consolidated checks.
The frontend uses the pinned pnpm version and lockfile: run `pnpm install
--frozen-lockfile`, `pnpm check`, `pnpm test` and `pnpm build` from
smart-factory-frontend. Use the .NET version pinned by the backend and the
hashed Python dependencies for the edge. Run
`python3 scripts/consolidate_workflows.py --check` at the root after workflow edits.
Preserve Factory and Logistics as independently deployable products.

Node-RED remains an optional OT sidecar; the Python gateway owns commissioned
source identities, quality, durable delivery and command authorization. Verify
the actual Node-RED → gateway → MQTT/TLS → worker → asset path with isolated
fixtures before calling it operational. Keep source connectivity, observation
freshness and asset state independent; replay and demo data cannot become live
through a UI switch. Preserve tenant boundaries and all physical control interlocks.

The Vercel frontend, Oracle API/workers, external database and field gateways
have independent deployment state. Source manifests and passing simulations
do not prove production, hardware or backup restoration. Record exact blockers,
next actions and owners, then continue other reachable work. Never flash or
actuate equipment based only on software test results.
Keep secrets, private configurations, customer records and raw backup contents
out of Git, reports and CI artifacts. Preserve concurrent work and inspect
diffs before staging; do not reset, force-push or broadly clean the checkout.
