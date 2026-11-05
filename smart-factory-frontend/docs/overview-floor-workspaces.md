# Overview: Factory Floor workspaces

The Overview keeps one factory floor area. The representation selector offers **3D**, **Floor plan**, **Process / P&ID**, **Electrical**, **Telemetry**, **Factory Inventory**, and **Infrastructure**. The three insights views replace the former telemetry/inventory/infrastructure row underneath the legacy Overview; the named factory's detailed inventory list stays in the Inventory workspace.

- **Telemetry:** A bounded, searchable gallery of equipment observations shows up to six miniature trends at a time; **Show more** progressively reveals additional equipment. Selecting a preview opens the full, existing `ObservationTrend` view with timestamp, scope, verification gaps, statistics, downloadable CSV for supported operational modes and a link to Analytics. A missing or incompatible trend displays **No verified readings**, never a fabricated curve. The overview's existing Last 60 min/Last 24 hours control synchronizes with this view.
- **Factory Inventory:** Complete current floor items are grouped by record type and zone/location. Status cards distinguish online, offline, maintenance, error, stale and unknown. These states can indicate possible downtime but are *not* a measured downtime duration. Links lead to authorized inventory records.
- **Infrastructure:** Existing administrator-restricted service evidence is preserved. Cybersecurity uses the separate security availability/overview APIs to display recorded finding severities and source coverage. Disabled, absent, stale and unavailable evidence are never shown as healthy. The view links to dedicated service-health and cybersecurity investigation workspaces.

Insights requests are initiated only while their view is open. Mini-chart requests are bounded by progressive reveal. Security remains subject to server-side authorization. The factory zone selector filters telemetry and inventory items within the current floor scope.

## Qualification

- `e2e/factory-diagrams.spec.ts`: seven-view navigation, thumbnails, expand/switch/collapse, inventory grouping, security coverage, no write calls, mobile overflow, and 3D return.
- `e2e/overview.spec.ts`: in the complete synthetic factory, verifies absence of the old row, new panels and return to the factory floor.
- `e2e/visual-workspace-helpers.ts`: aligns the shared demo check with the moved inventory view.

Run the repo frontend TypeScript check, Vitest suite and Playwright suites before merging. Production deployment and live readings require separate qualification; this change is frontend-only and does not alter device commands, safety interlocks, or server permissions.
