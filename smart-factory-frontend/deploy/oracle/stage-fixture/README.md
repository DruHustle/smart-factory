# Factory split-role first-boot fixture

This local ARM64 fixture starts the qualified API and one worker on empty
databases. Redis, RabbitMQ and the HTTPS proxy stay on a Docker internal network.
The stack has its own project-scoped volumes, no published ports, and only
synthetic values. The internal TLS leaf covers `stage-proxy`; the worker receives
only the public fixture CA. Mail, demo accounts, assistant providers and access
to factory systems are disabled.

Run it on an authorized, disposable Linux ARM64 Docker host that has spare
capacity. Containerd image storage, Docker Compose v2, Python 3, OpenSSL and
`jq` are needed. The static caps total 2.5 GiB and 1.55 CPUs. Review current
host headroom before sharing a VM. Use trusted local copies of the PostgreSQL,
Redis, RabbitMQ and Caddy dependency images and record their resolved digests.

## Verified candidate

The exact-main ARM64 run [45408643844](https://github.com/DruHustle/smart-factory/actions/runs/45408643844)
produced artifact `14927512128` for
`c9306b0de5fb18b4c5710313b074b85cc77870c5`. The authenticated GitHub record
reports `397824554` bytes and ZIP SHA-256
`341ce41ae3677fd2c71d90928bdfc563bf61a6ee57d883263882d736bab514b3`.
Retain the exact ZIP in approved recovery custody before GitHub expires it.

Use your existing authorized GitHub connection to download the archive and keep
it in an ignored private directory. From the component root, extract and verify
only its candidate. The program checks the outer trusted pin, candidate archive
digest, real OCI manifest and expected Linux ARM64 non-root source labels.
It writes a private new output and reports the verified image IDs.

```sh
python3 scripts/prepare-stage-fixture.py \
  --bundle "$FACTORY_QUALIFIED_ZIP" \
  --output "$FACTORY_FIXTURE_DIR/candidate.tar.gz" \
  --revision c9306b0de5fb18b4c5710313b074b85cc77870c5 \
  --zip-bytes 397824554 \
  --zip-sha256 341ce41ae3677fd2c71d90928bdfc563bf61a6ee57d883263882d736bab514b3
bash deploy/oracle/stage-fixture/generate-tls.sh "$FACTORY_FIXTURE_DIR/tls"
```

For this artifact the candidate archive SHA-256 is
`1d7dfbf60c6137a77b15fec970ac26b72bc3632ffdad01a5953d2bb1691a76bf`.
Its image configuration ID is
`sha256:f8c87744ada39304c76ff4a6231e90d87ff1333edb8bb30ee634cd7fd136f9d5`
and OCI manifest ID is
`sha256:980fb0022419f48bd728f940837288f71f3cc9437ad07b6bf26870d86221bc84`.

## First boot and evidence

1. Confirm you are using the intended local Unix Docker socket. Check that
   `smart-factory-stage-fixture` has no existing containers, networks or
   volumes. Do not reuse earlier databases for this first-boot checkpoint.
   Confirm the archive's `factory-qualified:candidate` tag is absent or already
   points at the exact verified image before using `docker image load`.
2. Load the verified candidate archive. Read the loaded image ID and source
   labels and match them to the receipt. Export the full loaded image ID as
   `FACTORY_STAGE_IMAGE_ID`, and the absolute certificates directory as
   `FACTORY_STAGE_TLS_DIR`. Use only this Compose file, the explicit
   `smart-factory-stage-fixture` project name and `--env-file /dev/null`.
3. Run Compose configuration validation, then `up -d --wait api stage-proxy`.
   From the API container, check
   `curl -fsS --cacert /stage-trust/ca.crt https://stage-proxy:8443/health/ready`.
   Require the same call without the CA and a call with a mismatched TLS hostname
   to fail. Once TLS works, use `up -d --wait worker`.
4. Read `/api/runtime/contract` through the same private HTTPS path. Require
   the chosen revision on all three source fields, a ready schema and a fresh,
   compatible worker receipt. Record the exact image IDs, health results and
   resource use. Stop only the fixture project with Compose when finished.
   A later run may intentionally retain these synthetic volumes to test
   restart. Volume removal is a separate operation that discards fixture data.

## Hosted staging boundary

The fixture establishes a repeatable first install without the production VM
installer's prior-runtime receipt. Hosted staging still requires an authorized
Oracle operator, an independently provisioned Factory staging project, verified
resource headroom, dedicated stage credentials and data stores with tested
restore, trusted TLS, an approved private API route and protected staging web
origin. Commission the exact scoped Onesa Identity application and callbacks
before testing verified signup, product access or administrator sign-in. Keep
the worker scoped to a separate stage broker, client ID and synthetic topics.
Production release requires separate approval and an independently accepted
previous runtime and rollback.
