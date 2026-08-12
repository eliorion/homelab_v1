# n8n

n8n is the cluster's self-hosted automation host: scheduled jobs, webhooks and
glue between services live in its UI instead of costing a new image, a new
manifest and a new alert rule each. It runs as a single replica in the `n8n`
namespace, stores its state in the CloudNativePG cluster `n8n-db`, and is
published on the tailnet only, at `https://n8n.tail45b0ca.ts.net`. The price of
running a platform rather than a job: **workflows live in Postgres, not git**,
so the `n8n-db` backup is the only copy of them. Full background in
[`documentations/10-n8n-automation.md`](../../../documentations/10-n8n-automation.md).

## How it is wired

Base (`apps/base/n8n/`), listed by `kustomization.yaml` in this order:

- `storage.yaml` — `PersistentVolumeClaim` `n8n-data-pvc`, `ReadWriteOnce`,
  `1Gi`, no explicit `storageClassName` so it lands on the cluster default
  (Longhorn). It backs `/home/node/.n8n`; the workflows themselves are in
  Postgres, not here.
- `deployment.yaml` — `Deployment` `n8n`, `replicas: 1`, `strategy.type:
  Recreate`, image `docker.n8n.io/n8nio/n8n:2.33.7` (tracked by the
  `# renovate:` line above it), container port `5678` named `http`. Postgres
  connection details come from the CNPG-generated `n8n-db-app` Secret
  (`host`, `port`, `dbname`, `username`, `password`) with `DB_TYPE:
  postgresdb`; `envFrom` pulls the `n8n-secrets` Secret and the `n8n-config`
  ConfigMap, both from the staging overlay. Startup, readiness and liveness
  probes all hit `/healthz` on the `http` port. Requests `200m` CPU / `512Mi`
  memory, limit `1536Mi` memory. Pod security context: `runAsUser` /
  `runAsGroup` / `fsGroup` `1000`, `runAsNonRoot: true`, seccomp
  `RuntimeDefault`; container drops `ALL` capabilities and disallows privilege
  escalation. Volumes: the PVC at `/home/node/.n8n` and an `emptyDir` at `/tmp`.
- `service.yaml` — `ClusterIP` Service `n8n`, port `5678` named `http` →
  `targetPort: http`, selector `app: n8n`, and the Service-level label
  `app: n8n` that the ServiceMonitor matches.
- `ingress-tailscale.yaml` — `Ingress` `n8n` with `ingressClassName: tailscale`,
  `defaultBackend` the `n8n` Service on `5678`, and `tls.hosts: [n8n]`, which is
  the tailnet device name MagicDNS serves at `https://n8n.tail45b0ca.ts.net`
  (no port).

Staging overlay (`apps/staging/n8n/`):

- `kustomization.yaml` — pulls `../../base/n8n`, forces `namespace: n8n`, and
  adds `configmap.yaml` and `n8n-secrets.enc.yaml`.
- `configmap.yaml` — ConfigMap `n8n-config`: `N8N_HOST:
  n8n.tail45b0ca.ts.net`, `N8N_PORT: "5678"`, `N8N_PROTOCOL: https`,
  `WEBHOOK_URL: https://n8n.tail45b0ca.ts.net/`, `GENERIC_TIMEZONE` and `TZ`
  `Europe/Paris`, `N8N_METRICS: "true"`, `N8N_DIAGNOSTICS_ENABLED: "false"`,
  `N8N_VERSION_NOTIFICATIONS_ENABLED: "false"`, `N8N_RUNNERS_ENABLED: "true"`.
- `n8n-secrets.enc.yaml` — SOPS-encrypted Secret `n8n-secrets` holding
  `N8N_ENCRYPTION_KEY`. `n8n-secrets.enc.yaml.example` is the plaintext
  template that documents how to mint it (`openssl rand -hex 32`, then
  `sops -e -i`); it is never applied.

Flux: `apps/staging/kustomization.yaml` lists `n8n/`, and the `apps` Flux
Kustomization in `clusters/staging/apps.yaml` reconciles `./apps/staging` with
`prune: true` and `decryption.provider: sops`. It depends on `db-migrations`,
which depends on `databases` (`wait: true`) — so a broken `n8n-db` stalls the
whole app chain, not just n8n.

Not in this directory but part of the component:

- `apps/base/databases/n8n/` + `apps/staging/databases/n8n/` — the `n8n`
  Namespace and the CNPG `Cluster` `n8n-db`, reconciled first by the
  `databases` Kustomization. There is no `db-migrations` entry for `n8n-db`:
  n8n runs its own TypeORM migrations on boot.
- `monitoring/configs/staging/n8n-metrics/` — ServiceMonitor scraping
  `/metrics` on the `http` port every 60s, plus the `N8nDown` and
  `N8nMetricsMissing` alert rules routed to the Telegram receiver.

## Why it is like this

**Tailscale Ingress, not the `tailscale.com/expose` annotation.** The
asp/fbref/Longhorn admin UIs use the annotation, which is an L3 forward that
preserves the Service port and would therefore publish plain HTTP on `:5678`.
n8n is a password-authenticated dashboard whose session cookie belongs on a
secure origin — over plain HTTP you must also set `N8N_SECURE_COOKIE=false`,
because n8n otherwise refuses to set the cookie at all and sign-in never
completes. Using an Ingress is the same call ai-gateway and the Keycloak admin
console make. MagicDNS issues the certificate, so there is no cert-manager
`Certificate` and no DNS record to keep in sync, and `N8N_SECURE_COOKIE` stays
at its secure default.

