# ai-gateway

One endpoint for every LLM call in the homelab — from devcontainers, from
projects, and from agent pods in the cluster. It runs Bifrost as a Flux
`HelmRelease` in its own `ai-gateway` namespace, stores its whole configuration
in the CNPG cluster `ai-gateway-db`, and is published on the tailnet over HTTPS
and nowhere else. **Bifrost is the current implementation, not the contract.**
Everything a client touches is deliberately vendor-neutral, so replacing the
backend (LiteLLM, or anything else that speaks the same two wire protocols) is a
change to `release.yaml` and nothing else.

---

## The contract

| Thing | Value |
|---|---|
| In-cluster base URL | `http://ai-gateway.ai-gateway.svc.cluster.local:8080` |
| Tailnet base URL | `https://ai-gateway.<your-tailnet>.ts.net` |
| Anthropic-compatible path | `<base>/anthropic` |
| OpenAI-compatible path | `<base>/v1` |
| Credential | a virtual key the consumer holds itself |
| Model aliases | whatever you create in the dashboard |

Two rules keep the abstraction honest:

1. **Clients never name a vendor model.** They ask for an alias like
   `ai/sonnet`; the routing table decides which vendor model answers it.
   Re-pointing a tier is an edit in the dashboard, with no client redeploy.
2. **Clients never see a `BIFROST_*` name.** Provider keys never leave this
   namespace; a consumer holds only its own virtual key.

**This namespace exports nothing.** There is no ConfigMap and no Secret mirrored
anywhere, because neither is needed: a Kubernetes Service resolves from any
namespace, so a consumer just uses the DNS name above, and each project holds
its own virtual key created in the dashboard.

## How it is wired

Base — `infrastructure/services/base/ai-gateway/`:

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the five objects below. Nothing is reflected into any other namespace. |
| `namespace.yaml` | Namespace `ai-gateway`, labelled `name: ai-gateway` so consumer NetworkPolicies can select it by namespace label instead of pod IP. |
| `repository.yaml` | `HelmRepository` `bifrost` in `flux-system`, `https://maximhq.github.io/bifrost/helm-charts`, 24h interval. |
| `release.yaml` | The `HelmRelease` — chart `bifrost` 2.1.34, image `docker.io/maximhq/bifrost:v1.6.9`, one replica, external CNPG, UI-owned configuration. |
| `ingress-tailscale.yaml` | `Ingress` with `ingressClassName: tailscale`, `defaultBackend` → Service `ai-gateway:8080`, `tls.hosts: [ai-gateway]`. TLS on 443 with a MagicDNS certificate. |
| `podmonitor.yaml` | `PodMonitor` scraping the pod's `http` port at `/metrics` every 30s, labelled `release: kube-prometheus-stack`. |

What `release.yaml` sets, block by block:

- `nameOverride` / `fullnameOverride: ai-gateway` — both, so the Service, the
  selector labels and the chart's ServiceMonitor all read `ai-gateway` and never
  `bifrost`.
- `replicaCount: 1` — not a capacity decision; see "Why it is like this".
- `image.tag: "v1.6.9"` — the chart requires an explicit tag, so this (not the
  chart version) is the real version knob. Renovate tracks the image, and keeps
  the pinned chart version (`2.1.34`) current as well.
- `service`: `ClusterIP` on 8080, with **no** Tailscale annotations.
- `ingress.enabled: false` — the chart's own ingress template is unused.
- `storage.mode: postgres`, `configStore` and `logsStore` enabled,
  `objectStorage` left disabled: no bucket is wired for log offload, so
  request/response audit rows stay in `ai-gateway-db` itself.
- `postgresql.enabled: false` with `external` pointing at `ai-gateway-db-rw:5432`,
  user `bifrost`, database `bifrost`, `sslMode: disable`, password from the
  Secret `ai-gateway-db-app` (key `password`) — CNPG generates that Secret from
  the Cluster's `bootstrap.initdb`, so no password is ever written to Git.
- `envFrom` the Secret `ai-gateway-providers` — every credential the gateway
  resolves by `env.NAME`.
- `resources`: requests 200m / 512Mi, limits 2 CPU / 2Gi.
- `podSecurityContext` / `securityContext`: `seccompProfile: RuntimeDefault` and
  `allowPrivilegeEscalation: false`.
