# Smart Factory technical review — 5 November 2026

## Attribution and scope
This is an assistant-led review in separate architecture/data, security, reliability/release, and UI/accessibility passes. It is **not** an independent human Principal Engineer sign-off. No verified reviewer roster or independent review-agent capability was available. Source baseline: `248c130c0cd900a17a3bf08368559b5fc56bb6ec`, PR #10. Changes are confined to the frontend, its tests and review documentation; no device actuation, roles, credentials, database schema or backend migration is changed.

## Findings addressed

| Finding | Resolution |
|---|---|
| Live telemetry time window froze after opening the tab | Active-page minute refresh restored, with interval cleanup |
| Explicit observation time/source/metric and assistant context were lost | Valid pinned timestamps and URL-scoped selection restored, existing verified source ranking reused |
| Progressive reveal accumulated per-source requests | Six-source pagination bounds concurrent thumbnail queries |
| Named-factory Overview lost its item-inspection path | Searchable inventory list restored inside the tab; selection returns to 3D and the permission-checked inspector |
| Expanded graph inherited compact chart sizing | Full-height graph layout and keyboard-focus handling added |
| Tab selection disappeared on reload and return navigation | Allowlisted floor view stored in the URL without discarding other parameters |
| Live cybersecurity summary could include simulation findings | Live mode filter and matching investigation links outside demo workspaces |
| Infrastructure scope could be mistaken for selected factory/zone scope | Explicit workspace-wide scope label |
| Desktop sidebar and floor button both named Infrastructure broke a strict browser locator | User journeys scope tab interactions to the Floor representation group |
| Synthetic diagram fixture expected a zone despite no assigned zone | Test now expects Unassigned; no fabricated zone in production |
| Older browser checks looked for removed below-floor panels | Tests enter the new views while retaining provenance, pinned-time, permission and no-write assertions |

## Validation obtained before publishing this review
- TypeScript check passed after the changes.
- Focused source/window tests: 18 passed.
- Security/authorization, cookie/registration policy, infrastructure boundaries/freshness, MQTT/telemetry contracts, operations calculations, release/runtime policies and source selection: **124 passed, 8 skipped** (database-dependent cases require isolated CI services). These overlap the focused tests; counts are not additive.
- Focused Chromium browser validation: **7 passed**, covering direct-source/assistant context, live and pinned windows, timezone updates, phone/desktop workspace switching, and the new seven-view interactions. Initial sandbox renderer failures were traced to missing system fonts and resolved by installing the sandbox-only font dependencies. The repository's unchanged Ubuntu/Playwright CI remains the full required browser gate.
- Baseline monorepo/release-contract/feature-coverage workflows passed, but baseline Dashboard qualification failed on UI journeys. Baseline results are not evidence for this revised candidate.

## Release observations and unresolved gates
Read-only production checks returned HTTP 200 readiness and runtime schema ready, with worker fresh/compatible. The frontend release reported `ad1e7be7a874c48d9ec88ba544cb23e4a73b2965`, while the API/backend/edge contract reported `28eb3c8399a09719bb39730622d34d22fbea9640`. These are not the review candidate. Existing production workflow requires the approved API source first, all required exact-main checks, a recorded prior deployment and post-deploy verification. None of these requirements has been weakened.

Before production: qualify the revised exact source in full CI; review findings independently using real reviewer identities; merge without bypassing protection; install and verify the approved API/runtime through authorized Oracle deployment access; run canonical main-branch release checks; deploy frontend with rollback identity; verify the live release and role-scoped journeys. No Oracle SSH access was available in this execution context, and no production or DNS changes were made.
