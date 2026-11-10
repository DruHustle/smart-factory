# Smart Factory workspace and repository names

The product name is **Smart Factory**. The canonical GitHub repository is
[DruHustle/smart-factory](https://github.com/DruHustle/smart-factory), with default
branch `main`. Its component directories retain their existing names:

| Component | Directory in the canonical repository |
| --- | --- |
| Frontend and Node API | [`smart-factory-frontend`](../../smart-factory-frontend) |
| .NET services | [`smart-factory-backend`](../../smart-factory-backend) |
| Factory gateway and firmware | [`smart-factory-edge`](../../smart-factory-edge) |

For the combined release procedure, source qualification and repository-retirement
conditions, use the [canonical release runbook](../../docs/consolidated-release.md).
A nested component directory is not a separate Git checkout. Do not run the legacy
separate-repository deployment installer against this layout.

## Existing local work

The earlier Mac workspace at
`/Users/andrewgotora/Software Development/GitHub/smart-factory` contained three
independent Git repositories. Preserve those checkouts, their branches, local
changes, ignored configuration and worktrees until their work has been reconciled
with the canonical repository. Do not clone over an occupied directory or reset,
clean or delete a checkout to match the current layout.

The retained [`migrate-smart-factory.py`](../scripts/migrate-smart-factory.py)
script belongs to that historical separate-repository layout. Its origin mapping,
clone behavior and synchronization rules refer to the old repositories; it does
not migrate Git history into the canonical repository and is not an ongoing
setup or deployment command after their retirement. The implementation and its
existing fixture tests remain available for reviewing or recovering the prior
local migration, with their original source identities intact.

## Existing deployed resource identities

Repository consolidation does not migrate a running database, Docker volume, JWT
issuer or audience, Pi state directory, hosting domain or commissioned device.
Keep those identifiers compatible with existing data and services. Historical
deployment manifests and qualification logs preserve the identities they
actually recorded.

New source links use the retained canonical repository and component paths.
Changing persistent resource identities requires its own data/configuration
migration and verification of the deployed API and worker together.
