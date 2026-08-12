# scraper-db

`scraper-db` is the CloudNativePG Postgres cluster behind the central scraper
service (`apps/staging/scraper/`, Helm chart `k8s/charts/scraper` from the asp
repo). It lives in its own `scraper` namespace and runs two instances. It is a
**coordination** database: queues, config and health only. No scraped data is
stored here — asp and fbref consume scraping results through the scraper API and
keep them in their own clusters — which is why this cluster carries no object
store and no backups. The schema is owned by Flyway rather than by this
manifest.

## How it is wired

Base (`apps/base/databases/scraper/`):

- `namespace.yaml` — the `scraper` Namespace.
- `database.yaml` — the CNPG `Cluster` `scraper-db`: `instances: 2`, pinned
  `imageName: ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie`, synchronous
  replication (`method: any`, `number: 1`, `dataDurability: preferred`), tuned
  `postgresql.parameters` (`max_connections: "100"`, `effective_cache_size:
  "512MB"`, `work_mem: "4MB"`, `maintenance_work_mem: "64MB"`),
  `bootstrap.initdb` for database `scraper` owned by `app`, and `storage.size:
  5Gi`. There is no `postInit` block and no `managed.roles` block.
- `kustomization.yaml` — lists `namespace.yaml` and `database.yaml` only.

Staging overlay (`apps/staging/databases/scraper/`):

- `kustomization.yaml` — pulls the base, forces `namespace: scraper`, and
  applies the two patches below. It adds no Secrets and no backup resources.
- `cluster-storage-patch.yaml` — JSON 6902 patch adding
  `/spec/storage/storageClass: longhorn`. Explicit, though Longhorn is also the
  cluster default storage class on Talos.
- `cluster-reflector-patch.yaml` — strategic-merge patch adding
  `inheritedMetadata.annotations` that permit kubernetes-reflector to mirror
  this cluster's generated Secrets into the `database` namespace
  (`reflection-allowed: "true"`, `reflection-allowed-namespaces: "database"`).

Flux: the `databases` Kustomization in
[`clusters/staging/apps.yaml`](../../../../clusters/staging/apps.yaml) applies
`./apps/staging/databases` (which lists `scraper/`) with `wait: true` and SOPS
decryption. It depends on `infra-cnpg-plugin` (the CNPG operator) and on
`infra-reflector`, the central `ghcr-pull-secret` source in
`infrastructure/controllers/staging/reflector` — no `ghcr-pull-secret` is
defined in this component; it is mirrored into the `scraper` namespace from
there.

The schema is applied by the separate `db-migrations` Kustomization, which runs
the Flyway Job `scraper-db-migrate`
(`apps/staging/databases/db-migrations/scraper/`) against the `scraper-db-app`
Secret and gates the `apps` Kustomization on its completion. The scraper
service's own HelmRelease then reconciles under `apps`.

Consumers of the generated `scraper-db-app` Secret: pgAdmin, nao and
`postgres-mcp-scraper` in the `database` namespace
(`infrastructure/services/staging/databases/dbtools/`), all of which read the
replica endpoint `scraper-db-ro.scraper.svc.cluster.local:5432`.

## Why it is like this

**Own namespace and cluster.** The scraper service deploys into its own
`scraper` namespace against its own CNPG cluster. asp and fbref talk to its API,
not to this database; the API is the only project-to-scraper contract.

**`dataDurability: preferred`.** Writes fall back to asynchronous replication
when the replica is unavailable so they never block. There is no real HA here
worth protecting a write path for.

**No `postInit` bootstrap.** The schema is owned by Flyway (the
`scraper-db-migrations` Job, gated ahead of the apps tier), mirroring asp and
fbref. A fresh cluster comes up empty and the Job applies V1 onward as the `app`
owner; an existing cluster is baselined at 0 and the idempotent V-files re-run
as no-ops.

**No `managed.roles`.** Unlike `fbref-db`, the scraper migrations create no
extra roles, so there is nothing for CNPG to manage and no role-password Secret
in the overlay.

**Pinned `imageName`.** The Postgres image is pinned to what the operator
deployed; Renovate bumps it.

**No backups.** This cluster holds queues, config and health only, all
rebuildable from the seed migrations, so it has no `ObjectStore`, no
`ScheduledBackup` and no R2 or Garage credentials. See
[`documentations/03-backups.md`](../../../../documentations/03-backups.md),
which lists `scraper-db` among the deliberately unprotected clusters, and
[`documentations/09-etcd-backup-dr.md`](../../../../documentations/09-etcd-backup-dr.md),
which notes that a full-cluster (Case 2) recovery loses it outright.

**Reflector annotations.** `inheritedMetadata` is CNPG's only hook for
annotating the Secrets the operator generates, in particular the `-app`
connection Secret (cloudnative-pg issue 5883). It stamps *all* cluster objects,
so this overlay puts nothing there but the reflection permit. The `database`
namespace pulls exactly the `-app` Secret through its own explicit `reflects`
stub in
`infrastructure/services/base/databases/dbtools/db-reflect-stubs.yaml`; with no
auto-mirror, the `-ca`, `-server` and `-replication` Secrets are never copied
out of the `scraper` namespace.

**`lab` is not a permitted namespace.** The lab chart's `projects` list
(`apps/staging/lab/release.yaml`) is asp and fbref only, and a permit with no
consumer is a permit nobody audits.

## Traps

- The Cluster image field is `imageName`, not `image`, and
  `ghcr.io/cloudnative-pg/cloudnative-pg` is the *operator* image — it must
  never be used here.
- `dataDurability: required` would block writes whenever the replica is
  unavailable.
- Anything added under `inheritedMetadata` lands on every object the cluster
  owns, not just the `-app` Secret. Keep it to the reflection permit.
- `reflection-allowed-namespaces` deliberately lists `database` only. Adding
  `lab` creates a permit with no consumer.
- Adding a `postInit` bootstrap or a `managed.roles` block would reintroduce a
  schema source that competes with Flyway.
- `storage.size: 5Gi` and the absence of a storage class live in base; the
  `longhorn` storage class is added only by the staging overlay.
- `scraper-db` has no off-cluster backup at all. Do not treat it as a durable
  store for anything that is not rebuildable from the migrations.

## Operating it

Render check before committing:

```bash
kubectl kustomize apps/staging/databases/scraper
flux get kustomizations
```

### Overlays

Only a `staging` overlay exists (`apps/staging/databases/scraper/`);
`apps/production/databases/kustomization.yaml` lists `asp/` only. Base on its
own gives the Namespace and a Cluster with the default storage class and `5Gi`,
no backups and no Secrets. Staging adds the `longhorn` storage class and the
reflector permit annotations, and nothing else.
