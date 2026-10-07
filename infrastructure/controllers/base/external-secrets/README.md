# external-secrets

The [External Secrets Operator](https://external-secrets.io) copies values from
OpenBao into ordinary Kubernetes Secrets. A workload keeps reading a Secret by name
and needs no change; the Secret is now owned by an `ExternalSecret` instead of a
SOPS file. How secrets are organised in OpenBao, and which ones stay in SOPS, is in
[`../../../services/base/openbao/README.md`](../../../services/base/openbao/README.md).

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Namespace `external-secrets`, PodSecurity `restricted`. The chart's three Deployments satisfy it unchanged. |
| `repository.yaml` | `HelmRepository` `external-secrets`, `https://charts.external-secrets.io`. |
| `release.yaml` | `HelmRelease` `external-secrets`, chart `2.12.0`: controller, webhook and cert controller, CRDs created and replaced by Helm, the cluster-scoped kinds disabled. |

Flux drives it from `clusters/staging/infrastructure.yaml`, Kustomization
`infra-external-secrets` (`wait: true`, 5 minute timeout).
**`infrastructure-services` depends on it**, so the `SecretStore` and
`ExternalSecret` CRDs exist before anything in the services tier uses them. The
`apps` chain (`databases` → `db-migrations` → `apps`) does **not** depend on it
yet: the first app moved to OpenBao has to add `infra-external-secrets` to
`databases`' `dependsOn`, or a cold bootstrap applies its `ExternalSecret` before
the CRD exists.

## Why it is like this

**Only namespaced kinds.** `ClusterSecretStore`, `ClusterExternalSecret`,
`ClusterGenerator` and `ClusterPushSecret` are neither installed as CRDs nor
reconciled, and `PushSecret` is not reconciled. A cluster-scoped store has one
identity for every namespace, so any namespace allowed to create an
`ExternalSecret` could read everyone's secrets through it; with only `SecretStore`
left, each namespace logs in to OpenBao as its own ServiceAccount and OpenBao
limits it to its own folder. `PushSecret` writes *into* OpenBao, which no
workload here should do.

**The Secret survives OpenBao being down.** External Secrets keeps the last
written Secret when the backend is unreachable and reports the `ExternalSecret`
not ready; it does not delete the Secret. A pod restarting during an OpenBao
outage still starts.

## Traps

- **A Secret change does not restart pods.** A workload that reads its Secret
  through `envFrom` keeps the old value until it restarts.
- **`creationPolicy: Owner` deletes the Secret with the `ExternalSecret`.** Removing
  an `ExternalSecret` from git deletes the Secret it made; re-adding the SOPS file
  in the same commit is how a migration is rolled back.
- **Re-enabling a cluster-scoped kind is two settings**: the `crds.create…` flag
  and the matching `process…` flag. One without the other leaves the controller
  watching a CRD that does not exist, or a CRD nobody reconciles.

## Operating it

```bash
kubectl get secretstore,externalsecret -A
kubectl -n <ns> describe externalsecret <name>     # Ready condition and last sync error
kubectl -n external-secrets logs deploy/external-secrets | tail
```
