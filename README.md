# Smart Factory

Smart Factory contains the frontend, backend, and edge software in the three
component directories below. Each component keeps its existing application,
build configuration, migrations, and documentation.

- `smart-factory-frontend/` — dashboard, application API, and deployment tools.
- `smart-factory-backend/` — backend services.
- `smart-factory-edge/` — gateway and device firmware.

This repository is being prepared from the previously deployed component
revisions. The original component repositories and remotes retain their complete histories. This combined repository carries a filtered copy of that history: diagnostic evidence and non-example environment files are excluded, so its historical commit IDs differ from the originals.
The current production release process still uses those original repositories;
this combined layout must not be used to promote a release until the monorepo
CI and release workflows have been validated.

Local tools, private credentials, deployment evidence, and extra worktrees
belong in `local-tools/` and are excluded from Git.