- `bifrost`: `appDir: /app/data`, `port: 8080`, `logLevel: info`,
  `logStyle: json`, `envLabel: staging`, `sourceOfTruth: "split"`,
  `encryptionKeySecret` → `ai-gateway-providers` / `BIFROST_ENCRYPTION_KEY`,
  `authConfig` → `ai-gateway-admin` (dashboard and management API only),
  `client.enforceAuthOnInference: true`, `client.allowedOrigins: ["*"]`, and the
  `governance` plugin enabled at version 1 with `is_vk_mandatory: true`.

The database is **not** here: `ai-gateway-db` lives in
`../../base/databases/ai-gateway/` and `../../staging/databases/ai-gateway/`, so
that every `infrastructure/services` database sits together, mirroring
`apps/staging/databases/`. Its Garage ObjectStore, ScheduledBackup and backup
credentials are in the staging half of that directory.

### Overlays

`infrastructure/services/staging/ai-gateway/` is the only overlay. It pulls in
`../../base/ai-gateway` and adds `ai-gateway-secrets.enc.yaml`, which is
decrypted by the `infrastructure-services` Flux Kustomization (`sops-age`).
Encrypted manifests live only in overlays, never in `base/` — `.sops.yaml` only
matches paths under `staging/` and `production/`.

That SOPS file carries two Secrets, templated in
`ai-gateway-secrets.enc.yaml.example`:

- `ai-gateway-providers` — `BIFROST_ENCRYPTION_KEY` plus whatever provider
  variables you reference from the dashboard by `env.NAME`.
- `ai-gateway-admin` — `username` / `password` for the dashboard and the
  management API.

The committed `ai-gateway-secrets.enc.yaml` ships with **placeholder** values so
the HelmRelease renders. The gateway boots and serves `/metrics` with them, but
every provider call 401s until the real keys are in. `AI_GATEWAY_TOKEN` is no
longer generated here: virtual keys are created in the dashboard and stored in
the consuming project's own namespace.

There is no production overlay.

## Why it is like this

**One replica, and it is not about capacity.** State does live in CNPG
(`storage.mode: postgres`) rather than on a per-pod volume — but that makes the
*store* shared, not the *view* of it. Bifrost loads virtual keys, providers and
routing rules into memory at startup, and a dashboard write does not invalidate a
sibling pod's copy, so two pods answer the same request differently until both
restart. Observed live, with one key created after boot:

```
10.244.1.211  ->  401 virtual_key_not_found
10.244.2.239  ->  200                          # same key, same second
```

The Service round-robins, so half of a client's calls 401 and half of the
dashboard's own page loads deny what the other half shows. Nothing is lost by
dropping to one: inference is stateless, HA for the *data* is the CNPG cluster's
job (`instances: 2` there is unrelated), and a homelab gateway has no load a
second pod would relieve. The rollout still surges (default `maxSurge` 25% rounds
up to 1, `maxUnavailable` 25% rounds down to 0), so an upgrade has no gap —
during that overlap the split briefly exists again, which is the one moment not
to be editing the dashboard.

**The image tag is ahead of the chart's `appVersion`.** The chart's
`values.schema.json` marks the tag as required and validates it at template
render time, so it has to be set explicitly anyway. Upstream does not bump chart
metadata per app release: chart 2.1.34 still declares `appVersion` 1.5.12, while
chart 2.1.34 and image `v1.6.9` were published the same day. Pinning the
`appVersion` would run a months-old gateway, so Renovate tracks the image.

**A Tailscale Ingress, not the `tailscale.com/expose` annotation** the admin UIs
in this repo use. `expose` is an L3 forward that preserves the Service port, so
it would publish plain HTTP on `:8080`. This surface is a password-authenticated
dashboard whose session cookies belong on a secure origin, and the *same* port
serves the inference API, where every call carries a virtual key in a header.
`https://…/anthropic` and `https://…/v1` with no port is also just a normal base
URL for an SDK, which is why every client base URL here is portless. MagicDNS
issues the certificate, so there is no cert-manager `Certificate` and no DNS
record to keep in sync.

**Not the chart's `ingress.enabled`.** That template hardcodes `secretName` into
every `tls` entry and routes via `rules`/`host`, while a Tailscale Ingress must
omit `secretName` (the operator owns the certificate) and uses `defaultBackend`.
There is no public or LAN ingress of any kind.

