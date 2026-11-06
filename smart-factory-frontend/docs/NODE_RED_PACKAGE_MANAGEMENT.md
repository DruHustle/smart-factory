# Node-RED package management

An individual Smart Factory administrator can review and install an exact npm
version of a **Node-RED node library or plugin** from **Administration →
Integrations → Node-RED nodes, plugins & libraries**. The integration is optional
and disabled by default. Publishing this source does not enroll a gateway,
establish a tunnel, install a package or deploy an OT flow.

## Where the request runs

The management broker runs in the existing **Node/Express API** built from
`smart-factory-frontend`, on the central installation. The Vercel application
sends authenticated tRPC requests to that API. The API checks the current
individual administrator account, requires the live workspace, and keeps the
Node-RED service credential on the server. Shared demo accounts and public demo
deployments cannot use package management.

The API advertises `node-red-package-management-v1` as an optional capability.
The panel is hidden when a compatible older rollback API lacks it, so that UI
does not issue unsupported management requests. Core runtime compatibility and
the exact-source promotion checks retain their existing requirements.

The existing Node-RED deployment runs on the **Pi gateway**, with host networking
and its editor bound to **127.0.0.1:1880/admin**. The Oracle API uses a Docker
bridge network. Their loopback interfaces are different: setting a URL in the
API environment alone does not connect them. A Mac browser tunnel also does not
make the Pi reachable from the API container.

The supported route is a separately supervised, authenticated SSH forward using
the installation's already authorized private path to the Pi. The forward's
listener must share the **API process's network namespace**. This preserves the
Pi's loopback binding and introduces no public editor port. A missing forward,
wrong runtime identity, unsupported runtime policy, expired credential or storage
failure makes the UI unavailable; the broker never falls back to a public URL.

## Enroll a private gateway

Do this during the gateway's normal maintenance and commissioning process. Use
the existing authorized SSH identity and independently verified host key. This
procedure does not create a new authorized key, firewall source or OT route.

1. Pin a reviewed official Node-RED **4.1.x** image by immutable digest, including
   its architecture and exact version. The transport contract was checked
   against **4.1.4**. Set that exact runtime version in the API configuration;
   `/settings` must report the same value on every preflight and verification.
2. Generate a stable runtime UUID and a distinct random **32-byte hexadecimal
   service token**. Keep the token only in the Pi and API private service
   environments. Never use a `VITE_*` variable or put a token in a URL, flow,
   browser, source checkout or example file. Preserve the UUID when rotating
   credentials so the persistent installation reservation remains associated
   with the same gateway.
3. On the Pi, add `NODE_RED_RUNTIME_ID` and `NODE_RED_ADMIN_TOKEN` to the private
   environment used by `smart-factory-edge/deploy/node-red/compose.yml` and apply
   its reviewed settings during maintenance. Existing editor password login,
   loopback binding, disabled HTTP nodes, MQTT trust boundary and the named
   **`node_red_data:/data`** volume remain in place. Back up the volume and retain
   the existing credential secret before changing the deployment.
4. In the API's private environment (`.env.api` for the Oracle deployment), set:

   ```dotenv
   NODE_RED_INTEGRATION_ENABLED=true
   NODE_RED_MANAGEMENT_ENABLED=true
   NODE_RED_ADMIN_URL=http://127.0.0.1:18880/admin
   NODE_RED_RUNTIME_ID=<the enrolled UUID>
   NODE_RED_RUNTIME_LABEL=<a recognizable gateway name>
   NODE_RED_RUNTIME_VERSION=<the exact reviewed 4.1.x version>
   NODE_RED_ADMIN_TOKEN=<the dedicated 64-character hexadecimal token>
   ```

   `PUBLIC_DEMO_DEPLOYMENT` and `ENABLE_DEMO_ACCOUNTS` must both be false. Only a
   literal IPv4/IPv6 loopback URL with an explicit port and `/admin` path is
   accepted. Credentials, query strings, fragments and browser-selected hosts
   are rejected. The runtime label accepts letters, digits, spaces, dots,
   underscores and hyphens, up to 80 characters.

