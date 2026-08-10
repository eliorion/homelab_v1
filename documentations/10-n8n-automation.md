# n8n: the cluster's automation host

Staging-only. One self-hosted n8n instance is the permanent home for homelab
automations — scheduled jobs, webhooks, glue between services — so the next one
costs a few UI minutes instead of a new image, a new manifest and a new alert
rule.

The price, stated up front: **workflows live in Postgres, not git.** That is the
trade-off of running a platform, and the reason the backup section below is not
optional.

## Files

| Path | Purpose |
|---|---|
| `apps/base/databases/n8n/` | `n8n` namespace + CNPG `Cluster` `n8n-db` |
| `apps/staging/databases/n8n/` | Longhorn storage patch; Garage backup (**off until you mint a key**) |
| `apps/base/n8n/` | Deployment, Service, 1Gi PVC, Tailscale Ingress |
| `apps/staging/n8n/` | `n8n-config` ConfigMap + `n8n-secrets.enc.yaml` (SOPS) |
| `monitoring/configs/staging/n8n-metrics/` | ServiceMonitor + `N8nDown` / `N8nMetricsMissing` |

Wired into `apps/staging/databases/kustomization.yaml`,
`apps/staging/kustomization.yaml` and
`monitoring/configs/staging/kustomization.yaml`. No change to
`clusters/staging/apps.yaml` — the `apps` Kustomization already reconciles
`./apps/staging` with `decryption.provider: sops`.

n8n runs its own TypeORM migrations on boot, so there is **no `db-migrations`
entry** for `n8n-db`.

> The `databases` Flux Kustomization has `wait: true` and gates
> `db-migrations` → `apps`. A broken `n8n-db` stalls the whole app chain.

## One-time setup

### 1. Encryption key (required — do this before the first push)

```bash
cd apps/staging/n8n
cp n8n-secrets.enc.yaml.example n8n-secrets.enc.yaml
# put `openssl rand -hex 32` output in N8N_ENCRYPTION_KEY
sops -e -i n8n-secrets.enc.yaml
```

Until this file exists the `apps` Kustomization fails its build and **stalls** —
nothing is pruned, no outage, same deliberate behaviour as the reflector secret.

> **`N8N_ENCRYPTION_KEY` is the most important secret here after `talsecret`.**
> It encrypts every credential n8n stores in Postgres. Rotate it — or reinstall
> and let n8n generate a fresh one — and every credential in every workflow
> becomes permanently unreadable. **A database restore without this exact key is
> worthless.** Never rotate it.

### 2. Backups (required follow-up — n8n's DB is the only copy of your workflows)

Two files sit side by side, same convention as `fbref`:

- `garage-backup-credentials.enc.yaml` — the **working** file. Ships in
  plaintext with placeholder values so it can be filled in directly in the
  devcontainer. It is the one file in this repo whose `.enc.yaml` name does not
  yet mean what it says.
- `garage-backup-credentials.enc.yaml.exemple` — the pristine template. Stays
  readable after the working file is encrypted, as the record of which keys
  exist and how to mint them. Never edited, never applied.

Fix the naming lie before that file ever holds a real key:

```bash
garage bucket create cnpg-staging-n8n
garage key create n8n-cnpg-staging
garage bucket allow --read --write cnpg-staging-n8n --key n8n-cnpg-staging

cd apps/staging/databases/n8n
$EDITOR garage-backup-credentials.enc.yaml    # replace both PLACEHOLDER values
sops -e -i garage-backup-credentials.enc.yaml # BEFORE `git add`

grep -q 'ENC\[' garage-backup-credentials.enc.yaml && echo SAFE || echo PLAINTEXT
```

Committing it with real values still in plaintext puts the Garage key in git
history permanently; rotating the key is then the only fix.

Then uncomment the three resources and the `cluster-backup-patch.yaml` entry in
`apps/staging/databases/n8n/kustomization.yaml`. Daily base backup at 03:10
(offset from the asp/fbref 03:00 runs so the three don't contend for the single
Garage gateway), 30d retention.

**Uncomment only after the real key is in.** With placeholder credentials the
barman WAL archiver fails, which degrades the CNPG cluster — and `databases`
reconciles with `wait: true` gating `db-migrations` → `apps`, so it stalls the
whole app tier, not just n8n.

### 3. Reaching the UI

```
https://n8n.tail45b0ca.ts.net
```