**A PodMonitor, not a ServiceMonitor.** The chart templates no monitor object at
all, so scraping is wired by hand. It renders *two* Services (`ai-gateway` and
`ai-gateway-headless`) carrying byte-identical labels, so any ServiceMonitor
selector matches both and Prometheus scrapes the same pod twice — duplicate
series with no way to tell them apart. Selecting the pod directly yields exactly
one target.

**The metrics scrape needs basic auth.** Once `authConfig` was enabled the
endpoint started answering `401` unauthenticated, so the target sat `up: 0` with
a permanent `TargetDown` against it. Measured against the running pod: no
credential → `401`; `Authorization: Bearer <admin>` → `401`; basic auth with the
admin user and password → `200`. So it is `authConfig` — the dashboard and
management credential — gating `/metrics`, **not** the governance plugin's
`is_vk_mandatory`. A virtual key is for inference and does not open this path,
which is why swapping one in re-breaks the scrape. The `basicAuth` reference
must point at a Secret in the `ai-gateway` namespace, and does: the operator,
not Prometheus, resolves it and inlines the credential into the generated scrape
config, and its ServiceAccount can read Secrets there. Nothing new lands in Git —
`ai-gateway-admin` is the SOPS Secret `authConfig.existingSecret` already uses.

**`sourceOfTruth: "split"` — the database wins.** `split` is Bifrost's default:
`config.json` seeds a section on first boot and is otherwise left alone, so edits
made in the dashboard survive every restart. Combined with declaring no
providers, virtual keys or routing rules in `release.yaml`, nothing in Git can
overwrite the UI. The previous value, `"config.json"`, did the opposite: it
re-applied the file's sections at *every* startup — even when the stored
`config_hash` matched, because UI edits deliberately do not update that hash — so
every pod restart silently reverted the dashboard.

**The governance plugin is infrastructure, not configuration.** The chart
defaults `plugins.governance.enabled` to false, and with it off the whole
governance surface — virtual keys, budgets, rate limits, routing rules — has no
API routes registered. The dashboard's requests then fall through to the SPA
catch-all, so a GET returns 200 with HTML the UI cannot parse
(`Failed to load virtual keys: An unexpected error occurred`) and a POST returns
a bare 405. The plugin has to be on before the dashboard can own anything inside
it.

**Two independent auth switches.** `enforceAuthOnInference: true` requires *a*
credential on every inference call — a virtual key alone satisfies it, which is
what lets Claude Code authenticate with a single header; leaving it false would
make the gateway an open relay to paid provider keys for anyone on the tailnet.
`is_vk_mandatory: true` then requires that the credential be a *virtual* key;
without it the admin password would also buy provider calls, which would make the
per-project keys pointless as a spend boundary. `authConfig` is a third, separate
thing: it gates the dashboard and the management API, not inference.

**`envFrom` one Secret.** Provider keys and virtual keys never land in the
rendered `config.json` ConfigMap this way — only the env var *names* do.

**`sslMode: disable`** is in-cluster ClusterIP traffic only; no other CNPG
consumer in this repo sets `sslMode` either.

**The `podSecurityContext` / `securityContext` pair is PodSecurity `restricted`
compliance.** The chart already sets `runAsNonRoot`, `runAsUser: 1000` and drops
`ALL` capabilities; the two settings named here are the only ones the admission
warning reported as missing. Helm merges maps, so naming just these keeps every
chart default around them. The namespace only *warns* today, so the pods schedule
either way — but a warning is the version of this that gets ignored until the day
the label flips to `enforce` and the Deployment stops admitting.

**CORS `allowedOrigins: ["*"]`** is for the dashboard only. The gateway is
unreachable off-tailnet, so the origin list is not the security boundary here.

**No mirrored contract object.** Earlier revisions reflected a contract ConfigMap
and one shared token into every consumer namespace; that meant four annotations
across two objects had to agree for a project to work, and a namespace listed on
only one of them failed silently with a 401.

## Traps

- **`replicaCount` must stay 1.** Anything above it splits the in-memory config
  view across pods and brings back "half my calls 401", plus a
  restart-after-every-dashboard-edit.
- **`sourceOfTruth` must stay `"split"`.** `"config.json"` re-applies this file
  at every startup and silently reverts the dashboard.
- **`plugins.governance.enabled` must stay `true`,** or virtual keys, budgets,
  rate limits and routing rules have no API routes and the dashboard fails with
  `Failed to load virtual keys: An unexpected error occurred` / a bare 405.
