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

Flux applies this through `clusters/staging/apps.yaml`: the Kustomization
`databases` reconciles `./apps/staging/databases` (whose kustomization lists
`asp/`), `dependsOn` `infra-cnpg-plugin` and `infra-reflector`, decrypts with
SOPS and uses `wait: true`, so it is Ready only when the CNPG Cluster reports
Ready. `db-migrations` depends on `databases` (it needs `asp-db` and the
generated `asp-db-app` secret), `apps` depends on `db-migrations`, and
`clusters/staging/lab.yaml` also depends on `databases`.

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
`monitoring.enablePodMonitor`. Those four were carried in the manifest as
commented-out stubs (`shared_buffers: "256MB"`, `superuserSecret:
postgres-superuser-secret`, `monitoring.enablePodMonitor: true`, and a
`walStorage` of `5Gi` on a `fast-ssd` class that does not exist here) — kept
here as the record of what was considered, since none of them is set.

`imageName` pins the PostgreSQL image to the version the operator deployed. It is
bumped by hand: `renovate.json` scopes the kubernetes manager to
`/apps/.+/db-migrations/.+\.yaml$/`, so Renovate never reads this file.

**`createrole` on the `app` role.** Flyway migrations V6 (`webapp_ro`) and V8
(`grafana_ro`) run `CREATE ROLE` while connected as `app`, which therefore needs
`CREATEROLE`. Without it the migration image fails at V6 and — once the chart
runs it as a pre-upgrade hook — takes every asp upgrade down with it. That is
why `asp-db` once sat at V5 while `db-migrations` was at `v0.6.0`. `fbref-db`
carries the same grant for its own reason, recorded in
`apps/base/databases/fbref/database.yaml`: its Flyway V3 creates the
`worker-control` and `nocodb` roles while connected as `app`.

**That incident is closed, and saying otherwise misleads.** The grant fixed it;
a stale "stuck at V5" note survived in the manifest long after and was read as
an open incident, justifying work that had already landed. Measured on staging
2026-08-12: `flyway_schema_history` at `max(version) = 9`, all success; `app`
has `login=true` and `createrole=true`; `webapp_ro` and `grafana_ro` exist as
`NOLOGIN`, with `grafana_ro` holding 7 table grants.

**Why the read-only roles are `NOLOGIN` and unmanaged.** Both appear under
`managedRolesStatus.byStatus["not-managed"]`, which is the correct state rather
than a gap: Flyway creates the role and its grants — the privilege boundary —
and CNPG is what would attach a credential. Nothing has needed one yet. To give
`grafana_ro` a login, add it to the roles list *with* a `passwordSecret` **in
the staging overlay as a patch, never in this base**: the Secret it would name
lives only in the overlay, and the base must stay renderable without any
overlay's Secrets.

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
fails with `must be owner of table`. The failure string is recorded in
`db-init-configmap.yaml` itself; no document in `documentations/` carries it.

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
(pgAdmin, nao and postgres-mcp, all in
`infrastructure/services/base/databases/dbtools/`) — pulls exactly the `-app`
connection secret with its own explicit `reflects` stub (`database`'s stubs are
declared in that directory's `db-reflect-stubs.yaml`; `lab`'s are generated by
the lab chart), so
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
under `asp-db`). `cluster-backup-patch.yaml` carried `serverName: asp-db-r1` for
the duration; `f93235f fix(asp-db): collapse staging backup to single asp-db
serverName` put it back. The restore did not succeed: on 2026-06-12 the WAL segment
`2C0` — the `begin_wal` of the only base backup — turned out to have been
deleted with the `asp-db-talos` prefix prune, so `asp-db` was re-created as a
fresh `initdb`. Doc 06's header records the end state: the interim prefixes were
deleted and the live cluster archives under the canonical `serverName: asp-db`
with a fresh post-rename base backup, which is what `cluster-backup-patch.yaml`
declares today.

The data was not lost with the restore. Doc 07 records the salvage on the same
day: `barman-cloud-restore` of the base backup tar in a scratch pod,
`pg_resetwal` past the missing segment, then `pg_dump` and
`pg_restore --data-only` into the fresh cluster — 29.7k listings plus price
history recovered
([`../../../../documentations/07-talos-ha-expansion.md`](../../../../documentations/07-talos-ha-expansion.md)).

`cluster-recovery-patch.yaml` survives on disk but is no longer listed in the
staging kustomization, and it is inert for a second reason: CNPG reads
`bootstrap` only at first creation, so the file changes nothing on the running
cluster. Deleting it, and pruning the superseded R2 prefixes, is cleanup left
for later.

## Traps

- A `bootstrap.recovery` patch must carry `database: automarket` and
  `owner: app`. They are not inherited from `initdb`, and CNPG defaults both to
  `app`, so the generated `asp-db-app` Secret ends up pointing at an empty `app`
  database while the restored `automarket` sits untouched beside it — all four
  workloads (`admin-ui`, `analyzer-cars`, `asp-engine`, `webapp`) read
  `asp-db-app/uri`. Hit on 2026-08-24; repair procedure in
  [`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).
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
  Cloudflare R2 in **every** ObjectStore. Without them backup *and* restore
  fail.
- A recovered cluster must archive under a different `serverName` than the one
  it restored from, and pruning an old prefix can take the `begin_wal` of the
  only base backup with it — which is exactly how the 2026-06-11 restore was
  lost.
- `inheritedMetadata` stamps every object the cluster generates. Keep it to the
  reflection *permission*; do not add an auto-mirror annotation there, or the
  `-ca` / `-server` / `-replication` secrets leak into `lab` and `database`.
- `*.enc.yaml` files are SOPS ciphertext. Never open or edit them by hand.

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

`staging` is the only overlay. It adds `r2-backup-credentials.enc.yaml`,
`objectstore.yaml` (`r2-store` → `s3://asp-cnpg-staging`) and
`scheduledbackup.yaml` (`asp-db-daily`, `0 0 3 * * *`) against the R2 account
endpoint `https://07e577de68147de704bb467debe46e21.r2.cloudflarestorage.com`,
plus the storage-class and reflector patches listed above.

A production overlay (bucket `s3://asp-cnpg-production` plus a temporary
seed-from-staging recovery patch) was never reconciled and was deleted with the
rest of the production tree on 2026-09-15.