Tailnet-only, never internet-exposed. A Tailscale **Ingress**
(`apps/base/n8n/ingress-tailscale.yaml`), not the `tailscale.com/expose`
annotation the asp/fbref/Longhorn admin UIs use — same call as ai-gateway and
the Keycloak admin console, because n8n is a password-authenticated dashboard
and its session cookie belongs on a secure origin. MagicDNS issues the
certificate, so `N8N_SECURE_COOKIE` stays at its secure default.

**Precondition:** HTTPS Certificates must be enabled in the Tailscale admin
console (DNS → HTTPS Certificates), or the proxy comes up without a certificate
and the UI is unreachable.

Create the owner account on first visit.

## Egress: the tailnet is inbound only

The Tailscale Ingress publishes the UI; it does **not** change where workflow
traffic goes out. Pods in the `n8n` namespace egress through the node, i.e. the
home ISP address — no `tailscale-proxy-*` Service, no NetworkPolicy.

Keep it that way. At least one intended automation depends on it: LinkedIn's WAF
returns an HTML 400 on image upload from datacenter IP ranges, which is why that
job was moved off GitHub-hosted runners in the first place. Routing this
namespace through a VPN or egress proxy would silently reintroduce the block.

Check it before trusting any workflow that talks to a picky third party:

```bash
kubectl run ipcheck -n n8n --rm -it --restart=Never \
  --image=curlimages/curl -- curl -s https://ifconfig.me
```

Must print the home ISP address.

## Notifications

**Workflow failures are not pushed anywhere, by design.** A failing HTTP call, a
bad payload, an expired token — all of it shows up as a failed execution in
n8n's own **Executions** view (filter: *Error*). Get in the habit of checking it
weekly.

Exactly one thing *is* pushed, because Executions cannot report it:
`monitoring/configs/staging/n8n-metrics/prometheusrule.yaml` fires **N8nDown**
(`up{job="n8n"} == 0` for 10m) and **N8nMetricsMissing**
(`absent(up{job="n8n"})` for 30m) into the existing Telegram Alertmanager
receiver. If n8n is down every automation is stopped, and nothing else would
tell you.

Both rules carry `release: kube-prometheus-stack`, which is mandatory or
`ruleSelector` ignores them. The Service carries an `app: n8n` **label** because
the ServiceMonitor selects on Service labels, not on `spec.selector`.

## Read-only root filesystem

`apps/base/n8n/deployment.yaml` sets `readOnlyRootFilesystem: false`, unlike
every other workload here. n8n writes caches and task-runner scratch outside
`/home/node/.n8n` and crashes on boot with the house default. Everything else in
the security context is standard (`runAsNonRoot`, uid 1000, drop `ALL`,
`RuntimeDefault`).

## Disaster recovery

You need **both** halves or you have nothing:

1. The CNPG backup in `s3://cnpg-staging-n8n` — workflows, executions,
   encrypted credentials.
2. `N8N_ENCRYPTION_KEY` from `apps/staging/n8n/n8n-secrets.enc.yaml` in git.

Restore the cluster from the object store the same way as asp/fbref
(`documentations/03-backups.md`), keep the key untouched, and n8n comes back
with working credentials. A restore with a different key gives you your
workflows with every credential unreadable — re-enter them by hand.

## Adding an automation

1. Build it in the UI. It is backed up with everything else once §2 is done.
2. Secrets go in n8n's own credential store, **not** SOPS — that is the whole
   point of having a credential store with an encryption key.
3. Only touch this repo if the automation needs a new cluster resource (a
   volume, a Service, egress to something on the tailnet).
4. Export the workflow JSON into git if you want a reviewable starting point.
   Note `.gitignore` blanket-ignores `*.json` as a credentials catch-all, so
   that needs a scoped negation — and **never** export credentials themselves.

## Verify

```bash
kubectl kustomize apps/staging                  # must build
kubectl kustomize monitoring/configs/staging    # must build
grep -L ENC apps/staging/n8n/*.enc.yaml         # MUST print nothing

flux get kustomizations                         # databases → db-migrations → apps Ready
kubectl -n n8n get cluster n8n-db               # CNPG Ready first
kubectl -n n8n get pods,pvc,svc,ingress
kubectl -n n8n logs deploy/n8n | head -50       # schema migrations on first boot
kubectl -n tailscale get pods                   # ts-n8n-… proxy registered
```