**One replica, `Recreate`.** The Longhorn PVC is `ReadWriteOnce`, so a rolling
update would deadlock: the old pod must release the volume before the new one
can bind it.

**`fsGroup: 1000`.** The n8n image runs as the `node` user (uid 1000); the
fsGroup is what makes the Longhorn volume writable by it.

**`readOnlyRootFilesystem: false`** — a deliberate deviation from the house
default (etcd-backup and friends use `true`). n8n writes caches and task-runner
scratch outside `/home/node/.n8n` and crashes on boot with a read-only root.
Everything else in the security context is the standard set.

**A generous startupProbe** (`periodSeconds: 10`, `failureThreshold: 30`, i.e.
five minutes). First boot runs the full TypeORM schema migration against an
empty database; without the headroom the liveness probe kills the pod
mid-migration.

**Metrics but no failure notifications.** Workflow failures are visible in
n8n's own Executions view (filter *Error*) and are deliberately not pushed
anywhere. The one thing Executions cannot report — n8n itself being down — is
covered by the Prometheus rules, which is why `N8N_METRICS` is on.

**Egress is not on the tailnet.** The Ingress only publishes the UI inbound;
pods in the `n8n` namespace still egress through the node, i.e. the home ISP
address, with no proxy Service and no NetworkPolicy. At least one intended
automation depends on that: LinkedIn's WAF returns an HTML 400 on image upload
from datacenter IP ranges.

**Telemetry off.** `N8N_DIAGNOSTICS_ENABLED` and
`N8N_VERSION_NOTIFICATIONS_ENABLED` are `"false"`; task runners
(`N8N_RUNNERS_ENABLED`) are on.

## Traps

- **`N8N_ENCRYPTION_KEY` must never be rotated.** It encrypts every credential
  n8n stores in `n8n-db`. Rotate it — or reinstall and let n8n generate a fresh
  one — and every credential in every workflow becomes permanently unreadable.
  A database restore without this exact key is worthless. Disaster recovery
  needs *both* halves: the CNPG backup and this key.
- `strategy.type: Recreate` must stay. `RollingUpdate` deadlocks on the RWO
  volume.
- `fsGroup: 1000` must match the image's `node` user, or the PVC is unwritable.
- `readOnlyRootFilesystem` must stay `false`; `true` crashes n8n on boot.
- `N8N_HOST` and `WEBHOOK_URL` in `apps/staging/n8n/configmap.yaml` must match
  the `tls.hosts` entry in `ingress-tailscale.yaml`.
- **Precondition:** HTTPS Certificates must be enabled in the Tailscale admin
  console (DNS → HTTPS Certificates). Without it the proxy comes up with no
  certificate and the UI is unreachable.
- The Service must carry **no** `tailscale.com/expose` annotation. Both
  mechanisms at once register two tailnet devices contending for the same
  hostname.
- The Service needs the `app: n8n` label on the *metadata*, not just in
  `spec.selector`: the ServiceMonitor selects on Service labels, so without it
  nothing is scraped and `N8nDown` never has a series to evaluate.
- Lowering the startupProbe `failureThreshold` (30) can kill the pod during the
  first-boot schema migration.
- `N8N_METRICS: "true"` is what exposes `/metrics`; turning it off silently
  breaks the ServiceMonitor and the alerts.
- Do not route the `n8n` namespace through a VPN or egress proxy — it silently
  reintroduces the datacenter-IP block described above.
- `n8n-secrets.enc.yaml` must be SOPS-encrypted before it is committed; an
  unencrypted commit puts the key in git history permanently.

## Operating it

```bash
kubectl kustomize apps/staging                  # must build
grep -L ENC apps/staging/n8n/*.enc.yaml         # MUST print nothing

flux get kustomizations                         # databases → db-migrations → apps Ready
kubectl -n n8n get cluster n8n-db               # CNPG Ready first
kubectl -n n8n get pods,pvc,svc,ingress
kubectl -n n8n logs deploy/n8n | head -50       # schema migrations on first boot
kubectl -n tailscale get pods                   # ts-n8n-… proxy registered
```

Creating the secret on a fresh install:

```bash
cd apps/staging/n8n
cp n8n-secrets.enc.yaml.example n8n-secrets.enc.yaml
# put `openssl rand -hex 32` output in N8N_ENCRYPTION_KEY
sops -e -i n8n-secrets.enc.yaml
```

Until that file exists the `apps` Kustomization fails its build and stalls —
nothing is pruned, no outage.

Confirm egress still leaves through the home ISP before trusting a workflow
that talks to a picky third party:

```bash
kubectl run ipcheck -n n8n --rm -it --restart=Never \
  --image=curlimages/curl -- curl -s https://ifconfig.me
```

Reach the UI at `https://n8n.tail45b0ca.ts.net`; the owner account is created
on first visit. Restore procedure for `n8n-db` is the asp/fbref one in
[`documentations/03-backups.md`](../../../documentations/03-backups.md).

### Overlays

Only `apps/staging/n8n/` exists — n8n is staging-only, there is no production
overlay. The overlay adds the `n8n-config` ConfigMap and the SOPS-encrypted
`n8n-secrets` Secret and sets `namespace: n8n`; it patches nothing in the base.
