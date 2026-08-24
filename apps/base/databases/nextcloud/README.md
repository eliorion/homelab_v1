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

- `cluster-storage-patch.yaml` — `storageClass: longhorn` and `storage.size`
  replaced with `10Gi`.
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

**10Gi in staging, and the reason is WAL, not data.** On 2026-08-21 the primary
filled its 5Gi volume and CNPG halted it with "Not enough disk space", taking
the app tier down with it via the `databases` gate described under Traps. Only
624MB of that was the database: the rest was `pg_wal` that PostgreSQL could not
recycle because WAL archiving was failing, so the segments accumulated until the
volume was full. This is a deadlock CNPG does not resolve on its own — its
low-disk guard short-circuits the reconcile loop before it reaches PVC
reconciliation, so raising `storage.size` in git applies to the Cluster but the
PVCs are never enlarged. See "Operating it" for the manual step.

Growing this cluster is bounded by one node. Both volumes carry three Longhorn
replicas, so +5Gi of `storage.size` costs 10Gi on *every* node, and node-2 was
at 3Gi schedulable at the time — two monitoring replicas had to be evicted off
it first. Check per-node schedulable space before raising the size; the command
is in [`../fbref/README.md`](../fbref/README.md).

**Three Longhorn replicas, unlike `fbref-db`.** fbref runs its volumes at
`numberOfReplicas: 1` because its data is scraped and re-derivable. This one
holds users, shares and file metadata for files that live elsewhere on disk —
losing it does not lose the files but does orphan them, and it is small enough
that three copies cost 30Gi rather than 600Gi. It keeps the default.

**Valkey carries the file locks, so the database does not.** Without a memcache
configured, Nextcloud stores transactional file locks in the `oc_file_locks`
table — every file operation becomes an SQL write, which on this setup means
continuous WAL churn shipped to Garage plus row contention during desktop-client
sync bursts. The `nextcloud-valkey` Deployment in the app tier removes that
entire write path. This is the reason a cache service exists at all.

## Traps

- **A `bootstrap.recovery` patch must carry `database: nextcloud` and
  `owner: app`.** They are not inherited from `initdb`, and CNPG defaults both to
  `app` — the generated `nextcloud-db-app` Secret then feeds `POSTGRES_DB=app` to
  the Nextcloud pod, which reads an empty database instead of the restored 196
  tables. Hit on 2026-08-24; repair procedure in
  [`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).
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
- **A Garage outage fills this volume.** Failing WAL archiving is not just a
  missing backup: PostgreSQL retains every unarchived segment, so a Garage that
  cannot reach write quorum converts directly into a full volume and a halted
  primary. Watch `ContinuousArchiving` on the Cluster, not only the disk.
- **Raising `storage.size` does not resize the PVCs by itself** once the cluster
  is already in "Not enough disk space". Patch them by hand — see "Operating it".

## Operating it

Apply a `storage.size` increase to the PVCs. CNPG does this itself on a healthy
cluster; once the phase is "Not enough disk space" its low-disk guard returns
before PVC reconciliation and the PVCs stay at the old size, so patch them to
the value already in git:

```bash
for p in $(kubectl -n nextcloud get pvc -l cnpg.io/cluster=nextcloud-db -o name); do
  kubectl -n nextcloud patch "$p" --type=merge \
    -p '{"spec":{"resources":{"requests":{"storage":"10Gi"}}}}'
done
```

Longhorn expands online; the filesystem grows without restarting the pods.

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
