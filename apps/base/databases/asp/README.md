# db-asp

`asp-db` is the CloudNativePG Postgres cluster that holds the Automarket
(leboncoin scraper) data — listings, price history, the scrape queue, the worker
control row and the orchestrator's search requests. The base layer creates the
`asp` namespace, the `Cluster` itself and the ConfigMap holding the full
bootstrap schema; the environment overlays add the barman-cloud backup wiring
(ObjectStore, ScheduledBackup, SOPS-encrypted R2 credentials) and, in staging,
the Longhorn storage class and the reflector permission that lets other
namespaces read the generated connection secret. The cluster is the first link
in the app chain: `databases` → `db-migrations` (Flyway) → `apps`.

## How it is wired

Base (`apps/base/databases/asp/`, aggregated by
`apps/<env>/databases/kustomization.yaml`):

| File | What it creates |
|---|---|
| `namespace.yaml` | Namespace `asp` |
| `database.yaml` | `postgresql.cnpg.io/v1` `Cluster` `asp-db` — 2 instances, image `ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie`, 20Gi storage, `initdb` into database `automarket` owned by `app` |
| `db-init-configmap.yaml` | ConfigMap `asp-db-init`, key `init.sql` — the whole Automarket schema, referenced from `bootstrap.initdb.postInitApplicationSQLRefs` |
| `kustomization.yaml` | lists the three above |

Staging (`apps/staging/databases/asp/`):

| File | Role |
|---|---|
| `objectstore.yaml` | `ObjectStore` `r2-store` → `s3://asp-cnpg-staging` on Cloudflare R2, 7d retention, gzip + AES256, `jobs: 2` |
| `scheduledbackup.yaml` | `ScheduledBackup` `asp-db-daily`, `0 0 3 * * *`, `method: plugin`, `immediate: true` |
| `r2-backup-credentials.enc.yaml` | SOPS-encrypted Secret `r2-backup-credentials` (`ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`) |
| `cluster-backup-patch.yaml` | attaches the barman-cloud plugin as WAL archiver, `barmanObjectName: r2-store`, `serverName: asp-db` |
| `cluster-storage-patch.yaml` | JSON6902 patch adding `spec.storage.storageClass: longhorn` |
| `cluster-reflector-patch.yaml` | `inheritedMetadata` annotations allowing kubernetes-reflector to mirror into `lab` and `database` |
| `cluster-recovery-patch.yaml` | **not referenced** by `kustomization.yaml`; leftover from the 2026-06-11 restore (see below) |

