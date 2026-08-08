# `database` namespace — pgAdmin + nao + postgres-mcp

Clients that read the platform databases. Nothing here owns data. They sit
in `infrastructure/services` rather than `apps/` for the same reason
`ai-gateway` does: they serve every project and belong to none.

```
database ns
├── pgadmin   dpage/pgadmin4      SQL client            https://pgadmin.tail45b0ca.ts.net
├── nao       getnao/nao          analytics agent       https://nao.tail45b0ca.ts.net
├── postgres-mcp-fbref    ┐
├── postgres-mcp-asp      ├ crystaldba/postgres-mcp  MCP servers, ONE PER DATABASE
├── postgres-mcp-scraper  ┘                          (no ingress — via ai-gateway)
└── dbtools-db  CNPG (1 instance) their own state: db `pgadmin` + db `nao`
```

pgAdmin and nao each hold all three DSNs. The postgres-mcp instances deliberately
do not — see [Postgres MCP Pro](#postgres-mcp-pro).

All three live in **this one directory** — cluster and tools together. The
`databases/` tier here groups every `infrastructure/services` database, and
these tools ARE the database tooling, so unlike keycloak and ai-gateway (whose
workloads sit a tier up from their clusters) there is nothing to split off.
Nothing is lost by co-locating: `infrastructure/services/staging` is a **single**
Flux Kustomization, so `databases/` is a plain directory here — not the
separately-ordered unit `apps/staging/databases` is, which `db-migrations` and
`apps` `dependsOn`.

Reads, across namespaces:

| target  | host                                      | database   |
| ------- | ----------------------------------------- | ---------- |
| asp     | `asp-db-ro.asp.svc.cluster.local`         | automarket |
| fbref   | `fbref-db-ro.fbref.svc.cluster.local`     | fbref      |
| scraper | `scraper-db-ro.scraper.svc.cluster.local` | scraper    |

## Tailnet exposure

Both UIs are published by the **Tailscale operator** as an `Ingress`
(`ingressClassName: tailscale`), not by the `tailscale.com/expose` Service
annotation they used to carry:

```
https://pgadmin.tail45b0ca.ts.net    pgadmin-ingress-tailscale.yaml
https://nao.tail45b0ca.ts.net        nao-ingress-tailscale.yaml
```

`expose` is an L3 forward that preserves the Service port, so it served two
password-authenticated consoles over plain http on `:80` / `:5005`. The Ingress
terminates TLS at the proxy on 443 with a **MagicDNS-issued certificate** — no
cert-manager `Certificate`, no DNS record, no port in the URL — which is the
same call `keycloak-admin` and `ai-gateway` make.

Consequences worth knowing:

- **PRECONDITION:** *HTTPS Certificates* must be enabled in the Tailscale admin
  console (DNS → HTTPS Certificates). Without it the proxy comes up with no
  certificate and both UIs are unreachable.
- The Services carry **no** tailscale annotations. Both mechanisms at once
  register two devices contending for one hostname and the loser is suffixed
  (`nao-1`) — which for nao is exactly the `BETTER_AUTH_URL` mismatch below.
- `BETTER_AUTH_URL` (`nao-env-patch.yaml`) must equal the browser address byte
  for byte, so it is `https://nao.tail45b0ca.ts.net` — **no port**. It moves
  with the Ingress, never on its own.
- Migrating off `expose`: the old `nao` / `pgadmin` devices must be gone from
  the Tailscale admin console before the Ingress proxies register, or MagicDNS
  hands the new ones a suffixed name. Check `kubectl -n tailscale get pods` and
  the Machines page.

Tailnet identity is still the only authentication in front of either UI —
see below.

## Secrets

Every `*.enc.yaml` here has a committed `*.enc.yaml.example` beside it: the same
manifest with placeholder values and a header saying where the value comes from.
Fill the copy, then encrypt it — `.sops.yaml` selects the age key by **path**
(`staging/*.enc.yaml`), which the `.example` suffix does not match, so a template
is never encrypted and must never hold a real value.

```bash
cd infrastructure/services/staging/databases/dbtools
cp nao-secrets.enc.yaml.example nao-secrets.enc.yaml
$EDITOR nao-secrets.enc.yaml                      # fill the placeholders
sops --encrypt --in-place nao-secrets.enc.yaml    # staging age key, by path
```

| secret | value | source |
| --- | --- | --- |
| `pgadmin-admin` | `email` + `password` | chosen here; email also names the pgpass storage dir |
| `nao-secrets` | `better-auth-secret` | `openssl rand -base64 32`, generated once and never rotated casually |
| `nao-ai-gateway-token` | `AI_GATEWAY_TOKEN` | created in the ai-gateway dashboard, only stored here |

Edit an existing one in place with `sops <file>` (re-encrypts on save); read one
back with `sops -d <file>`.

## Why this is read-only

Every tool here authenticates as the cluster's `app` OWNER role, mirrored in by
kubernetes-reflector from `<project>/<project>-db-app`. What makes that safe is
the **host**: every connection targets the CNPG `-ro` service, which selects
replicas only. A replica is in recovery and rejects any write with SQLSTATE
25006 — no grant, no NetworkPolicy and no UI setting is in that path.

The rw and ro Services select the **same pods**, so the NetworkPolicies cannot
express "replica only". Anyone who can reach pgAdmin on the tailnet can register
`<cluster>-rw` by hand and write. **Tailnet membership is therefore write
access.** If that stops being acceptable, the replacement is a per-database
read-only role (`analytics_ro`, NOLOGIN in Flyway + CNPG `managed.roles` + a
sops Secret each), not a network rule.

Reflection is permitted per source cluster in
`apps/staging/databases/<project>/cluster-reflector-patch.yaml`; nothing is
auto-mirrored — a secret lands here only because a stub in
`../../../base/databases/dbtools/db-reflect-stubs.yaml` names it. Those source clusters live
in the **apps** tier, which reconciles after this one, so on a first-ever
install the pods restart until the credentials arrive.

## LLM access

nao calls **ai-gateway** and nothing else. Its `nao_config.yaml` holds exactly
**one** provider entry — the gateway — so no vendor is named anywhere in this
namespace. `provider: openai` there is the wire protocol, not a vendor.

Nothing is mirrored in: `NAO_LLM_BASE_URL` is the gateway's Service DNS name
(set in the Deployment) and the credential is nao's own virtual key in
`nao-ai-gateway-token.enc.yaml`. The NetworkPolicy allows the `ai-gateway`
namespace on 8080 and nothing else outbound — the agent has no route to the
internet, or to any provider.

The model picker offers **four capability tiers**, not models:

| alias | tier |
| --- | --- |
| `ai/low` | cheapest / fastest |
| `ai/normal` | the default |
| `ai/high` | harder work |
| `ai/xhigh` | the most capable available |

Which vendor and which model answers each one is a **routing rule in the
ai-gateway dashboard**. Re-pointing a tier is a dashboard edit: no change here,
no commit, no restart. Naming the tiers after capability rather than after a
vendor's model (`ai/sonnet`) is what keeps the vendor out of nao's config.

**Each alias must exist as a routing rule before it is selected** — an alias no
rule matches is rejected as an unknown model, because every OpenAI-compatible
request carries its model id in the body and a client cannot discover these
from the gateway.

The key ref is `optional: true`, so a missing or invalid key costs chat, not the
pod. A revoked key fails at call time with
`401 virtual_key_not_found`; a wrong alias fails as an unknown model. Reproduce
either without the UI:

```bash
kubectl -n database exec deploy/nao -- sh -c \
  'curl -s -H "Authorization: Bearer $NAO_LLM_API_KEY" $NAO_LLM_BASE_URL/v1/models'
```

## Postgres MCP Pro

`crystaldba/postgres-mcp` — schema exploration, read-only SQL, `EXPLAIN` and
database-health checks, exposed as MCP tools so an LLM client can query the
platform databases. Reached through **ai-gateway**, never directly: no Ingress
and no tailnet name.

**One instance per database, and that is the whole design.** The server binds a
single connection pool at startup and exposes no tool to switch database, so the
fbref instance cannot read asp even if asked to:

| instance | `project` label | database |
| --- | --- | --- |
| `postgres-mcp-fbref` | `fbref` | `fbref-db-ro.fbref` / `fbref` |
| `postgres-mcp-asp` | `asp` | `asp-db-ro.asp` / `automarket` |
| `postgres-mcp-scraper` | `scraper` | `scraper-db-ro.scraper` / `scraper` |

Three independent layers hold that:

1. **One DSN per pod** — pinned in `postgres-mcp-deployments.yaml`.
2. **Per-instance egress NetworkPolicy** — each pod may reach only its own
   `cnpg.io/cluster` on 5432, plus DNS. Unlike pgAdmin and nao, whose policies
   list all three clusters. This is what turns "configured for fbref" into "can
   only reach fbref".
3. **Per-virtual-key scoping in the ai-gateway dashboard** — see below.

The **write** boundary is the same as everything else here and is described in
[Why this is read-only](#why-this-is-read-only): these authenticate as the `app`
OWNER role, and the guarantee comes from the `-ro` replica, not the grant.
`--access-mode=restricted` wraps every statement in a read-only transaction on
top of that.

### Which project a pod serves

Four places say it, and they must agree — three identical containers in one
namespace is exactly where a mislabelled pod costs an afternoon:

```bash
kubectl -n database get pods -l project=fbref        # the label
kubectl -n database get deploy | grep postgres-mcp   # the object name
kubectl -n database describe pod -l project=asp | grep PROJECT   # the env marker
```

and the Bifrost client name `postgres_<project>`, which puts the project into
every tool name the model sees (`postgres_fbref-execute_sql`).

### Registering them in ai-gateway

Config lives in the dashboard, not in git — the same rule as everything else in
`ai-gateway` (`sourceOfTruth: split`; git owns the infrastructure, the UI owns
the configuration). At **MCP Gateway → New MCP Server**, three times:

| field | value |
| --- | --- |
| name | `postgres_fbref` / `postgres_asp` / `postgres_scraper` |
| connection type | `sse` |
| connection string | `http://postgres-mcp-<project>.database.svc.cluster.local:8000/sse` |
| auth type | `none` |
| allow on all virtual keys | off |
| tools to execute | `list_schemas, list_objects, get_object_details, execute_sql, explain_query, analyze_db_health` |

**`bifrost.mcp` is absent from `release.yaml`, and that is not an oversight.**
The chart renders an `mcp` section into `config.json` only when
`bifrost.mcp.enabled` is true, so the config mounted in the pod has none — yet
the admin API's MCP routes are live, because they are gated on the CONFIG STORE
(enabled here) and not on that section. `GET /api/mcp/clients` answering **401
rather than 404 or 503** is how you tell those two apart. Clients added in the
dashboard land in Postgres and survive restarts like every other setting, so
nothing about MCP needs to enter git.

Four things the form will not tell you:

- **A hyphen in the name is rejected with a 400** — so are spaces, non-ASCII and
  a leading digit (`ValidateMCPClientName`). Underscores are mandatory, not a
  style choice, which is just as well: the request-header filter format is
  `clientName-toolName`, so a hyphen would make that filter ambiguous too.
- **An empty tools list means NO tools, not all of them.** `["*"]` is all, `[]`
  is none, and omitting the field is treated as `[]`.
- **Auth type defaults to `headers`, not `none`.** Set it explicitly or the
  client cannot connect.
- **Leave "allow on all virtual keys" off.** It defaults off, and that default
  IS the isolation — a client is reachable only from keys that name it.

The same thing over the API. Auth is **HTTP Basic** with the `ai-gateway-admin`
credential; a Bearer token is rejected:

```bash
kubectl -n ai-gateway port-forward svc/ai-gateway 8080:8080 &
AU=$(kubectl -n ai-gateway get secret ai-gateway-admin -o jsonpath='{.data.username}' | base64 -d)
AP=$(kubectl -n ai-gateway get secret ai-gateway-admin -o jsonpath='{.data.password}' | base64 -d)

curl -s -u "$AU:$AP" localhost:8080/api/mcp/clients
curl -s -u "$AU:$AP" -X POST localhost:8080/api/mcp/client -H 'Content-Type: application/json' -d '{
  "name": "postgres_fbref",
  "connection_type": "sse",
  "connection_string": "http://postgres-mcp-fbref.database.svc.cluster.local:8000/sse",
  "auth_type": "none",
  "allow_on_all_virtual_keys": false,
  "tools_to_execute": ["list_schemas","list_objects","get_object_details","execute_sql","explain_query","analyze_db_health"]
}'
```

Also `PUT /api/mcp/client/{id}`, `DELETE /api/mcp/client/{id}` and
`POST /api/mcp/client/{id}/reconnect`.

Then scope access **per virtual key** — a VK's `mcp_configs` should name only
the clients that key may use, and a VK with no MCP config gets no MCP tools at
all. Rely on VK filtering rather than the `x-bf-mcp-include-clients` request
header: the header does enforce execution, but still *lists* every client's
tools (maximhq/bifrost#1697).

No NetworkPolicy change is needed on the ai-gateway side — that namespace has no
policy and its egress is unrestricted. The path is granted by the **ingress**
rule in `postgres-mcp-networkpolicies.yaml`, which admits the `ai-gateway`
namespace and nothing else; that rule exists because the SSE endpoint has no
authentication of its own.

### Which tools actually work

Six of the nine. The three missing ones are environment, not configuration:

| tool | |
| --- | --- |
| `list_schemas`, `list_objects`, `get_object_details` | works |
| `execute_sql` (read-only) | works |
| `explain_query` | works — plain `EXPLAIN`, no `ANALYZE` |
| `analyze_db_health` | partial — `app` is DB owner, not superuser, so some checks report less |
| `get_top_queries`, `analyze_workload_indexes` | **fail** — need `pg_stat_statements`, in no cluster's `shared_preload_libraries` |
| `analyze_query_indexes` | **fail** — needs the `hypopg` extension, not bundled in the CNPG operand image |

Unblocking the last three is not a small edit: `shared_preload_libraries` on each
CNPG Cluster (a rolling Postgres restart), `CREATE EXTENSION` as superuser,
connecting to `-rw` instead of `-ro` (a replica's statistics only cover the
replica's own read traffic), and a custom operand image for `hypopg`. Listing the
six in `tools_to_execute` above keeps agents from burning turns on tools that
always error.

### Operating notes

- **The pod does not listen until the database is reachable.** postgres-mcp
  completes its pool connect before starting the transport, so a pod that cannot
  reach its replica never binds :8000 and never goes Ready. That makes the TCP
  probe a real DB gate — and is why liveness is slack (5 min) rather than tight:
  a DB restart should shed traffic, not start a restart loop.
- Confirm a healthy start by the log line, not by the pod being up:
  ```bash
  kubectl -n database logs deploy/postgres-mcp-fbref | grep -E "RESTRICTED|Successfully connected"
  ```
  On a bad DSN it logs a warning and keeps serving nothing — treat a missing
  `Successfully connected to database` as failure.
- The image ships **no `USER`** and runs as root by default. The Deployment
  overrides that: `runAsNonRoot` + `runAsUser: 1000` at both pod and container
  level, `readOnlyRootFilesystem`, all capabilities dropped, no privilege
  escalation, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken:
  false` and `enableServiceLinks: false` — it meets the Pod Security
  "restricted" profile. Two consequences of the read-only rootfs: it needs an
  `emptyDir` at `/tmp` **and** `HOME=/tmp`, or python has nowhere to write.
  (The namespace is not labelled `pod-security.kubernetes.io/enforce:
  restricted`, because nao legitimately runs as root with `SETUID`/`SETGID`.
  These three are hardened individually, not by an admission rule.)
- Transport is `sse`, not streamable-http: `main` has carried streamable-http
  since 2026-01-22 but no release ships it, and the tag here is pinned to the
  latest release (`0.3.0`).

## Where state lives

| what                                     | where                                   |
| ---------------------------------------- | --------------------------------------- |
| pgAdmin users / saved servers / prefs     | `pgadmin` database on `dbtools-db`      |
| pgAdmin sessions + pgpass                 | pod emptyDir (rebuilt each start)       |
| nao users / sessions / chat history       | `nao` database on `dbtools-db`          |
| nao project: `nao_config.yaml` + context  | PVC `nao-project` at `/app/project`     |

`dbtools-db` carries **no backup**: losing it costs a re-login and a re-import
of `servers.json`, not data.

## First run

**pgAdmin** — log in with the credentials in `pgadmin-admin.enc.yaml`
(`sops -d infrastructure/services/staging/databases/dbtools/pgadmin-admin.enc.yaml`). The
three servers are pre-registered and connect with no password prompt: the init
container writes a `pgpass` from the reflected CNPG secrets on every start, so a
credential rotation needs only
`kubectl -n database rollout restart deploy/pgadmin`.

`servers.json` is imported **once per user**. Editing the ConfigMap later does
not re-import — delete the server in the UI first.

**nao** — the first visitor self-registers and becomes admin; everyone after is
invited from the UI. Then build the context:

```bash
kubectl -n database exec -it deploy/nao -- nao sync
```

## Changing nao's config

`../../../base/databases/dbtools/nao-config-configmap.yaml` is a **seed**: the init container
copies it in with `cp -n`, so it only applies to an empty project directory.
That is deliberate — `nao init` / `nao sync` inside the pod write to the same
file, and a ConfigMap that overwrote on every boot would silently discard them.

```bash
# edit in place (survives restarts, not in git)
kubectl -n database exec -it deploy/nao -- sh -c 'vi /app/project/nao_config.yaml'

# re-seed from git (discards the pod's copy)
kubectl -n database exec deploy/nao -- rm /app/project/nao_config.yaml
kubectl -n database rollout restart deploy/nao
```

The connection blocks use nao's `{{ env('...') }}` interpolation against the env
vars the Deployment injects, so no password is ever written into the project
volume or into git.

The image publishes no semver tags — `nao-deployment.yaml` pins a commit tag
(`getnao/nao:b325bba`, app 0.3.3). Renovate cannot bump that; move it by hand.
