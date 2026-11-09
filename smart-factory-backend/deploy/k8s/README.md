# Legacy Kubernetes references

The retained manifests describe an earlier deployment and are outside the supported six-service release. Kubernetes is unnecessary for the selected target. Do not use these manifests as the current production configuration.

If these references are adapted for a future Kubernetes rollout, run both digest-pinned jobs in `migrations/` before the matching DeviceService and TelemetryService workloads. Give each Job a release-specific name and do not start the telemetry worker unless the telemetry migration completes successfully.

Use the [canonical release runbook](../../../docs/consolidated-release.md) and
[current Oracle deployment guide](../../../smart-factory-frontend/deploy/oracle/README.md).
