# n8n-db

`n8n-db` is the CloudNativePG Postgres cluster behind the cluster's n8n
automation host. It lives in its own `n8n` namespace and runs two instances.
Unlike `asp-db` and `fbref-db` its schema is not owned by Flyway: n8n runs its
own TypeORM migrations on every boot, so a fresh cluster comes up empty and the
first n8n pod creates the whole schema. That database is the only copy of every
n8n workflow and every stored credential — nothing about n8n lives in git — so
the off-cluster backup to Garage is the point of this directory, not an extra.
The backup resources are written and staged but currently commented out of the
staging overlay.

## How it is wired

Base (`apps/base/databases/n8n/`):

- `namespace.yaml` — the `n8n` Namespace.
- `database.yaml` — the CNPG `Cluster` `n8n-db`: 2 instances, pinned
  `imageName: ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie`, synchronous
  replication (`method: any`, `number: 1`, `dataDurability: preferred`), tuned
  `postgresql.parameters` (`max_connections: "100"`,
  `effective_cache_size: "512MB"`, `work_mem: "4MB"`,
  `maintenance_work_mem: "64MB"`), `bootstrap.initdb` for database `n8n` owned
  by `app`, and `storage.size: 5Gi`.
- `kustomization.yaml` — lists `namespace.yaml` and `database.yaml` only.

Staging overlay (`apps/staging/databases/n8n/`):

- `kustomization.yaml` — pulls the base, forces `namespace: n8n`, applies the
  storage patch, and carries the backup resources and the backup patch
  commented out.
- `cluster-storage-patch.yaml` — JSON 6902 patch adding
  `storageClass: longhorn` to `spec.storage` (explicit — Longhorn is also the
  cluster default storage class).
- `cluster-backup-patch.yaml` — attaches the `barman-cloud.cloudnative-pg.io`
  plugin to the Cluster as the WAL archiver, `barmanObjectName: garage-store`,
  `serverName: n8n-db`. **Not applied**: its `patches:` entry is commented out.
- `objectstore.yaml` — the barman-cloud `ObjectStore` `garage-store`: `30d`
  retention, `s3://cnpg-staging-n8n`, endpoint
  `http://garage-s3.garage-gw.svc.cluster.local:3900`, gzip on WAL and data,
  `jobs: 2`, plus the sidecar environment. **Not applied**: commented out of
  `resources:`.
- `scheduledbackup.yaml` — `ScheduledBackup` `n8n-db-daily`, `0 10 3 * * *`
  (03:10), `immediate: true`, `backupOwnerReference: self`, `method: plugin`.
  **Not applied**: commented out of `resources:`.
- `garage-backup-credentials.enc.yaml` — the Garage S3 key the barman sidecars
  read (`ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`), SOPS-encrypted, holding the real
  minted credential. **Not applied**: commented out of `resources:`.
- `garage-backup-credentials.enc.yaml.exemple` — the pristine plaintext template
  for that Secret. Never applied, never edited.

Flux: the `databases` Kustomization in
[`clusters/staging/apps.yaml`](../../../../clusters/staging/apps.yaml) applies
`./apps/staging/databases` (which lists `n8n/`) with `wait: true` and SOPS
decryption, after `infra-cnpg-plugin` (the barman-cloud plugin, which owns the
`ObjectStore` CRD) and `infra-reflector`. There is **no**
`db-migrations` entry for this cluster. The n8n application itself is a separate
tier (`apps/base/n8n/` + `apps/staging/n8n/`, applied by the `apps`
Kustomization) and is documented in
[`documentations/10-n8n-automation.md`](../../../../documentations/10-n8n-automation.md).

## Why it is like this

**The Namespace ships in the databases tier.** n8n runs in its own `n8n`
namespace with its own CNPG cluster. The Namespace object is declared here
rather than next to the application because the `databases` Kustomization
reconciles first, so `apps/base/n8n` lands into a namespace that already exists.

**`dataDurability: preferred`.** Writes fall back to asynchronous replication
when the replica is unavailable so they never block. This is a homelab pair,
not real HA worth protecting a write path for.

**No Flyway, no `db-migrations` entry.** n8n runs its own TypeORM migrations on
every boot. A fresh cluster comes up empty and the first n8n pod creates the
whole schema — watch the startup logs.

