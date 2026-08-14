# dbtools — the `database` namespace (pgAdmin + nao + postgres-mcp)

`dbtools` is the whole `database` namespace: three clients that read the platform
databases, plus the small CNPG cluster that holds their own state. Nothing here
owns project data. pgAdmin is a SQL client, nao is an analytics agent, and
`postgres-mcp` exposes schema exploration and read-only SQL as MCP tools for LLM
clients. They sit in `infrastructure/services` rather than `apps/` for the same
reason `ai-gateway` does: they serve every project and belong to none.

```
database ns
├── pgadmin   dpage/pgadmin4      SQL client            https://pgadmin.tail45b0ca.ts.net
├── nao       getnao/nao          analytics agent       ts.net + nao.eliorion.fr
├── postgres-mcp-fbref    ┐
├── postgres-mcp-asp      ├ crystaldba/postgres-mcp  MCP servers, ONE PER DATABASE
├── postgres-mcp-scraper  ┘                          (no ingress — via ai-gateway)
└── dbtools-db  CNPG (1 instance) their own state: db `pgadmin` + db `nao`
```

pgAdmin and nao each hold all three DSNs. The postgres-mcp instances deliberately
do not — see [Postgres MCP Pro](#postgres-mcp-pro).

Reads, across namespaces — always the CNPG `-ro` replica service:

| target  | host                                      | database   |
| ------- | ----------------------------------------- | ---------- |
| asp     | `asp-db-ro.asp.svc.cluster.local`         | automarket |
| fbref   | `fbref-db-ro.fbref.svc.cluster.local`     | fbref      |
| scraper | `scraper-db-ro.scraper.svc.cluster.local` | scraper    |

## How it is wired

### `base/databases/dbtools/`

| file | what it is |
| --- | --- |
| `kustomization.yaml` | the namespace whole: cluster + all three clients |
| `namespace.yaml` | ns `database`, labelled `name: database` so NetworkPolicies in other namespaces can select it (the reflector allow-lists match the namespace *name*, not this label) |
| `db-reflect-stubs.yaml` | three empty Secrets that kubernetes-reflector fills from `asp/asp-db-app`, `fbref/fbref-db-app`, `scraper/scraper-db-app` |
| `cluster.yaml` | CNPG `dbtools-db`, 1 instance, 5Gi, `initdb` bootstraps the `nao` database |
| `pgadmin-database.yaml` | CNPG `Database` CR creating the `pgadmin` database on the same cluster, `databaseReclaimPolicy: retain` |
| `pgadmin-servers-configmap.yaml` | `servers.json` — the three servers pgAdmin pre-registers (`PGADMIN_SERVER_JSON_FILE`) |
| `pgadmin-deployment.yaml` | pgAdmin 4 + a busybox init container that writes the `pgpass` |
| `pgadmin-service.yaml` | ClusterIP `pgadmin:80` → container port 5050 |
| `pgadmin-networkpolicy.yaml` | egress: four CNPG clusters on 5432 + DNS |
| `nao-config-configmap.yaml` | seed `nao_config.yaml` — databases and the LLM provider block |
| `nao-pvc.yaml` | `nao-project`, RWO 5Gi, mounted at `/app/project` |
| `nao-deployment.yaml` | nao + a busybox init container that seeds the project dir with `cp -n` |
| `nao-service.yaml` | ClusterIP `nao:5005` |
| `nao-networkpolicy.yaml` | egress: four CNPG clusters on 5432, DNS, and ns `ai-gateway` on 8080 |
| `postgres-mcp-deployments.yaml` | the three `postgres-mcp-<project>` Deployments |
| `postgres-mcp-services.yaml` | one ClusterIP each on 8000 |
| `postgres-mcp-networkpolicies.yaml` | one policy each: ingress from ns `ai-gateway` on 8000, egress to that project's cluster only |

The three postgres-mcp files are grouped by kind rather than by project: the
three documents in each file differ only in the project name, secret, host and
database, which is easiest to review side by side.

### Overlays

`staging/databases/dbtools/` sets `namespace: database`, pulls in the base, and
adds:

| file | what it is |
| --- | --- |
| `pgadmin-admin.enc.yaml` | pgAdmin's own login (server mode) — `email` + `password` |
| `nao-secrets.enc.yaml` | `better-auth-secret`, nao's session-signing key |
| `nao-ai-gateway-token.enc.yaml` | `AI_GATEWAY_TOKEN`, nao's own ai-gateway virtual key |
| `pgadmin-ingress-tailscale.yaml` | Tailscale `Ingress` → `https://pgadmin.tail45b0ca.ts.net` |
| `nao-ingress-tailscale.yaml` | Tailscale `Ingress` → `https://nao.tail45b0ca.ts.net` |
| `cluster-storage-patch.yaml` | JSON patch adding `storageClass: longhorn` to `dbtools-db` (explicit — also the cluster default SC on Talos) |
| `nao-env-patch.yaml` | strategic merge on the nao Deployment: `BETTER_AUTH_URL` + `BETTER_AUTH_TRUSTED_ORIGINS` |

There is no production overlay. `nao-env-patch.yaml` is the only
environment-specific piece of configuration: env entries merge by `name`, so
only those two variables are replaced. The LLM settings are not in the overlay —
the gateway's Service DNS name and the tier aliases are identical in every
environment, so they sit in the base Deployment and the base ConfigMap.

Each `*.enc.yaml` has a committed `*.enc.yaml.example` beside it: the same
manifest with placeholder values and a header saying where the value comes from.

### Exposure

```
pgadmin   https://pgadmin.tail45b0ca.ts.net   tailnet
nao       https://nao.tail45b0ca.ts.net       tailnet
          https://nao.eliorion.fr             public, behind Cloudflare Access
```

Both base Services are plain ClusterIP with **no** tailscale annotations, so the
base objects are reachable by port-forward alone:

```bash
kubectl -n database port-forward svc/pgadmin 5050:80
kubectl -n database port-forward svc/nao 5005:5005
```

The public nao route is the Cloudflare tunnel, which targets
`http://nao.database.svc.cluster.local:5005` by cluster DNS. The route and the
Access application are dashboard-managed (the tunnel is token-managed) and
written down in [`../../../staging/cloudflare/README.md`](../../../staging/cloudflare/README.md);
the Keycloak `staging-apps` realm that fronts it is in git at
[`../../keycloak/realm/realm-apps.yaml`](../../keycloak/realm/realm-apps.yaml).

## Why it is like this

### One directory for the cluster and its clients

Unlike keycloak and ai-gateway — whose databases sit in this tier while the
workload sits a tier up — the workload here *is* database tooling, so splitting
it would buy a second directory and nothing else. `infrastructure/services/staging`
is a **single** Flux Kustomization, so `databases/` is a plain directory here,
not the separately-ordered unit `apps/staging/databases` is (which
`db-migrations` and `apps` `dependsOn`).

### `dbtools-db`: one instance, two databases, no backup

The cluster is a metadata store for the tools, not project data. pgAdmin keeps
its users, saved servers and preferences there; nao keeps its users, sessions and
chat history. Both are useless without the tool that wrote them, so they share
one small cluster instead of one each.

One instance on purpose: there is no read-only consumer to serve from a replica,
and losing the cluster costs a re-login plus a re-import of `servers.json`, not
data. That is also why it carries no `ScheduledBackup`, while the asp/fbref
clusters do — they hold irreplaceable scrapes. See
[`../../../../../documentations/03-backups.md`](../../../../../documentations/03-backups.md),
which lists `dbtools-db` as a scratch database, and
[`../../../../../documentations/09-etcd-backup-dr.md`](../../../../../documentations/09-etcd-backup-dr.md)
for what an unbacked cluster means in a disaster-recovery case.

`initdb` can bootstrap exactly one database (`nao`), so pgAdmin's is created
beside it by a CNPG `Database` CR — the only declarative way to get a second one
on the same cluster. The two tools must not share a schema namespace: both run
their own migrations at startup, into `public`.

### Why this is read-only

Every tool here authenticates as the cluster's `app` OWNER role, mirrored in by
kubernetes-reflector from `<project>/<project>-db-app`. What makes that safe is
the **host**: every connection targets the CNPG `-ro` service, which selects
replicas only. A replica is in recovery and rejects any write with SQLSTATE
25006 — no grant, no NetworkPolicy and no UI setting is in that path.

The rw and ro Services select the **same pods**, so the NetworkPolicies cannot
express "replica only". Anyone who reaches either UI can point it at
`<cluster>-rw` by hand and write. **Reaching a UI is therefore write access to
all three project databases.**

For pgAdmin that gate is tailnet membership. nao now has **two** gates, and the
weaker of the two is what counts: tailnet membership as before, OR a Keycloak
account in the `staging-apps` realm plus a nao account — the second being an
internet-facing path, which raises the stakes of that unchanged credential. nao
connects as each cluster's `app` OWNER role and executes model-authored SQL. The
known fix is still the same one, and it has not been done: a per-database
read-only role (`analytics_ro`, NOLOGIN in Flyway + CNPG `managed.roles` + a sops
Secret each), not a network rule. Until it exists, treat `apps`-realm membership
as production write access and keep the Access policy an explicit email allowlist.

Reflection is permitted per source cluster in
`apps/staging/databases/<project>/cluster-reflector-patch.yaml`; nothing is
auto-mirrored — a secret lands here only because a stub in `db-reflect-stubs.yaml`
names it, which is what keeps the `-ca` / `-server` / `-replication` secrets in
their own namespace. Those source clusters live in the **apps** tier, which
reconciles after this one, so on a first-ever install the pods restart until the
credentials arrive.

### pgAdmin

Its own state goes to the `pgadmin` database on `dbtools-db`, not to the
`/var/lib/pgadmin` volume. With the config DB external the volume holds only
sessions and the pgpass file, so it can be an `emptyDir` and a rescheduled pod
costs one re-login, nothing more. Sessions live on that emptyDir, which is why
`strategy: Recreate` and one replica — never run two.

The init container builds the pgpass the `servers.json` `PassFile` entries point
at, from the reflected CNPG credentials, at every start. Consequences: no project
password is ever persisted in pgAdmin's config database, and a CNPG credential
rotation is picked up by a pod restart alone.

`PassFile` is resolved relative to the pgAdmin storage directory of the logged-in
user (`/var/lib/pgadmin/storage/<email with @ -> _>/`), which is why the leading
`/` in `servers.json` is not a filesystem root. pgAdmin maps `@` to `_` and leaves
dots alone (`dev@example.fr` -> `dev_example.fr`); the init container's `tr '@' '_'`
matches that.

Other settings:

- `PGADMIN_LISTEN_PORT: 5050` — the container runs as uid 5050 with every
  capability dropped, so it cannot bind the image's default port 80.
- `PGADMIN_DISABLE_POSTFIX: true` — there is no mail container in this pod, and
  without it the entrypoint waits on a Postfix that will never come up.
- `PGADMIN_CONFIG_UPGRADE_CHECK_ENABLED: False` — the version check is the only
  thing pgAdmin would reach the internet for. Disabled, it is a SQL client and
  nothing else, which is why the egress policy carries **no 443 rule** at all.
- `PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: False` — saved passwords are the only
  thing the master password protects and this deployment stores none (the servers
  use a pgpass file), so the prompt would cost a second secret to gain nothing.
- `readOnlyRootFilesystem: false` — the image writes its runtime config, logs and
  sessions under `/var/lib/pgadmin` **and** regenerates files under `/pgadmin4`
  at boot, so a read-only root filesystem does not survive startup.
- `runAsUser: 5050` is the uid baked into `dpage/pgadmin4`.

### nao

Two stores, deliberately separate: `/app/project` (the PVC) holds
`nao_config.yaml` plus everything `nao sync` writes — schema metadata,
table/column descriptions, rules; `DB_URI` (the `nao` database on `dbtools-db`)
holds users, sessions and chat history, migrated at startup. RWO plus
`strategy: Recreate` means one writer only.

`nao-config-configmap.yaml` is a **seed**: the init container installs it with
`cp -n`, so it only applies to an empty project directory. That is deliberate —
`nao init` / `nao sync` inside the pod write to the same file, and a ConfigMap
that overwrote on every boot would silently discard them. No secret appears in
it: `{{ env('...') }}` is nao's own interpolation, resolved in the pod against
the env vars the Deployment injects from the reflected CNPG secrets.

nao runs as **root**, and it has to. `/etc/supervisor/conf.d/nao.conf` declares
`[supervisord] user=root` with `user=nao` on both programs, so supervisord
refuses to start as anyone else — `Error: Can't drop privilege as nonroot user` —
and then setuids to `nao` per program. Running the pod as uid 1000 was tried and
fails exactly there. `fsGroup: 1000` is what the `nao` user those programs drop
to needs: it makes the `nao-project` PVC (and the seeded `nao_config.yaml`)
group-writable so `nao sync` and MCP tool discovery can write. It is set at pod
level so the init container is covered too.

`SETUID` and `SETGID` are the only two capabilities handed back, and only because
supervisord setuids to `nao` for each program and the entrypoint's
`su nao … test -w` probe does the same; without them the spawn fails and the
probe prints a spurious "not writable" warning. **`DAC_OVERRIDE` is deliberately
not among them.** supervisord's own logfile lives in `/var/log/supervisor`, which
the image ships owned `nao:nao` 0755 — unwritable by a capability-less root,
which crashed every boot with:

```
PermissionError: [Errno 13] Permission denied: '/var/log/supervisor/supervisord.log'
```

An `emptyDir` over that path gives root a directory it owns, so the broadest of
the three capabilities stays dropped. The log is supervisord's own supervision
chatter; both programs already log to `/dev/stdout` and `/dev/stderr`, so nothing
`kubectl` can show is lost by making it ephemeral.

`POSTHOG_DISABLED: true` turns off usage analytics to `eu.i.posthog.com`, which
the NetworkPolicy does not allow — and the client does not give up quietly.
`nao sync` finished its 39 real seconds of work, printed "Sync Complete", then
sat parked on the upload for thirty minutes before it was killed. The same code
runs in the chat process. It is switched off at the source (`nao_core/tracking.py`
reads the variable) because an egress rule for a telemetry endpoint is not the
trade here.

Probes are TCP, not HTTP: the app runs its own DB migrations on boot and serves
no documented health path. `readOnlyRootFilesystem: false` because the image
declares no `USER` and its entrypoint writes inside `/app`.

The image publishes no semver tags — `latest` and commit tags are all there is —
so it is pinned to a commit (`getnao/nao:b325bba`, app 0.3.3) and a restart cannot
silently change the running version.

#### Two front doors

The tailnet Ingress is unchanged; the tunnel adds a public one gated by
**Cloudflare Access with Keycloak (`staging-apps` realm) as the identity provider**.
Four things follow, all load-bearing:

- **`BETTER_AUTH_TRUSTED_ORIGINS` must list every host.** better-auth takes one
  `BETTER_AUTH_URL` and rejects any non-GET from an untrusted Origin with 403
  `INVALID_ORIGIN`, so the second host would refuse every login. The env var in
  `nao-env-patch.yaml` is what makes the pair work. In the running image,
  `dist/context/helpers.mjs` reads it as:

  ```js
  const envTrustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (envTrustedOrigins) trustedOrigins.push(...envTrustedOrigins.split(","));
  ```

  Two consequences of that one line: it is `.split(",")` with **no trim**, so a
  space after the comma produces the origin `" https://…"` and trusts nothing;
  and it **pushes**, so the list adds to `baseURL` rather than replacing it.
  Values are origins — scheme + host, no path, no trailing slash.
- **The browser side needs nothing.** nao's frontend bundle resolves its API base
  from `window.location.origin` (verified in the image, `apps/frontend/dist`), so
  calls are same-origin on whichever host you arrived on.
- **Sessions are per host.** Cookies are scoped to the host that set them, so
  reaching nao the other way means logging in again. Nothing is invalidated —
  better-auth signs sessions with `BETTER_AUTH_SECRET`, and changing either URL
  variable does not touch that.
- **You log in twice on the public path**: Keycloak at the edge, then nao's own
  better-auth form. nao is not an OIDC client — self-hosted `getnao/nao` has
  local accounts only, and SSO is an Enterprise feature — so Keycloak
  authenticates the request; it does not log you into nao. The tailnet path has
  only nao's own login in front of it.

`BETTER_AUTH_URL` is the one canonical address, set to the public one because
that is the address a link is shared as. Server-side it is only the base for
absolute URL construction, and nao has no email verification and no social
provider, so nothing is actually built from it in this deployment.

### Tailnet exposure

Both UIs are published by the **Tailscale operator** as an `Ingress`
(`ingressClassName: tailscale`), not by the `tailscale.com/expose` Service
annotation they used to carry:

```
https://pgadmin.tail45b0ca.ts.net    pgadmin-ingress-tailscale.yaml
https://nao.tail45b0ca.ts.net        nao-ingress-tailscale.yaml
```

`expose` is an L3 forward that preserves the Service port, so it served two
password-authenticated consoles over plain http on `:80` / `:5005` — and for nao
that port then had to be carried in the auth URL. The Ingress terminates TLS at
the proxy on 443 with a **MagicDNS-issued certificate** — no cert-manager
`Certificate`, no DNS record, no port in the URL — which is where the session
cookie belongs, and is the same call `keycloak-admin` and `ai-gateway` make. The
`tls.hosts` entry is the device name; MagicDNS serves it at
`https://<name>.tail45b0ca.ts.net`.

pgAdmin builds its own redirects, so it has to learn the scheme from the proxy.
The tailscale proxy sets `X-Forwarded-Proto` and pgAdmin applies werkzeug's
`ProxyFix` in server mode (`PROXY_X_PROTO_COUNT` defaults to 1), so no extra
`PGADMIN_CONFIG_*` is needed.

Tailnet identity is the only authentication in front of pgAdmin, and the only one
in front of nao on that path.

### LLM access

nao calls **ai-gateway** and nothing else. Its `nao_config.yaml` holds exactly
**one** provider entry — the gateway — so no vendor is named anywhere in this
namespace. Why that entry reads `provider: openai` and why the `/v1` is appended
there is commented on the block itself in
[`nao-config-configmap.yaml`](nao-config-configmap.yaml).

Nothing is mirrored in: `NAO_LLM_BASE_URL` is the gateway's Service DNS name
(set in the Deployment) and the credential is nao's own virtual key in
`nao-ai-gateway-token.enc.yaml`. One key per project, so it can be revoked or
have its spend read off without touching any other consumer, and the ai-gateway
namespace never has to name this one. The NetworkPolicy allows the `ai-gateway`
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
ai-gateway dashboard**, so re-pointing a tier is a dashboard edit: no change
here, no commit, no restart. The naming rule — capability, never a vendor's
model — is argued at the `llm:` block in
[`nao-config-configmap.yaml`](nao-config-configmap.yaml).

There is no model env var: a single env var cannot express a list, and the
aliases are neither secret nor environment-specific, so they are listed in
`nao_config.yaml` directly.

The key ref is `optional: true`, so a missing or invalid key costs chat, not the
pod.

### Postgres MCP Pro

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

The ingress rule is declared here and nowhere else in this namespace, and it is
earned: the SSE endpoint has no authentication of its own and `execute_sql` reads
the whole database, so without a rule any pod in the cluster could query it.
`name: ai-gateway` is the label on the ai-gateway namespace, the same selector
`nao-networkpolicy.yaml` uses in the other direction. No NetworkPolicy change is
needed on the ai-gateway side — that namespace has no policy and its egress is
unrestricted. Note that `kubectl port-forward` originates from the kubelet, not
from a pod, so it is not covered by the ingress rule; debugging still works.

Hardening: the image ships **no `USER`** and runs as root by default. The
Deployment overrides that with `runAsNonRoot` + `runAsUser: 1000` at both pod and
container level (pod level too, so a future container added to this pod cannot
silently run as root), `readOnlyRootFilesystem`, all capabilities dropped, no
privilege escalation, `seccompProfile: RuntimeDefault`,
`automountServiceAccountToken: false` and `enableServiceLinks: false` — it meets
the Pod Security "restricted" profile.

- `automountServiceAccountToken: false` because postgres-mcp never calls the
  Kubernetes API, and a mounted token would be the one credential in the pod that
  is *not* scoped to a single database.
- `enableServiceLinks: false` drops the docker-link env vars kubelet injects for
  every Service in the namespace. They are noise in `kubectl describe pod` —
  which is exactly where `PROJECT` is meant to be read — and they enumerate the
  namespace to anything that gets code execution there.
- Two consequences of the read-only rootfs: it needs an `emptyDir` at `/tmp`
  **and** `HOME=/tmp`, or python has nowhere to write. `fsGroup: 1000` makes that
  emptyDir's ownership explicit instead of relying on its default mode.

The namespace is **not** labelled `pod-security.kubernetes.io/enforce: restricted`,
because nao legitimately runs as root with `SETUID`/`SETGID`. These three are
hardened individually, not by an admission rule.

The entrypoint is `["/app/docker-entrypoint.sh", "postgres-mcp"]` with an empty
CMD, so `args` land as flags on `postgres-mcp` itself. Transport is `sse`, not
streamable-http: `main` has carried streamable-http since 2026-01-22 but no
release ships it, and the tag here is pinned to the latest release (`0.3.0`).

The `DATABASE_URI` is built from `DB_USER` / `DB_PASSWORD` with Kubernetes'
`$(VAR)` env expansion rather than taken from the Secret, because the CNPG
basic-auth Secret has no `uri` key and its `-app` uri would point at the
**primary**. CNPG passwords are alphanumeric, so no URL-encoding step is needed.

## Traps

- **`imageName`, not `image`, on the CNPG Cluster**, and
  `ghcr.io/cloudnative-pg/cloudnative-pg` is the *operator* image — it must never
  be set there. The value is `ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie`,
  pinned to what the operator deployed and bumped by hand — `renovate.json`
  scopes the kubernetes manager to `/apps/.+/db-migrations/.+\.yaml$/`, so
  Renovate never reads this file.
- **`dbtools-db` has no backup.** Losing it costs a re-login and a re-import of
  `servers.json`, not data — but nothing will restore it.
- **`databaseReclaimPolicy: retain` on the `pgadmin` Database CR.** Deleting the
  kustomize resource by accident must not drop the database and destroy the saved
  server list.
- **The pgAdmin `PassFile` path is relative to the user's storage directory**, so
  the leading `/` in `servers.json` is not a filesystem root, and the email in
  `pgadmin-admin.enc.yaml` is what names that directory. Changing the email moves
  the path and every pre-registered server starts prompting for a password.
- **`servers.json` is imported once per user.** pgAdmin records the import in its
  config DB; editing the ConfigMap later does not re-import.
- **The NetworkPolicies cannot express "replica only"** — `-rw` and `-ro` select
  the same pods. The `-ro` host in the DSN is the write boundary, not the policy.
- **`BETTER_AUTH_TRUSTED_ORIGINS` takes no space after the comma**, and every
  browser-visible address must be in it. Adding an Ingress or a tunnel hostname
  without adding its origin ships a UI that loads and then refuses every login
  with 403 `INVALID_ORIGIN`.
- **`BETTER_AUTH_SECRET` must stay stable.** A new value logs every user out on
  the next rollout. It is derived from nothing, so losing it costs a re-login and
  nothing more.
- **The Services carry no tailscale annotations.** Both mechanisms at once
  register two devices contending for one hostname and the loser is suffixed
  (`nao-1`, `pgadmin-1`) — an origin nothing trusts, so nao's login breaks there.
- **PRECONDITION for both Ingresses:** *HTTPS Certificates* must be enabled in
  the Tailscale admin console (DNS → HTTPS Certificates). Without it the proxy
  comes up with no certificate and both UIs are unreachable.
- **Migrating off `expose`:** the old `nao` / `pgadmin` devices must be gone from
  the Tailscale admin console before the Ingress proxies register, or MagicDNS
  hands the new ones a suffixed name. Check `kubectl -n tailscale get pods` and
  the Machines page.
- **Three `nao_config.yaml` keys fail silently**: a missing `project_name` (nao
  starts with **zero** connections), `schema:` where the field is `schema_name`,
  and the `templates` list that must be stated to keep `query_history` — and the
  `pg_stat_statements` it needs — out. Each is commented beside the key it
  governs in [`nao-config-configmap.yaml`](nao-config-configmap.yaml); read that
  file before editing it.
- **`nao-config-configmap.yaml` is a seed, not the live config** (`cp -n`).
- **Every tier alias must exist as a routing rule in the ai-gateway dashboard
  before it is selected** — an alias no rule matches is rejected as an unknown
  model, and a client cannot discover the aliases from the gateway.
- **`--sse-host=0.0.0.0` is mandatory** on postgres-mcp: the default is
  `localhost`, and a pod bound there accepts nothing. The entrypoint appends it
  when it sees `--transport=sse`; passing it explicitly is idempotent and survives
  an entrypoint change.
- **The asp database is named `automarket`, not `asp`.**
- **A Deployment selector is immutable**, so the postgres-mcp selectors are `app`
  only — adding `project` would buy nothing and lock in a rename.
- **`.sops.yaml` selects the age key by path** (`staging/*.enc.yaml`), which the
  `.example` suffix does not match. A template is never encrypted and must never
  hold a real value.
- **The `PGADMIN_CONFIG_*` values are evaluated as Python literals**, hence the
  inner quotes on `PGADMIN_CONFIG_CONFIG_DATABASE_URI`. The `$(VAR)` around them
  is Kubernetes' own env expansion, which resolves only because the two referenced
  vars are declared first.

## Operating it

### Secrets

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

### Where state lives

| what                                     | where                                   |
| ---------------------------------------- | --------------------------------------- |
| pgAdmin users / saved servers / prefs     | `pgadmin` database on `dbtools-db`      |
| pgAdmin sessions + pgpass                 | pod emptyDir (rebuilt each start)       |
| nao users / sessions / chat history       | `nao` database on `dbtools-db`          |
| nao project: `nao_config.yaml` + context  | PVC `nao-project` at `/app/project`     |

### First run

**pgAdmin** — log in with the credentials in `pgadmin-admin.enc.yaml`
(`sops -d infrastructure/services/staging/databases/dbtools/pgadmin-admin.enc.yaml`).
The three servers are pre-registered and connect with no password prompt. A
credential rotation needs only:

```bash
kubectl -n database rollout restart deploy/pgadmin
```

To re-import `servers.json` after editing the ConfigMap, delete the server in the
UI first, or the rows in the `pgadmin` database's `server` table.

**nao** — the first visitor self-registers and becomes admin; everyone after is
invited from the UI. Then build the context:

```bash
kubectl -n database exec -it deploy/nao -- nao sync
```

### Changing nao's config

```bash
# edit in place (survives restarts, not in git)
kubectl -n database exec -it deploy/nao -- sh -c 'vi /app/project/nao_config.yaml'

# re-seed from git (discards the pod's copy)
kubectl -n database exec deploy/nao -- rm /app/project/nao_config.yaml
kubectl -n database rollout restart deploy/nao
```

Renovate cannot bump the nao image tag (no semver tags are published); move it by
hand.

### Checking the LLM path

A revoked key fails at call time with `401 virtual_key_not_found`; a wrong alias
fails as an unknown model. Reproduce either without the UI:

```bash
kubectl -n database exec deploy/nao -- sh -c \
  'curl -s -H "Authorization: Bearer $NAO_LLM_API_KEY" $NAO_LLM_BASE_URL/v1/models'
```

### Registering postgres-mcp in ai-gateway

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
(enabled there) and not on that section. `GET /api/mcp/clients` answering **401
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

### Which postgres-mcp tools actually work

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

### Which project a postgres-mcp pod serves

Four places say it, and they must agree — three identical containers in one
namespace is exactly where a mislabelled pod costs an afternoon:

```bash
kubectl -n database get pods -l project=fbref        # the label
kubectl -n database get deploy | grep postgres-mcp   # the object name
kubectl -n database describe pod -l project=asp | grep PROJECT   # the env marker
```

`PROJECT` is not read by postgres-mcp at all; it is there so `kubectl describe
pod` answers "which database is this one?" without decoding a DSN (the DSN's
password makes plain `env` output awkward to read). The fourth place is the
Bifrost client name `postgres_<project>`, which puts the project into every tool
name the model sees (`postgres_fbref-execute_sql`).

### postgres-mcp health

- **The pod does not listen until the database is reachable.** postgres-mcp
  completes its pool connect before starting the transport, so a pod that cannot
  reach its replica never binds `:8000` and never goes Ready. That makes the TCP
  probe a real DB gate — and is why liveness is slack (5 min) rather than tight:
  a DB restart should shed traffic, not start a restart loop. The probe is TCP
  and not HTTP because there is no health path, and `GET /sse` opens a stream
  that would hang an HTTP probe forever.
- Confirm a healthy start by the log line, not by the pod being up:

  ```bash
  kubectl -n database logs deploy/postgres-mcp-fbref | grep -E "RESTRICTED|Successfully connected"
  ```

  On a bad DSN it logs a warning and keeps serving nothing — treat a missing
  `Successfully connected to database` as failure.

### Render check

```bash
kubectl kustomize infrastructure/services/staging/databases/dbtools
```
