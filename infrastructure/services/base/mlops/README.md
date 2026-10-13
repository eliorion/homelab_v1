# mlops

The shared MLOps platform of the asp repo (plan: asp `docs/24-scout-matchmaking-mlops-plan.md`):
**Dagster** orchestrates pipelines, **MLflow** tracks runs, evaluations and model versions. Both
web UIs are on the tailnet only:

| UI | URL | Gate |
|---|---|---|
| Dagster | https://dagster.tail45b0ca.ts.net | the tailnet only — Dagster OSS has no login |
| MLflow | https://mlflow.tail45b0ca.ts.net | the tailnet + MLflow `basic-auth` (user `admin`) |

No pipeline runs here yet: the first code location (the Scout matchmaking pipelines) comes later,
from the asp repo.

## How it is wired

| Object | Where | What |
|---|---|---|
| Namespace `mlops` | `namespace.yaml` | label `name: mlops` |
| HelmRelease `dagster` | `release-dagster.yaml` | the **upstream** `dagster/dagster` chart, pinned (`repository.yaml`). Webserver + daemon as uid 1000 on a read-only root, K8sRunLauncher, storage on `mlops-db`, telemetry off, no user-code subchart |
| HelmRelease `mlops` | `release-mlops.yaml` | the asp chart `k8s/charts/mlops` (GitRepository `mlops`, `clusters/staging/sources.yaml`): MLflow, the Dagster workspace ConfigMap, the network policies, helm tests |
| Ingresses `dagster`, `mlflow` | `ingress-tailscale.yaml` | Tailscale operator, HTTPS 443 |
| CNPG `mlops-db` | `../databases/mlops/` | 1 instance, databases `dagster`, `mlflow`, `mlflow_auth`; roles `dagster` (initdb owner) and `mlflow` (managed) |
| Credentials | `mlflow-auth.yaml`, `../databases/mlops/credentials.yaml` | **generated in the cluster**: an External Secrets `Password` generator feeds `mlops-dagster-db`, `mlops-mlflow-db` and `mlflow-auth` (admin password + CSRF key), once (`refreshPolicy: CreatedOnce`) |
| Bucket `mlflow-artifacts` | `controllers/staging/seaweedfs/s3/` | in-cluster SeaweedFS, identity scoped to that bucket, Secret `s3-mlflow-artifacts` reflected into `mlops` |

The two releases do not wait on each other on purpose: the Dagster pods mount the `mlops` release's
workspace ConfigMap, so a `dependsOn` either way would deadlock the first install.

## Why it is like this

- **Artifacts on SeaweedFS, never Garage.** Garage is off-site, low-bandwidth and small, and it is
  kept for disaster-recovery data. MLflow proxies every artifact (`--serve-artifacts`), so it is
  the only holder of the bucket key.
- **No backup of `mlops-db` yet**, for the same reason: an empty run history is not
  disaster-recovery data. Revisit once registered models are in use.
- **Generated credentials, not OpenBao and not sops.** No human types or needs the two database
  passwords, so there is nothing to seed and nothing to encrypt into git; the generator creates each
  Secret once. CNPG manages both roles from those Secrets (`cnpg.io/reload`), so a regenerated Secret
  re-keys its role instead of locking the app out. The MLflow admin password is the one a human
  reads (below); it only seeds MLflow's first start. The bucket key alone stays sops: the SeaweedFS
  identity file is assembled by Flux substitution from `flux-system` Secrets.
- **One instance.** Memory on staging is short; Dagster and MLflow tolerate a database restart.
- **Separate roles.** MLflow (the component with the CVE history) cannot read Dagster's storage,
  which decides which Jobs the run launcher creates.
- **Dagster ships on `tag:k8s`** like every operator device, because with no code location its UI can
  launch nothing. Before the first code location: add `tag:mlops` (owned by `tag:k8s-operator`) to
  the tailnet policy with a grant to the owner only, then annotate both Ingresses with
  `tailscale.com/tags: tag:mlops`.

## Merge order

1. asp: the PR adding `k8s/charts/mlops` and the `mlops-mlflow` image, then its release
   (`mlops-mlflow-v0.1.0`; bump-chart writes the tag), then the asp PR turning `mlflow.enabled` on.
2. This PR. Flux creates the namespace, the database, the secrets, both releases and both devices.
3. **One manual step, the same as for every bucket:** the SeaweedFS S3 gateway reads its identity
   file at start only, so once Flux has applied it:
   `kubectl -n seaweedfs rollout restart deployment seaweedfs-seaweedfs-s3`.

## Verify

```sh
flux get helmreleases -n flux-system | grep -E 'dagster|mlops'
kubectl -n mlops get pods,cluster,database
flux events --for HelmRelease/mlops -n flux-system   # helm tests: Dagster answers; MLflow answers
                                                      # and refuses an unauthenticated API call
```

The MLflow admin password (user `admin`) seeds the first start only; afterwards rotate it in the
MLflow UI, not in the Secret:

```sh
kubectl -n mlops get secret mlflow-auth -o jsonpath='{.data.auth\.ini}' | base64 -d | grep admin_password
```
