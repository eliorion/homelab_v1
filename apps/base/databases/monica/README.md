# monica (database)

The CNPG Postgres cluster behind [Monica HQ](../../monica/README.md): `monica-db`
in namespace `monica`, two instances on the LINSTOR `ssd` class, database
`monica` owned by role `app`. The `monica` Namespace ships from here, not from
the app tier. Backups go to Cloudflare R2 through the barman-cloud plugin and are
**currently off** — see [Traps](#traps).

## How it is wired

| File | What it is |
|---|---|
| `namespace.yaml` | the `monica` Namespace |
| `database.yaml` | `Cluster/monica-db` — 2 instances, 5Gi, `bootstrap.initdb` |
| `../../../staging/databases/monica/` | the staging overlay: storage class, ObjectStore, ScheduledBackup, plugin patch |

CNPG generates the Secret `monica-db-app` with keys `host`, `port`, `dbname`,
`username`, `password`, `uri`. The Monica HelmRelease reads `username` and
`password` from it via `externalDatabase.existingSecret`, and hardcodes the host
as `monica-db-rw` because the chart emits no `DB_PORT` at all — Laravel's pgsql
default of 5432 is what CNPG serves.

The staging overlay adds four things on top of this base:
`cluster-storage-patch.yaml` (JSON6902, `storageClass: ssd`) is live;
`objectstore.yaml`, `scheduledbackup.yaml`, `cluster-backup-patch.yaml` and the
R2 credential are commented out of `kustomization.yaml`.

## Why it is like this

**The `monica` Namespace ships from the databases tier, not from `apps/base/monica`.**
`clusters/staging/apps.yaml` orders `databases` → `db-migrations` → `apps`, each
upstream link carrying `wait: true`, so the namespace and the Cluster are Ready
before the HelmRelease is ever applied. This is the `n8n` and `nextcloud`
arrangement verbatim. The HelmRelease still sets `install.createNamespace: true`
as belt-and-braces, which is a no-op against an existing namespace.

**No `db-migrations` entry.** Monica owns its own schema: the v5 image's
entrypoint runs `php artisan waitfordb` and then `artisan monica:setup --force`
on every start. A Flyway job here would fight it. Same reasoning as
`apps/base/databases/nextcloud/`.

**Backups target R2, not Garage.** The two ObjectStore flavours in this repo are
exact inverses and are not interchangeable — see [Traps](#traps).

**`serverName: monica-db`, with no version suffix.** This cluster has never been
recovered from an archive, so the archive prefix is the plain cluster name.
`nextcloud-db-v2` carries a suffix only because it *was* recovered.

## Traps

- **Do not uncomment the backup entries until the R2 token exists.** With
  placeholder credentials the barman WAL archiver fails, which degrades the
  cluster; `databases` reconciles with `wait: true` and gates `db-migrations` →
  `apps`, so a bad credential here stalls the **whole app tier** — asp, fbref,
  nextcloud, scraper included, not just Monica. The four entries
  (`r2-backup-credentials.enc.yaml`, `objectstore.yaml`, `scheduledbackup.yaml`
  and the `cluster-backup-patch.yaml` patch) must be uncommented together.
- **Never add `AWS_REGION` / `AWS_DEFAULT_REGION` to this ObjectStore.** Those
  belong to the Garage flavour. R2 instead needs both
  `AWS_REQUEST_CHECKSUM_CALCULATION` and `AWS_RESPONSE_CHECKSUM_VALIDATION` set
  to `when_required`, or backup *and* restore fail with
  `XAmzContentSHA256Mismatch` (plugin-barman-cloud #411).
- **Keep `encryption: AES256` on both `wal` and `data`.** R2 supports SSE-S3;
  Garage does not, which is why the Garage stores omit it.
- **`barmanObjectName` must equal the ObjectStore's `metadata.name`** (`r2-store`),
  and changing `serverName` orphans the existing archive.
- **The R2 token must be scoped to `monica-cnpg-staging` only.** One bucket and
  one credential per cluster is the repo rule.
- **`imageName` is not managed by Renovate.** `renovate.json` scopes the
  kubernetes manager to `/apps/.+/db-migrations/.+\.yaml$/`, so the Postgres
  image pin here is bumped by hand.

## Operating it

```sh
kubectl kustomize apps/staging/databases/monica    # render check before commit
kubectl -n monica get cluster,pods,pvc
kubectl -n monica get secret monica-db-app -o jsonpath='{.data.dbname}' | base64 -d
```

Monitoring needs no per-cluster wiring: the PVCs are `monica-db-1` / `monica-db-2`,
which the `.+-db-[0-9]+` regex in
[`../../../../monitoring/configs/staging/cnpg-alerts/prometheusrule.yaml`](../../../../monitoring/configs/staging/cnpg-alerts/prometheusrule.yaml)
already matches, and the WAL-archiving alerts are namespace-agnostic.

### Turning backups on

Everything is written and only needs the bucket. All changes go through git —
nothing here is applied by hand.

1. Create the R2 bucket `monica-cnpg-staging` and a token scoped to it.
2. `cd apps/staging/databases/monica`
3. `cp r2-backup-credentials.enc.yaml.example r2-backup-credentials.enc.yaml`
4. Fill it in, then `sops -e -i r2-backup-credentials.enc.yaml`.
5. Uncomment all four entries in `kustomization.yaml`.
6. `kubectl kustomize apps/staging/databases/monica` to render-check, then commit
   and push; Flux reconciles.

### Overlays

`staging/` is the only reconciled overlay. There is no `production/databases/monica`.
