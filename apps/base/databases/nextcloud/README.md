# nextcloud-db

The Postgres cluster behind the Nextcloud instance in
[`apps/base/nextcloud`](../../nextcloud/README.md). CNPG `Cluster`
`nextcloud-db`: 2 instances, database `nextcloud`, owner `app`, backed up to
Garage.

This directory also ships the **`nextcloud` Namespace**. The `databases` Flux
Kustomization reconciles before `apps` (`clusters/staging/apps.yaml`:
`apps` → `dependsOn: db-migrations` → `dependsOn: databases`), so shipping the
namespace here means the app tier always lands into an existing namespace and
never races the CNPG cluster it needs credentials from.

## How it is wired

- `namespace.yaml` — the `nextcloud` Namespace, shared by the database and the app.
- `database.yaml` — the `Cluster`. 2 instances, `imageName`
  `ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie`, 5Gi base storage,
  synchronous replication `any/1` with `dataDurability: preferred`.
- CNPG generates the `nextcloud-db-app` Secret (`host`, `port`, `dbname`,
  `username`, `password`, `uri`, …). The Nextcloud Deployment reads
  `host`/`dbname`/`username`/`password` from it as `POSTGRES_*` — nothing in
  this repo ever writes those values.

The staging overlay (`apps/staging/databases/nextcloud/`) adds:

- `cluster-storage-patch.yaml` — `storageClass: longhorn`.
- `garage-backup-credentials.enc.yaml` — the Garage S3 key used by the barman
  sidecars. `…​.exemple` is the plaintext template; the real file is SOPS-encrypted.
- `objectstore.yaml` — barman-cloud `ObjectStore` `garage-store`: 7d retention,
  `s3://cnpg-staging-nextcloud`, endpoint
  `http://garage-s3.garage-gw.svc.cluster.local:3900`, gzip on WAL and data.
- `scheduledbackup.yaml` — daily base backup at **03:30**, deliberately offset
  from `fbref-db`'s 03:00 so two barman jobs do not push through the single
  HAProxy → Tailscale → Garage path at once.
- `cluster-backup-patch.yaml` — attaches the plugin as the WAL archiver,
  `barmanObjectName: garage-store`, `serverName: nextcloud-db`.

## Why it is like this

**No `db-migrations` entry.** Nextcloud owns its own schema: the container
entrypoint runs `occ maintenance:install` against an empty database on first
boot, and `occ upgrade` after every image bump. A Flyway job in
`apps/staging/databases/db-migrations/` would fight it. The `initdb` block
therefore creates an *empty* `nextcloud` database and stops there.

**2 instances, not 3.** Nextcloud is a single-writer application with no read
splitting; the replica exists for failover and for the synchronous quorum, not
for throughput. `dataDurability: preferred` means a lost replica degrades
durability instead of freezing every write — with `required`, one replica down
would take Nextcloud offline entirely.

**Backups to Garage, not R2.** Same reasoning as `fbref-db`: R2 is reserved for
the two clusters that already live there (`keycloak-db`, `asp-db`), and Garage
is the free-tier off-site target. See
[`documentations/03-backups.md`](../../../../documentations/03-backups.md).

**Valkey carries the file locks, so the database does not.** Without a memcache
configured, Nextcloud stores transactional file locks in the `oc_file_locks`
table — every file operation becomes an SQL write, which on this setup means
continuous WAL churn shipped to Garage plus row contention during desktop-client
sync bursts. The `nextcloud-valkey` Deployment in the app tier removes that
entire write path. This is the reason a cache service exists at all.

## Traps

- **`imageName`, not `image`.** And never
  `ghcr.io/cloudnative-pg/cloudnative-pg` — that is the *operator* image.
- **`AWS_REGION` and `AWS_DEFAULT_REGION` must both stay `garage`.** A wrong
  region 400s the HeadBucket that `barman-cloud-check-wal-archive` issues while
  the archive is still EMPTY — invisible now, fatal when restoring into a fresh
  cluster.
- **No `encryption:` under `wal:` or `data:`.** Garage implements SSE-C only;
  requesting SSE-S3/AES256 fails every upload.
- **Placeholder Garage credentials stall the whole app tier.** The `databases`
  Flux Kustomization runs with `wait: true` and gates `db-migrations`, which
  gates `apps`. A barman sidecar that cannot authenticate degrades the cluster,
  the Kustomization never reports Ready, and every app behind it stops
  reconciling. Create the bucket and key *before* the first push.
- **The bucket name is `cnpg-staging-nextcloud`.** `destinationPath` and the key
  grant must agree, or the failure only surfaces at restore time.

## Operating it

Create the Garage bucket and a key scoped to it (run on a Garage node — the
`garage` CLI is not reachable from the cluster):

```bash
garage bucket create cnpg-staging-nextcloud
garage key create nextcloud-cnpg-staging
garage bucket allow --read --write cnpg-staging-nextcloud --key nextcloud-cnpg-staging
```

Then fill the template and encrypt it in place:

```bash
cd apps/staging/databases/nextcloud
cp garage-backup-credentials.enc.yaml.exemple garage-backup-credentials.enc.yaml
$EDITOR garage-backup-credentials.enc.yaml   # paste the key id + secret
sops -e -i garage-backup-credentials.enc.yaml
```

Check the cluster and the backups:

```bash
kubectl -n nextcloud get cluster nextcloud-db
kubectl -n nextcloud get backup
kubectl -n nextcloud logs nextcloud-db-1 -c plugin-barman-cloud
```

### Overlays

- `apps/staging/databases/nextcloud/` — Longhorn storage class + the full Garage
  backup wiring described above.
- No production overlay.