5. Establish the private forward in the API network namespace as below. Confirm
   the UI reports the expected runtime UUID, label and exact version before
   reviewing a package. The runtime UUID response header is checked on every
   Node-RED API response; a different gateway is refused.

### Oracle container forwarding

The optional overlay
[`deploy/oracle/compose.node-red-management.yaml`](../deploy/oracle/compose.node-red-management.yaml)
adds an SSH client with `network_mode: service:api`. It publishes no ports,
mounts only its dedicated SSH configuration read-only, runs as a non-root UID,
and has no Docker socket, additional capabilities or writable application
credentials. It forwards `127.0.0.1:18880` **inside the API namespace** to
`127.0.0.1:1880` on the Pi. SSH retains strict host-key checking, batch mode,
explicit identities, forwarding failure detection and connection keepalives.

Prepare a private directory containing only the authorized identity,
verified `known_hosts` and a minimal configuration for `Host node-red-gateway`.
The configuration must refer to the mounted paths:

```sshconfig
Host node-red-gateway
    HostName <existing trusted private Pi address>
    User <existing authorized gateway user>
    IdentityFile /run/node-red-ssh/identity
    UserKnownHostsFile /run/node-red-ssh/known_hosts
    ForwardAgent no
    StrictHostKeyChecking yes
    IdentitiesOnly yes
```

Do not copy a whole SSH home directory or add other forwarding directives. The
selected non-root UID must be able to read its identity file with private file
permissions. If the trusted route uses a bastion or a private-network client,
review and qualify that existing route explicitly; this overlay does not create
or authenticate one.

In the private Compose interpolation environment, set
`NODE_RED_SSH_CLIENT_IMAGE` to a reviewed image **at a digest** that supplies the
OpenSSH client, `NODE_RED_SSH_CLIENT_UID` to its non-root `uid:gid`, and
`NODE_RED_SSH_CONFIG_DIR` to that private directory's absolute host path. After
the normal API release and route review:

```sh
docker compose --env-file .env -f compose.yaml \
  -f compose.node-red-management.yaml --profile node-red-management config --quiet
docker compose --env-file .env -f compose.yaml \
  -f compose.node-red-management.yaml --profile node-red-management \
  up -d --no-deps node-red-admin-tunnel
```

These are operator actions; the release helper does not automatically invoke
them. Recreate the tunnel after an API container replacement so it joins the new
network namespace. A normal deployment using `--remove-orphans` without the
overlay may remove this optional service; restore the reviewed overlay and
verify connectivity after such a release. Never compensate by binding the Pi
editor to `0.0.0.0` or broadening the broker's URL validation.

For an API running directly on an approved host, use the same existing trusted
SSH configuration and a supervised forward bound to that API host's loopback:

```sh
ssh -N -T -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18880:127.0.0.1:1880 node-red-gateway
```

## Review and installation behavior

The administrator enters an npm package name and an exact semantic version.
The broker reads that version's public npm metadata and requires declared
`node-red.nodes` or `node-red.plugins`. Registry metadata is identification,
not a code/security assessment. The administrator reviews the package and
gateway compatibility, then acknowledges that its code will execute with the
gateway's permissions and may affect existing flows or connected devices.

The approval is signed and binds the individual administrator, package, exact
version and configured runtime revision for ten minutes. Changing any selection
requires a new review. URLs, filesystem directories, archives, npm aliases,
shell input, tags such as `latest` and version ranges are rejected. The browser
cannot supply credentials, a destination, an npm command or additional installer
options. General Function-node dependencies and saved flow libraries are outside
this package-management route and require their separate reviewed flow change.

A short PostgreSQL transaction checks the administrator's current account and
reserves the runtime under an advisory lock. It persists the request before the
background worker can send **one** `POST /admin/nodes` request containing only
`module` and `version`. The same request ID is idempotent, and concurrent API
replicas cannot reserve another install for that runtime while the first is
pending or unconfirmed. The account is checked again immediately before the
POST. No process startup or polling request automatically replays an install.

