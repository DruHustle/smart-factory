# Smart Factory Node-RED OT integration

For optional administrator package installation from the Smart Factory UI, see
[Node-RED package management](../../../smart-factory-frontend/docs/NODE_RED_PACKAGE_MANAGEMENT.md).
That guide covers the separate API-to-Pi SSH route, exact package review,
restricted token, persistent install status and gateway enrollment. Its source
does not activate a runtime or change OT flows.

**Optional, off by default, no live factory cutover in this change.** Node-RED
provides the device/protocol/transform layer. The existing **Python Smart Factory
Edge Agent** owns MQTT identity, policy, validation, provenance, durable SQLite
queue, cloud MQTT/TLS uplink and existing cybersecurity observations. Activepieces
is **separate** and handles business/AI workflows at the application API.

The architecture is:

\`\`\`text
PLC / Machine / Sensor → Node-RED → local MQTT (broker per-source ACL)
→ Python Smart Factory Edge Agent → durable spool → MQTT/TLS → Smart Factory
\`\`\`

No public broker credentials or controller write permissions are provided to
Node-RED. Existing WROVER MQTT, OPC UA FX/TSN observations, commissioning,
legacy drivers and separately authorized robot/GPIO controls remain intact.
Node-RED is introduced **per physical source**, not by turning off all old
pollers at once. Never operate duplicate readers or serial owners for the
same equipment.

## Install on an isolated Linux gateway

Review Node-RED's official container image for the Pi architecture, then pin
its immutable digest in a **private** \`deploy/node-red/.env\`. Set independent
random editor credential and bcrypt hash (\`node-red admin hash-pw\`).
\`docker compose --env-file .env config\` must render before
\`docker compose --env-file .env up -d\`. The Compose uses host networking
because the Pi Mosquitto ingress is bound to loopback. The editor is itself
bound to \`127.0.0.1:1880/admin\`; access only through an SSH tunnel:

\`\`\`sh
ssh -L 1880:127.0.0.1:1880 DEPLOY_USER@PI_IP
\`\`\`

**Host networking can reach other host interfaces:** apply dedicated OT
firewall egress rules and allow only reviewed PLC destinations. Do not give the
Node-RED container privileged mode, Docker socket access, blanket serial
devices, or writable TLS/cloud credentials. Add a serial device mapping only
after an individual commissioning and exclusive-ownership review.

Import \`flows.example.json\` only in an isolated test environment. The tab
is **disabled** and its synthetic \`node-red-demo\` publisher is **not**
commissioned by default. Configure Node-RED's MQTT broker node credentials in
the encrypted private volume; do not commit credential exports. The example's
MQTT publisher must be given an exact, publish-only ACL for the topic.

Production commissioning of source \`node-red-source-01\` requires:

1. Create a dedicated MQTT identity whose ACL permits **only**
   \`factory/<site>/<line>/node-red-source-01/telemetry\`; the Python ingress
   subscription must have corresponding *read* permissions. Do not grant
   \`/commands\`, \`/control-ack\` or cloud broker access.
2. Add it to \`LOCAL_MQTT_DEVICE_IDS\` and \`NODE_RED_SOURCE_IDS\`. Python
   rejects any Node-RED-supplied \`integration\` or \`observation\` claims and
   stamps its own provenance. Without approval it marks samples bad/unverified,
   suitable only as historical evidence.
3. Validate source identity, stable units, timestamp, physical sensor and
   calibration, packet loss, stale/replay, retain flags and queue outage.
   **Only after acceptance** add the ID to
   \`NODE_RED_APPROVED_LIVE_IDS\`. Broker acceptance is not a proof of actual
   machine action or calibrated quality.
4. Disable the old poller for that specific source only when the new path has
   passed parallel comparison **without double-publishing production data**.
5. Retain the previous Python gateway source, SQLite spool, broker credentials,
   ACL, Node-RED flow/credential backups and recovery steps.

No Node-RED flow may create PLC safety programs, invoke OPC UA FX
ConnectionManager writes, change TSN schedules, or issue physical commands.
Those operations remain external to the orchestration layer and protected by
existing commissioned controller safety logic.

## Python cybersecurity and AI agents

Python already includes the optional read-only \`SecurityCollector\` and
records gateway identity/configuration/transport evidence through an independent
durable path. Keep \`SECURITY_COLLECTOR_ENABLED=false\` until each source
namespace/token is commissioned. The Python runtime is an appropriate future
location for **read-only local AI advisory plugins** after schema validation;
this branch **does not install a model or enable AI inference**. Any AI plugin
must be optional, measured against resource limits, never send telemetry to
external models without authorization, and never bypass command policy.

## Verification

\`\`\`sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s raspberry-pi/tests -p 'test_node_red_ingress.py' -v
# Then run all existing gateway tests and a disposable two-broker MQTT drill.
\`\`\`

For Activepieces see
\`smart-factory-frontend/deploy/automation/activepieces/README.md\`.
No gateway application, VM, broker ACL or plant controller is changed simply
because these files are merged.