- **`is_vk_mandatory: true` must stay,** or the admin password also buys
  provider calls.
- **`enforceAuthOnInference: true` must stay,** or the gateway is an open relay
  to paid provider keys for anyone on the tailnet.
- **Do not add a `tailscale.com/expose` annotation to the Service.** The tailnet
  is published by `ingress-tailscale.yaml`; running both registers two tailnet
  devices contending for the same `ai-gateway` hostname, and `expose` would serve
  plain HTTP on `:8080`.
- **Keep `tls.hosts: [ai-gateway]`.** It is the tailnet device name, and every
  consumer's base URL is derived from that exact string.
- **Precondition for the Ingress:** HTTPS Certificates must be enabled in the
  Tailscale admin console (DNS → HTTPS Certificates). Without it the proxy comes
  up with no certificate and the gateway is unreachable.
- **`nameOverride` and `fullnameOverride` are both load-bearing** — they are what
  keep the in-cluster DNS name `ai-gateway` instead of `bifrost`.
- **`image.tag` is required by the chart and is deliberately ahead of its
  `appVersion` (1.5.12).** Do not "fix" it back to the chart's `appVersion`.
- **`podmonitor.yaml`'s `release: kube-prometheus-stack` label** must match
  Prometheus's `podMonitorSelector`, or the target is never scraped.
- **The PodMonitor's `port: http`** is the container port name; `/metrics` is
  served on the same port as the API, and it is authenticated. Do not "fix" the
  401 by swapping in a virtual key — see "The metrics scrape needs basic auth".
- **`BIFROST_ENCRYPTION_KEY` can never be rotated or lost.** See "Backup &
  restore".
- **Secrets stay in the overlay.** Never move `*.enc.yaml` into `base/`:
  `.sops.yaml` only encrypts under `staging/` and `production/`. Never commit
  `ai-gateway-secrets.enc.yaml.example` with real values.
- **A model alias must match a routing rule.** Nothing enforces this coupling; an
  alias no rule matches is rejected as an unknown model.
- **`unset ANTHROPIC_API_KEY`** — the SDKs prefer it over `ANTHROPIC_AUTH_TOKEN`,
  so leaving it set bypasses the gateway entirely.

## Operating it

### Connecting a project

Three things, all in the consumer's own directory — nothing here changes:

1. **Create a virtual key** for that project in the dashboard.
2. **Store it** in a SOPS Secret in the project's namespace, and reference it
   with `secretKeyRef` (see
   `../../staging/databases/dbtools/nao-ai-gateway-token.enc.yaml`). One key per
   project means it can be revoked, or have its spend read off, without touching
   any other consumer.
3. **Allow egress** to the `ai-gateway` namespace (label `name: ai-gateway`) on
   8080 — this, not any mirrored object, is what actually grants the path.

Then point the client at the base URL, append the path its SDK speaks, and name
an alias that exists as a routing rule.

### Laptop / devcontainer (over Tailscale)

The tailnet Ingress terminates TLS on 443 with a MagicDNS certificate, so the
base URL carries no port. `ai-gateway` is the device name from that Ingress's
`tls.hosts`.

```bash
GW=https://ai-gateway.tail1234.ts.net           # your tailnet
KEY=sk-bf-...                                   # a virtual key from the dashboard

# Claude Code / any Anthropic SDK. The SDK appends /v1/messages itself.
export ANTHROPIC_BASE_URL="$GW/anthropic"
export ANTHROPIC_AUTH_TOKEN="$KEY"
export ANTHROPIC_MODEL=ai/sonnet
unset ANTHROPIC_API_KEY

# OpenAI-compatible clients (openai-python, LangChain, Aider, ...).
export OPENAI_BASE_URL="$GW/v1"
export OPENAI_API_KEY="$KEY"
```

> **`unset ANTHROPIC_API_KEY` is load-bearing.** The SDKs prefer it over
> `ANTHROPIC_AUTH_TOKEN`, so leaving it set sends requests straight to Anthropic
> and silently bypasses the gateway, its budgets and its audit log. A
> devcontainer helper used to do this unset for you; it was removed, so it is
> now yours to remember.

Claude Code caches its own credential, so after changing auth run `/logout` and
restart it.

Smoke test:

```bash
curl -s "$GW/anthropic/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"ai/fast","max_tokens":16,"messages":[{"role":"user","content":"say OK"}]}'
```