Ordinary management requests have an eight-second deadline. Installation has a
two-minute response deadline. Responses are limited to one MiB, redirects are
refused, and upstream bodies/errors are not copied into the UI or audit records.
The original request may continue inside Node-RED after a network timeout; an
HTTP deadline does not cancel npm safely.

After the POST succeeds, the broker verifies the enrolled runtime again and
reads the selected module's exact version, pending version and reported errors.
It records success only when the expected version is present without a pending
update or reported load error. This verifies runtime inventory; it does not
prove a node is enabled, physically commissioned or operating correctly.
Package activation can execute code even without a flow-deployment request.

The dedicated Node-RED token has only `nodes.read`, `nodes.write`, `plugins.read`
and `settings.read`. The broker exposes no flow-write, package-removal, enable,
disable, restart or update action. When management is enrolled, Node-RED's own
palette policy disallows upgrades and archive uploads, including a race with an
editor install. Existing packages require a separate maintenance review.

Packages and lockfiles are installed by Node-RED in its existing `/data`
userDir. Compose fixes npm to the public registry, enables exact saved versions
and retains the lockfile. Preserve the complete volume, flow credential secret
and reviewed image together in backups. This is an initial exact package pin;
the npm dependency tree and code still require normal supply-chain review.

## Pending or unconfirmed operations

The latest operation and immutable request identity are stored in the existing
PostgreSQL `system_settings` table. They survive API/container restarts. Changing
the gateway credential does not erase its reservation. Operations do not expire
into a retryable state just because another API process starts.

Use **Check installation outcome** to perform a read-only reconciliation. During
the initial response window the UI asks the administrator to wait. Afterwards,
an exact version with no pending update/reported error can confirm current
inventory. An absent module, changed enrollment, incomplete install or further
connection failure leaves the operation pending/unconfirmed and blocks another
install. A successful POST followed by a failed authenticated read-back also
remains unconfirmed.

If read-back cannot resolve the outcome, the gateway operator must inspect the
Node-RED/npm process, logs, volume and package lock during an authorized
maintenance window. Recover or roll back the gateway from its retained state as
appropriate. Do not delete the reservation or restart an installation merely
because the HTTP request timed out. Once the operator has established that no
installer remains active and the runtime is consistent, retain that evidence
and resolve the matching operation in both its runtime and request records in
a reviewed database maintenance transaction. The UI deliberately has no generic
“force unlock” or automatic retry button.

## Source and qualification references

- [Official Node-RED POST /nodes](https://nodered.org/docs/api/admin/methods/post/nodes/)
  documents the `nodes.write` installation boundary. It also permits directories,
  which this broker rejects.
- [Node-RED 4.1.4 Admin API source](https://github.com/node-red/node-red/blob/4.1.4/packages/node_modules/@node-red/editor-api/lib/admin/nodes.js)
  passes the separate `req.body.version` to the runtime installer; the public
  method page omits this field.
- [Node-RED 4.1.4 registry](https://github.com/node-red/node-red/blob/4.1.4/packages/node_modules/@node-red/registry/lib/registry.js)
  returns module version, pending version, nodes and plugins for read-back.
- [Node-RED authentication and permissions](https://nodered.org/docs/user-guide/runtime/securing-node-red)
  describes custom tokens and resource permissions.
- [npm save-exact configuration](https://docs.npmjs.com/cli/using-npm/config/#save-exact)
  describes exact persisted dependency versions.

Run `pnpm exec vitest run server/node-red`, `pnpm check` and `pnpm build` from
`smart-factory-frontend`. The PostgreSQL reservation tests require the existing
explicit disposable localhost `TEST_DATABASE_URL` ending in `_e2e`; they never
target the production database. The hosted quality workflow provides this
database. The transport fixtures use synthetic responses and do not install a
package on any production runtime. A real gateway, private SSH route and exact
reviewed Node-RED image still require commissioning before this optional
integration is activated.
