# Activepieces business and AI automation

Activepieces is the Smart Factory **business/AI workflow engine**. It is not an
equipment controller and it is not an authoritative store for assets, incidents,
telemetry, users or command authorization.

The checked-in Compose stack is intended for local qualification or a controlled
single-host installation. Production on the Onesa Kubernetes platform should use
the official Activepieces Helm chart with retained secrets and external PostgreSQL
and Redis where those managed services are available.

## Start the qualification stack

```bash
cp .env.example .env
chmod 600 .env
# Replace every CHANGE_ME value before continuing.
docker compose --env-file .env config
docker compose --env-file .env up -d
curl --fail http://127.0.0.1:8080/api/v1/health
```

The application listener is bound to loopback. Put authenticated TLS ingress in
front of it if the editor/webhooks need remote access. PostgreSQL and Redis have no
host listener.

Create one Activepieces webhook flow for Smart Factory business events. Configure
the Smart Factory API with:

```text
AUTOMATION_ENGINE=activepieces
ACTIVEPIECES_WEBHOOK_URL=https://<reviewed-activepieces-origin>/<flow-webhook>
ACTIVEPIECES_WEBHOOK_SECRET=<at-least-32-random-characters>
ACTIVEPIECES_ALLOW_HTTP=false
AUTOMATION_WEBHOOK_TIMEOUT_MS=2000
```

The API sends a JSON envelope and the headers
`x-smart-factory-event-id` and `x-smart-factory-signature`. The signature is
`sha256=<hex HMAC-SHA256(body)>` using `ACTIVEPIECES_WEBHOOK_SECRET`. The
first production flow must verify this signature before performing side effects.

Current event kinds are:

- `incident.note.added`
- `incident.action.created`
- `incident.action.updated`

Webhook failure never rolls back the already committed Smart Factory transaction.
That makes Activepieces an orchestration consumer rather than the system of record.
Flows must use Smart Factory APIs for any later read/write and must respect normal
authorization. Do not wire Activepieces directly to PLC control, safety functions,
OPC UA FX control connections or TSN schedules.

## Production notes

Back up PostgreSQL plus the Activepieces encryption/JWT secrets together. Use the
official Kubernetes/Helm deployment when the Onesa cluster is the qualified runtime,
and prefer external managed PostgreSQL/Redis there. Keep workers separately scalable
from the app. Review Activepieces breaking changes before every version bump.
