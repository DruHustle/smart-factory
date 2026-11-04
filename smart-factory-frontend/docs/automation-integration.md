# Smart Factory — optional, standalone automation architecture

## Optional automation

For a commissioned source the industrial flow is
`PLC / machine → Node-RED → local broker → Python Smart Factory Edge Agent
→ durable MQTT/TLS → Smart Factory worker/API`. The Python agent alone validates
the device identity, mapping and provenance. A Node-RED flow may never self-certify
its telemetry as current live data; that requires reviewed individual source
commissioning. The existing Python gateway and security collector are retained
for rollback; no physical command safety is delegated to Node-RED.

`Smart Factory API → Activepieces` is an optional separate best-effort
business event integration for incident notes and follow-up actions. Activepieces
does not own process incidents, app roles, equipment commands or telemetry.
Both automation runtimes are independent of other Onesa applications and
disabled until explicitly configured and qualified.


## Operational qualification

The protocol source is commissioned and authorized independently of the cloud client. Node-RED receives only locally scoped broker permissions, and Python retains identity verification, mapping validation, durable MQTT transport, cyber evidence, and command policy. A flow's output does not establish physical measurement or machine actuation. Activepieces is an optional non-authoritative event consumer; its publisher is best effort rather than a guaranteed durable outbox. Keep automation disabled until reviewed credentials, TLS/ACLs, and recovery tests are qualified.

See the [Node-RED edge runbook](../../../smart-factory-edge/deploy/node-red/README.md), [Activepieces deployment runbook](../deploy/automation/activepieces/README.md), and [main architecture](architecture.md).