**Garage instead of R2, and 30d retention.** The backup target is the
off-cluster Garage store, reached through the in-cluster HAProxy gateway and
Tailscale egress — the same single endpoint the etcd backup uses. Retention is
longer than fbref's `7d` because this bucket holds the only copy of every n8n
workflow and credential and a bad workflow edit can go unnoticed for days. The
daily base backup is at 03:10 rather than the 03:00 every other CNPG cluster
uses, so it does not contend with `fbref-db` and `ai-gateway-db` — the other two
that go through the single Garage gateway — for that one endpoint (`asp-db` and
`keycloak-db` also run at 03:00, but to R2). Garage has no SSE-S3, so the
ObjectStore omits `encryption:` entirely, unlike the R2-backed stores, which set
`encryption: AES256` on both `wal` and `data`.
See
[`documentations/03-backups.md`](../../../../documentations/03-backups.md) and
[`documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md).

**`AWS_REGION: garage` on the sidecar.** Garage runs with `s3_region = "garage"`
and rejects a `HeadBucket` signed for any other region with a bare 400, while
`GET`, `PUT` and `ListObjectsV2` with the same wrong region succeed. Only
`barman-cloud-check-wal-archive` ("checking the first wal") issues that call,
and only while the archive is still empty — so a missing region is invisible on
an established cluster and fatal on a new one. This store has never archived
anything, which is exactly the new-cluster case: enabling it without the region
reproduces the 2026-08-10 ai-gateway outage (postmortem in
[`documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md))
on the database that holds the only copy of every n8n workflow and credential.
Both variable names are set because boto3 reads `AWS_REGION` while the aws CLI
honours `AWS_DEFAULT_REGION`. `AWS_REQUEST_CHECKSUM_CALCULATION` and
`AWS_RESPONSE_CHECKSUM_VALIDATION` are defensive: the same class of boto3 >=
1.36 data-integrity checksum rejection seen with R2
(plugin-barman-cloud issue 411), harmless if Garage accepts them.

**Backups still commented out.** The blocker is gone — the Garage key is minted
and `garage-backup-credentials.enc.yaml` holds the real credential,
SOPS-encrypted, with the `.exemple` beside it kept as the readable record of
which keys exist and how to mint them. What remains is confirming the bucket
exists on the Garage host and uncommenting the four entries together. This is
tracked as the highest-priority backup gap in
[`documentations/03-backups.md`](../../../../documentations/03-backups.md).

**Two files, one encrypted and one not.** Same convention as
`apps/staging/databases/fbref/`: the working `*.enc.yaml` is the file that gets
applied and must be `sops -e -i`-encrypted before it is committed; the
`.exemple` stays plaintext as the human-readable reference.

## Traps

- The Cluster image field is `imageName`, not `image`, and
  `ghcr.io/cloudnative-pg/cloudnative-pg` is the *operator* image — it must
  never be used here.
- `dataDurability: required` would block writes whenever the replica is
  unavailable.
- Uncomment the backup resources and `cluster-backup-patch.yaml` **together**,
  and only with a working Garage key in place. With placeholder credentials the
  barman WAL archiver fails, which degrades the CNPG cluster; `databases`
  reconciles with `wait: true` and gates `db-migrations` → `apps`, so a broken
  `n8n-db` stalls the whole app tier, not just n8n.
- The ObjectStore must not set `encryption:`. Garage supports SSE-C only, not
  SSE-S3/AES256, and AES256 would fail every WAL and base upload.
- `AWS_REGION` and `AWS_DEFAULT_REGION` must both stay `garage`. This archive is
  empty, so a wrong or missing region fails immediately on the first WAL.
- Do not add a `db-migrations` entry or a `postInit` bootstrap for this cluster:
  n8n owns its own schema.
- The `ScheduledBackup` schedule is a 6-field CNPG cron, not the 5-field Unix
  form.
- `*.enc.yaml` files are SOPS ciphertext; edit them only through `sops`. Commit
  the working credential file with real values still in plaintext and the Garage
  key is in git history permanently — rotating the key is then the only fix.
- A database restore is worthless without the matching `N8N_ENCRYPTION_KEY` from
  `apps/staging/n8n/n8n-secrets.enc.yaml`: it encrypts every credential n8n
  stores in this database. Never rotate it.

## Operating it

Render check before committing:

```bash
kubectl kustomize apps/staging/databases/n8n
flux get kustomizations
kubectl -n n8n get cluster n8n-db
```

Mint the Garage bucket and key (other project keys have no n8n access):

```bash
garage bucket create cnpg-staging-n8n
garage key create n8n-cnpg-staging
garage bucket allow --read --write cnpg-staging-n8n --key n8n-cnpg-staging
```

Fill in and encrypt the working credential file, then verify it is ciphertext
before staging it:

```bash
cd apps/staging/databases/n8n
$EDITOR garage-backup-credentials.enc.yaml
sops -e -i garage-backup-credentials.enc.yaml
grep -q 'ENC\[' garage-backup-credentials.enc.yaml && echo SAFE || echo PLAINTEXT
```

After enabling the backup, verify within 15 minutes of the cluster going Ready
that `cnpg-staging-n8n/n8n-db/wals/` is non-empty — the objects on the far side
are the only check that cannot lie.

Disaster recovery needs both halves: the CNPG backup in `s3://cnpg-staging-n8n`
and the unchanged `N8N_ENCRYPTION_KEY`. The restore itself follows the same
procedure as asp and fbref in
[`documentations/03-backups.md`](../../../../documentations/03-backups.md); the
n8n-specific side is in
[`documentations/10-n8n-automation.md`](../../../../documentations/10-n8n-automation.md).

### Overlays

Only a `staging` overlay exists (`apps/staging/databases/n8n/`); there is no
production overlay for n8n. Base on its own gives the Namespace and a Cluster
with the default storage class (Longhorn) and `5Gi`, no backups and no secrets.
Staging adds `storageClass: longhorn` and, once uncommented, the barman-cloud
plugin with the Garage `ObjectStore`, `ScheduledBackup` and credential Secret.
