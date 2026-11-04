#!/usr/bin/env bash
# Configure only this disposable seed process. The application and its exchange
# worker must remain disabled; never source this script into their environment.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "${E2E_ONESA_PRIVATE:-false}" != true ]] ||
   [[ "${NODE_ENV:-}" == production ]] ||
   [[ "${DATABASE_URL:-}" != postgres://postgres:postgres@127.0.0.1:55432/smart_factory_e2e ]]; then
  echo 'Private fixture requires the isolated test database and a non-production environment.' >&2
  exit 1
fi
export ONESA_ENABLED=true
export ONESA_INSTALLATION_ID=53ded05b-c1aa-4faa-aa65-4747637baac0
export ONESA_WORKSPACE_ID=proposed-test-workspace
export ONESA_CONTRACT_ID=urn:smart-factory:onesa-proposed:1.0.0
export ONESA_APPROVED_ORIGIN=http://127.0.0.1:18640
export ONESA_INGESTION_URL=http://127.0.0.1:18640/proposed/v1/batches
export ONESA_ALLOW_LOCAL_HTTP=true
export ONESA_SERVICE_TOKEN=isolated-contract-test-token-only
# Registration/mapping write only to the existing guarded local fixture DB.
# This process starts neither the receiver nor the delivery worker.
node --import tsx scripts/onesa/seed-fixture.ts