### In-cluster (agent pods, jobs)

Everything lives in the consumer's own namespace — see "Connecting a project"
above. The address is a plain Service DNS name, the credential is that project's
own virtual key:

```yaml
env:
  - name: LLM_BASE_URL
    value: "http://ai-gateway.ai-gateway.svc.cluster.local:8080"   # + /v1 or /anthropic
  - name: LLM_MODEL
    value: "ai/sonnet"                                             # must match a routing rule
  - name: LLM_API_KEY
    valueFrom:
      secretKeyRef:
        name: <project>-ai-gateway-token
        key: AI_GATEWAY_TOKEN
```

Plus a NetworkPolicy allowing egress to the `ai-gateway` namespace (label
`name: ai-gateway`) on 8080.
`../../base/databases/dbtools/nao-networkpolicy.yaml` is a worked example.

### Dashboard

`https://ai-gateway.<your-tailnet>.ts.net` — login from the `ai-gateway-admin`
Secret. HTTPS on 443 with a MagicDNS-issued certificate, served by the Tailscale
Ingress; there is no port in the URL and no plain-HTTP listener on the tailnet.

**This is where the gateway is configured.** Providers, provider keys, virtual
keys, the `ai/*` routing rules, budgets, rate limits, teams, MCP clients and
plugins all live in the config store (Postgres) and are edited here.
`release.yaml` declares none of them, and `sourceOfTruth: split` means the file
never re-applies what it does not declare — so a pod restart, a Helm upgrade or a
Flux reconcile cannot revert a dashboard edit. Git owns the infrastructure; the
UI owns the configuration.

### Filling the Secrets

```bash
cp ai-gateway-secrets.enc.yaml.example ai-gateway-secrets.enc.yaml
sops -e -i ai-gateway-secrets.enc.yaml     # .sops.yaml picks the staging age key
sops ai-gateway-secrets.enc.yaml           # later edits, re-encrypts on save
```

The one value you own outright:
`BIFROST_ENCRYPTION_KEY: $(openssl rand -base64 32)`.

### Bootstrap a fresh database

A new `ai-gateway-db` has no providers and no virtual keys, and
`enforceAuthOnInference: true` means nothing can call the gateway yet. In order:

1. Log into the dashboard with the `ai-gateway-admin` credentials.
2. Add a provider and its key (see the raw-vs-`env.` choice below).
3. Create the routing rules your projects ask for — e.g. `ai/opus`, `ai/sonnet`,
   `ai/fast`. An alias no rule matches is rejected as an unknown model, so create
   these before pointing a client at one.
4. Create one virtual key **per consuming project**, and store each in that
   project's own namespace — see "Connecting a project" above.

### Add a provider

Dashboard → Providers. Two ways to supply the key, and they differ in where the
secret's system of record ends up:

- **Raw value** — encrypted at rest in Postgres. Recoverable only from a DB
  backup *plus* `BIFROST_ENCRYPTION_KEY`. Nothing to commit.
- **`env.OPENAI_API_KEY`** (the literal string) — resolved at load time from the
  `ai-gateway-providers` Secret, so SOPS stays the system of record and the
  database holds no key material. Requires adding the variable to that Secret
  first. Verify this resolves for UI-entered keys before relying on it; it is
  documented for `config.json`, not explicitly for dashboard input.

### Re-point a model tier

Dashboard → the matching routing rule → change its target. No client change, no
commit, no restart.

### Rotate a project's token

Create a new virtual key in the dashboard, disable the old one, then `sops` that
project's own Secret and set `AI_GATEWAY_TOKEN` to the new value:

```bash
sops infrastructure/services/staging/databases/dbtools/nao-ai-gateway-token.enc.yaml
```

Nothing in the `ai-gateway` namespace changes, and no other consumer is affected.
The cost of that isolation: rotating *everything* is one edit per project rather
than one edit total — the trade this design makes for per-project revocation and
per-project spend attribution.

### Swap the backend

Rewrite `release.yaml` so the replacement keeps: the Service name `ai-gateway` on
port 8080, the tailnet hostname, the `/anthropic` and `/v1` paths, virtual-key
auth on one header, and the `ai/*` aliases. The staging Secrets and every
consumer stay untouched. Note the configuration itself does **not** come along:
it lives in Bifrost's own schema, so a new backend starts empty and its
providers, keys and routing rules are re-entered in the replacement's UI.

