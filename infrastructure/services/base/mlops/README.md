# mlops

The shared MLOps platform of the asp repo (plan: asp `docs/24-scout-matchmaking-mlops-plan.md`):
**Dagster** orchestrates pipelines, **MLflow** tracks runs, evaluations and model versions. Both
web UIs are on the tailnet only:

| UI | URL | Gate |
|---|---|---|
| Dagster | https://dagster.tail45b0ca.ts.net | the tailnet only — Dagster OSS has no login |
| MLflow | https://mlflow.tail45b0ca.ts.net | the tailnet + MLflow `basic-auth` (user `admin`) |

No pipeline runs here yet: the first code location (the Scout matchmaking pipelines) comes later.

## How it is wired

| Object | File | What |
|---|---|---|
| Namespace `mlops` | `namespace.yaml` | label `name: mlops` |
| HelmRelease `dagster` | `release-dagster.yaml` | upstream `dagster/dagster` chart, pinned: webserver + daemon as uid 1000 on a read-only root, K8sRunLauncher, storage on `mlops-db`, telemetry off, no user-code subchart |
| HelmRelease `mlflow` | `release-mlflow.yaml` | the **official** chart `oci://ghcr.io/mlflow/charts/mlflow` with the official `ghcr.io/mlflow/mlflow:vX.Y.Z-full` image (Postgres driver, boto3 and the auth extras built in) |
| ConfigMap `dagster-workspace` | `dagster-workspace.yaml` | the code locations Dagster loads; empty |
| Policies | `networkpolicies.yaml` | ingress to both UIs from the Tailscale proxy and Homepage only; MLflow egress to its database, SeaweedFS and DNS; Dagster egress to DNS, its database and the Kubernetes API |
| Ingresses `dagster`, `mlflow` | `ingress-tailscale.yaml` | Tailscale operator, HTTPS 443 |
| CNPG `mlops-db` | `../databases/mlops/` | 1 instance; databases `dagster`, `mlflow`, `mlflow_auth`; roles `dagster` (initdb owner) and `mlflow`, both managed from their Secrets |
| Credentials | `../../staging/mlops/secrets/` | ExternalSecrets from OpenBao `kv/mlops/*` |
| Bucket `mlflow-artifacts` | `controllers/staging/seaweedfs/s3/` | in-cluster SeaweedFS, identity scoped to that bucket, Secret `s3-mlflow-artifacts` reflected into `mlops` |

### Credentials (OpenBao)

| OpenBao path | Keys | Becomes |
|---|---|---|
| `kv/mlops/mlflow-db` | `password` | `mlops-mlflow-db`: username, password (CNPG role `mlflow`) and `uri`, MLflow's backend store |
| `kv/mlops/mlflow-auth` | `admin-password`, `flask-secret-key` | `mlflow-auth`: `auth.ini` (its store URI is built from `kv/mlops/mlflow-db`) and the CSRF key |
| `kv/mlops/dagster-db` | `password` | `mlops-dagster-db`: username, password (CNPG) and `postgresql-password` (the dagster chart) |

**Seed them before the first reconcile** (hex only: the values land in a URI and an INI file).
Login as in `../openbao/README.md`, then:

```sh
bao kv put kv/mlops/mlflow-db   password="$(openssl rand -hex 32)"
bao kv put kv/mlops/mlflow-auth admin-password="$(openssl rand -hex 24)" flask-secret-key="$(openssl rand -hex 32)"
bao kv put kv/mlops/dagster-db  password="$(openssl rand -hex 32)"
```

Without them the ExternalSecrets stay `SecretSyncedError`, `mlops-db` waits for its bootstrap Secret and
both releases retry; nothing breaks, nothing starts.

## Why it is like this

- **Official MLflow chart and image.** The `-full` image already carries the drivers, so nothing is
  built or installed at start. The chart's defaults are already non-root uid 1000, read-only root,
  all capabilities dropped. Two gaps are filled here: the chart runs no schema migration (the
  `db-upgrade` init container, same image tag), and its NetworkPolicy admits every pod of every
  namespace (disabled; `networkpolicies.yaml` instead).
- **MLflow hardening.** `basic-auth` with `default_permission = NO_PERMISSIONS`; a Host-header
  allowlist (`allowed_hosts`: the in-cluster names and the tailnet device); the job runner off
  (`MLFLOW_SERVER_ENABLE_JOB_EXECUTION=false`: ~1.5 GiB of huey workers, unused, and the API
  surface of CVE-2026-0545); never below v3.15.0 (CVE-2026-64849, an SSRF the egress policy also
  blunts). Artifacts are proxied (`--serve-artifacts`), so MLflow is the only holder of the bucket key.
- **Artifacts on SeaweedFS, never Garage.** Garage is off-site, low-bandwidth and small, kept for
  disaster-recovery data.
- **No backup of `mlops-db` yet**, for the same reason; revisit once registered models are in use.
  One instance: staging memory is short.
- **Separate database roles.** MLflow, the component with the CVE history, cannot read Dagster's
  storage, which decides which Jobs the run launcher creates.
- **Credentials in OpenBao** (the house rule for application credentials). The bucket key alone stays
  sops: the SeaweedFS identity file is assembled by Flux substitution from `flux-system` Secrets.
- **The releases do not depend on each other.** Dagster's pods mount `dagster-workspace`, which is
  plain here, so neither waits on the other.
- **Dagster ships on `tag:k8s`** like every operator device: with no code location its UI can launch
  nothing. Before the first code location, add `tag:mlops` (owned by `tag:k8s-operator`) to the
  tailnet policy with a grant to the owner only, and annotate both Ingresses with
  `tailscale.com/tags: tag:mlops`.

## Operating it

- **Rotate a database password:** `bao kv put` a new value. Within the hour the ExternalSecret
  updates, CNPG re-keys the role (`cnpg.io/reload`); restart MLflow (or Dagster) to pick it up.
- **The MLflow admin password only seeds the first start.** Rotate it in the MLflow UI, then update
  `kv/mlops/mlflow-auth` so it stays the break-glass.
- **Bump MLflow:** chart `version` and both image tags in `release-mlflow.yaml` move together.

## After merge (one manual step, as for every bucket)

The SeaweedFS S3 gateway reads its identity file at start only:
`kubectl -n seaweedfs rollout restart deployment seaweedfs-seaweedfs-s3`.

## Verify

```sh
flux get helmreleases -n flux-system | grep -E 'dagster|mlflow'
kubectl -n mlops get pods,cluster,database,externalsecret
curl -s -o /dev/null -w '%{http_code}\n' https://mlflow.tail45b0ca.ts.net/api/2.0/mlflow/experiments/search   # 401 without login
```
