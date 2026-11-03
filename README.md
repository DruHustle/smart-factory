# Smart Factory

Smart Factory contains the frontend, backend, and edge software in the three
component directories below. Each component keeps its existing application,
build configuration, migrations, and documentation.

- `smart-factory-frontend/` — dashboard, application API, and deployment tools.
- `smart-factory-backend/` — backend services.
- `smart-factory-edge/` — gateway and device firmware.

This repository is being prepared from the previously deployed component
revisions. Their complete Git histories and original remotes are retained.
The current production release process still uses those original repositories;
this combined layout must not be used to promote a release until the monorepo
CI and release workflows have been validated.

Local tools, private credentials, deployment evidence, and extra worktrees
belong in `local-tools/` and are excluded from Git.
