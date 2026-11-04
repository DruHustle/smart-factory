# Node-RED edge automation

Node-RED is an optional **OT edge orchestration sidecar** for Smart Factory. It
does not replace the existing Raspberry Pi gateway, MQTT spool, protocol drivers,
OPC UA FX/TSN diagnostics or PLC/controller safety logic.

Use it for low-code acquisition adapters, transformations and local orchestration
where deterministic control is not required. The existing Smart Factory edge
runtime remains the governed path for commissioned telemetry, provenance,
configuration revisions and command acknowledgements.

## Start

Install Docker Compose v2 on the edge host, then:

```bash
cd deploy/node-red
cp .env.example .env
chmod 600 .env
node-red admin hash-pw
# Put the generated bcrypt hash and random credential secret in .env.
docker compose --env-file .env config
docker compose --env-file .env up -d
docker compose ps
```

The editor is available only on `127.0.0.1:1880/admin/`. Use an SSH tunnel for
maintenance instead of publishing that port:

```bash
ssh -L 1880:127.0.0.1:1880 DEPLOY_USER@PI_IP
```

Then open `http://127.0.0.1:1880/admin/`.

The Compose network maps `host.docker.internal` to the Linux host gateway so a
reviewed flow can reach the existing local Mosquitto listener. Do not copy cloud
broker credentials into Node-RED unless a separately reviewed flow genuinely
requires them.

## Flow boundary

A Node-RED flow may:

- read approved local MQTT topics or an explicitly commissioned industrial source;
- normalize vendor payloads before they enter an approved Smart Factory route;
- perform non-safety local calculations and enrichment;
- call bounded HTTP/MQTT integrations that are independently authenticated.

A Node-RED flow must not:

- bypass gateway identity, topic ACLs, tag/unit validation or provenance checks;
- claim that a broker acknowledgement proves physical machine action;
- implement an emergency stop or deterministic PLC motion loop;
- rewrite OPC UA FX connection management or TSN scheduling;
- store Smart Factory user passwords or long-lived cloud administrator credentials.

Node-RED user data lives in the `node_red_data` volume. Back it up together with
the credential secret; without the same secret encrypted credentials cannot be
recovered. Review flow exports as code before production promotion.