### Backup & restore

The config store is the only copy of the gateway's configuration, so
`ai-gateway-db`'s backups are the recovery path — not Git.

`ai-gateway-db` archives to Garage (bucket `cnpg-staging-ai-gateway`, its own
key) with a daily base backup plus continuous WAL, giving PITR across the
retention window. To roll back a bad Bifrost upgrade or a mistaken UI edit,
restore the cluster to a timestamp before it. Details in
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md)
and
[`../../../../documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md);
the tailnet path a restore takes is described in
[`../../../../documentations/09-etcd-backup-dr.md`](../../../../documentations/09-etcd-backup-dr.md).

Three things decide whether that actually works:

- **`BIFROST_ENCRYPTION_KEY` is the crown jewel.** Provider keys, virtual keys,
  OAuth tokens, MCP client and plugin configs are all encrypted at rest, so the
  Garage archive holds ciphertext. **Losing that key makes every backup
  permanently unrecoverable — there is no workaround.** It stays in SOPS on
  purpose: the archive and the key that opens it must not share a blast radius.
  Never rotate it after first boot; it cannot re-encrypt an existing store.
- **Rolling back a version is two moves, not one.** Bifrost migrates its schema
  forward on startup. Restoring an old dump into a *newer* Bifrost is fine — it
  migrates. Pinning the image *back* onto an already-migrated schema is the
  dangerous direction, so a version rollback means restoring the DB to the
  pre-upgrade point **and** pinning `images` back, together. Take an on-demand
  `Backup` before any Bifrost version bump.
- **The logs store shares this database.** `storage.logsStore` is Postgres too,
  and request/response rows will dwarf the config tables — they drive backup size
  and restore time, not the configuration itself.

### Verify

```bash
kubectl kustomize infrastructure/services/staging   # renders?
flux get helmreleases -n flux-system ai-gateway
kubectl -n ai-gateway get cluster ai-gateway-db      # CNPG, 2/2 instances
kubectl -n ai-gateway get pods,svc
kubectl -n ai-gateway logs deploy/ai-gateway | head
```

Then check the tailnet hostname registered (`tailscale status`, or the Tailscale
admin console) and run the smoke test above.

### When it breaks

A `CrashLoopBackOff` on the `ai-gateway` pod with

```
failed to connect to `user=bifrost database=bifrost`: 10.104.43.178:5432 (ai-gateway-db-rw):
dial error: dial tcp 10.104.43.178:5432: connect: no route to host
failed to bootstrap server: failed to load config ...
```

is usually not a gateway problem: `ai-gateway-db-rw` has no ready endpoint
because the CNPG primary is itself down. That exact incident (2026-08-10, gateway
down for ~2 days, 187 restarts) — a full disk from un-archived WAL — is written
up in
[`../../../../documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md).

## Deliberate limitations

**The configuration is not in Git.** Chosen, not accidental: providers, keys and
routing rules are edited in the dashboard, so changing a model tier costs no
commit, no PR and no reconcile wait. What that gives up is real — no review on a
routing change, no `git blame` on "who re-pointed `ai/sonnet`", no diff to revert.
The dashboard's own audit log and the DB backups above replace those. Everything
in this repo is still declarative; only the gateway's *content* is not.

**No cross-provider fallback.** Failing `ai/opus` over to another vendor would
change behaviour, tool-call semantics and cost invisibly. Failover is an explicit
edit to the routing rule, not a default.

**Auth is a shared virtual key, not Keycloak.** Bifrost OSS authenticates
inference with virtual keys; its SSO/OIDC integration is an enterprise feature,
and Claude Code cannot refresh an OIDC token on its own anyway. Per-user identity
is a phase-2 change **behind this contract**, and it lands in exactly one of two
places:

- **Keycloak-issued service tokens** — a dedicated confidential client per
  project, a helper that refreshes the token into `AI_GATEWAY_TOKEN`, and an
  `ai-gateway-auth` proxy in front that validates the JWT and swaps it for the
  backend virtual key. Consumers keep reading `AI_GATEWAY_TOKEN`; only the helper
  and the proxy are new.
- **Backend-native SSO** — if the backend gains usable OIDC inference auth, wire
  it to the existing `identity` realm and drop the proxy.

Either way the client contract above does not change — which is the point of
having written it down before shipping the auth layer.