Production (`apps/production/databases/asp/`) — see [Overlays](#overlays).

Flux applies this through `clusters/staging/apps.yaml`: the Kustomization
`databases` reconciles `./apps/staging/databases` (whose kustomization lists
`asp/`), `dependsOn` `infra-cnpg-plugin` and `infra-reflector`, decrypts with
SOPS and uses `wait: true`, so it is Ready only when the CNPG Cluster reports
Ready. `db-migrations` depends on `databases` (it needs `asp-db` and the
generated `asp-db-app` secret), `apps` depends on `db-migrations`, and
`clusters/staging/lab.yaml` also depends on `databases`. Production is wired the
same way from `clusters/production/apps.yaml` (`path: ./apps/production`).

## Why it is like this

**Replication.** Two instances with `synchronous.method: any`, `number: 1` — the
primary waits for one replica acknowledgement per commit.
`dataDurability: preferred` makes it fall back to asynchronous replication when
the replica is unavailable, so writes never block; this is a homelab, there is
no real HA to protect.

**Postgres settings.** `wal_level: logical` is set to enable logical replication
for CDC. `max_connections: "200"`, `effective_cache_size: 768MB`,
`work_mem: 4MB` and `maintenance_work_mem: 64MB` are the sizing for this box.
`shared_buffers` is left at the image default, and the cluster declares no
`superuserSecret`, no separate `walStorage` volume and no
`monitoring.enablePodMonitor`.

**`createrole` on the `app` role.** Flyway migrations V6 (`webapp_ro`) and V8
(`grafana_ro`) run `CREATE ROLE` while connected as `app`, which therefore needs
`CREATEROLE`. Without it the migration image fails at V6 and — once the chart
runs it as a pre-upgrade hook — takes every asp upgrade down with it. That is
why `asp-db` sat at V5 while `db-migrations` was at `v0.6.0`. `fbref-db`
received the same grant after the identical failure on 2026-06-12
(see [`../../../../documentations/07-talos-ha-expansion.md`](../../../../documentations/07-talos-ha-expansion.md));
`asp-db` did not, until this `managed.roles` block was added.

**The init schema.** `db-init-configmap.yaml` carries `init.sql`, written to be
idempotent so it is safe on a clean database and on a re-run. It creates
`listings` (source of truth: `data/data/models.py`, cross-checked against
`scraping/scraping/pipelines.py`), `price_history`, `scrape_queue`,
`worker_control` (single control row, seeded with `ON CONFLICT DO NOTHING`) and
`search_requests` (orchestrator-issued search jobs the crawler claims and
paginates into `scrape_queue`), plus partial indexes covering only the `pending`
rows that the workers and the crawler claim, and a partial index for the
orchestrator's re-arm scan over `scheduled` searches. The file starts with
`SET ROLE app` and ends with explicit `GRANT`s and `ALTER DEFAULT PRIVILEGES`
because `postInitApplicationSQL` runs as the `postgres` superuser: without them
the schema lands owned by `postgres` and the Flyway job, connecting as `app`,
fails with `must be owner of table` (hit 2026-06-12, doc 07).

**Backups.** Daily base backup plus continuous WAL archiving through the
barman-cloud CNPG-I plugin gives point-in-time recovery inside the 7d retention
window. `serverName` is the per-cluster prefix inside the bucket. The R2
checksum environment variables in every ObjectStore exist because boto3 >= 1.36
sends data-integrity checksums that R2 rejects with `XAmzContentSHA256Mismatch`
(upstream `plugin-barman-cloud` issue #411). Full design in
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).

**Secret reflection.** `inheritedMetadata` is CNPG's only hook for annotating the
Secrets it generates (`cloudnative-pg` issue #5883), and it stamps *all* cluster
objects — so the staging patch sets only the reflection *permission*
(`reflection-allowed`, `reflection-allowed-namespaces: "lab,database"`), never an
auto-mirror. Each consumer namespace — `lab` (`apps/staging/lab/`) and `database`
(pgAdmin + nao, `infrastructure/services/staging/databases/dbtools/`) — pulls
exactly the `-app` connection secret with its own explicit `reflects` stub (in
`lab`'s case the stub Secrets are generated by the lab chart), so
the `-ca` / `-server` / `-replication` secrets are never copied out of `asp`.
The per-namespace `ghcr-pull-secret` was likewise dropped: the central reflector
source (`infrastructure/controllers/staging/reflector`) mirrors it into `asp`,
and the `databases` Kustomization `dependsOn` `infra-reflector` so it exists
before the db-migration Job pulls.

**Recovery history.** On 2026-06-11 the HA-expansion storm reformatted the
Longhorn volumes (doc 07 troubleshooting) and `asp-db` was pointed at a
bootstrap recovery from its own R2 barman archive — the recovered cluster was
meant to archive under a *different* `serverName` (`asp-db-r1`), because you
never archive into the path you are restoring from (precedent in
[`../../../../documentations/06-k3s-retirement.md`](../../../../documentations/06-k3s-retirement.md),
where the Talos cluster archived to `asp-db-talos` while the k3s history stayed
under `asp-db`). The restore did not succeed: on 2026-06-12 the WAL segment
`2C0` — the `begin_wal` of the only base backup — turned out to have been
deleted with the `asp-db-talos` prefix prune, so `asp-db` was re-created as a
fresh `initdb`. Doc 06's header records the end state: the interim prefixes were
deleted and the live cluster archives under the canonical `serverName: asp-db`
with a fresh post-rename base backup, which is what `cluster-backup-patch.yaml`
declares today. `cluster-recovery-patch.yaml` survives on disk but is no longer
listed in the staging kustomization.

## Traps

- `imageName`, not `image`. `ghcr.io/cloudnative-pg/cloudnative-pg` is the
  *operator* image and must never be set here.
- `postgresql.synchronous.number` must stay lower than `spec.instances`. It is
  `1` against `instances: 2`; changing one without the other breaks the cluster.
- `managed.roles[app].createrole: true` is load-bearing for the Flyway
  migrations. Removing it re-breaks V6/V8 and every asp upgrade that runs them
  as a pre-upgrade hook.
- `db-init-configmap.yaml` is ConfigMap *content*: the `--` lines inside
  `init.sql` are data, not YAML comments, and `postInitApplicationSQLRefs` is
  consumed only during the `initdb` bootstrap. Editing it changes nothing on an
  already-bootstrapped cluster — schema changes go through Flyway in
  `apps/staging/databases/db-migrations/`.
- `SET ROLE app` at the top of `init.sql`, and the `GRANT` /
  `ALTER DEFAULT PRIVILEGES` block at the bottom, are what keep the schema
  usable by `app`. Dropping either reproduces `must be owner of table`.
- The two `AWS_*_CHECKSUM_*: when_required` sidecar env vars are required for
  Cloudflare R2 in **every** ObjectStore (staging and production, including
  `objectstore-staging.yaml`). Without them backup *and* restore fail.
- A recovered cluster must archive under a different `serverName` than the one
  it restored from, and pruning an old prefix can take the `begin_wal` of the
  only base backup with it — which is exactly how the 2026-06-11 restore was
  lost.
- `inheritedMetadata` stamps every object the cluster generates. Keep it to the
  reflection *permission*; do not add an auto-mirror annotation there, or the
  `-ca` / `-server` / `-replication` secrets leak into `lab` and `database`.
- `*.enc.yaml` files are SOPS ciphertext. Never open or edit them by hand.
- Production's seed-from-staging pieces (`objectstore-staging.yaml`,
  `r2-staging-backup-credentials.enc.yaml`, `cluster-recovery-patch.yaml`) are
  marked TEMPORARY. CNPG honours a `bootstrap` stanza only at first cluster
  creation, so they must be in place *before* the prod cluster exists and are
  inert afterwards; remove them once the prod cluster is seeded and verified.

## Operating it

Render before committing:

```sh
kubectl kustomize apps/staging/databases/asp
flux get kustomizations
```

Trigger an on-demand backup instead of waiting for 03:00:

```sh
kubectl cnpg backup asp-db -n asp \
  --method=plugin --plugin-name=barman-cloud.cloudnative-pg.io
```

Check archiving and backup status:

```sh
kubectl -n asp get cluster asp-db -o jsonpath='{.status.conditions}'
kubectl -n asp get scheduledbackup,backup
```

Restore drills follow the PITR recipe in
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md):
recover into a throwaway cluster with `bootstrap.recovery` and **no**
`spec.plugins`, so the test cluster cannot archive back onto the source's chain.

### Overlays

`staging` and `production` share the base and both add
`r2-backup-credentials.enc.yaml`, `objectstore.yaml` (`r2-store`) and
`scheduledbackup.yaml` (identical `asp-db-daily`, `0 0 3 * * *`), against the
same R2 account endpoint
`https://07e577de68147de704bb467debe46e21.r2.cloudflarestorage.com`.

Differences actually on disk:

| | staging | production |
|---|---|---|
| Bucket | `s3://asp-cnpg-staging` | `s3://asp-cnpg-production` |
| Storage class patch | `cluster-storage-patch.yaml` → `longhorn` | none (cluster default) |
| Reflector patch | `cluster-reflector-patch.yaml` (`lab`, `database`) | none |
| Recovery patch | file present but **not** in `patches` | `cluster-recovery-patch.yaml` **is** applied (seed from staging) |
| Extra resources | — | `objectstore-staging.yaml` (`r2-store-staging` → `s3://asp-cnpg-staging`, secret `r2-staging-credentials`) and `r2-staging-backup-credentials.enc.yaml` |

The production recovery patch replaces `/spec/bootstrap` with a
`recovery` bootstrap from `asp-db-staging` (database `automarket`, owner `app`)
and adds an `externalClusters` entry pointing at `r2-store-staging` /
`serverName: asp-db`, so the first production cluster is seeded from staging's
archive while its own archiving still goes to `r2-store`. Both the extra
resources and the patch are marked TEMPORARY (plan Step 6).

Note that `../../../../documentations/03-backups.md` flags the production tree as
not deployed, and as still pointing both production clusters at a single shared
`asp-cnpg-production` bucket — the layout staging deliberately moved away from.
Fix that before the production overlay is ever reconciled.
