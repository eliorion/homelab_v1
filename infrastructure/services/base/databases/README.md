# databases (infrastructure/services)

This directory holds the CNPG Postgres clusters — and the backup wiring that
goes with them — for every `infrastructure/services` workload that owns a
database. Today that is `keycloak-db` (Keycloak's realms, clients, users and
sessions), `ai-gateway-db` (the Bifrost AI gateway's config and logs store), and
the `dbtools` tier. Grouping them here mirrors `apps/staging/databases/`, for the
same reason: every database lives with the other databases instead of being
scattered one-per-service, so adding a database is "a new directory here"
everywhere in the repo rather than a rule that differs between `apps/` and
`infrastructure/services/`.

The workloads themselves live elsewhere — see
[`../keycloak/README.md`](../keycloak/README.md) and
[`../ai-gateway/README.md`](../ai-gateway/README.md). This README covers only
their databases. `dbtools/` is the exception in this tree and documents itself in
[`dbtools/README.md`](dbtools/README.md).

## How it is wired

```
infrastructure/services/base/databases/
├── keycloak/     Cluster keycloak-db      (no namespace — the overlay sets it)
├── ai-gateway/   Cluster ai-gateway-db    (namespace: ai-gateway)
├── mlops/        Cluster mlops-db         (namespace: mlops) + Databases mlflow, mlflow_auth
└── dbtools/      the whole `database` namespace — see dbtools/README.md

infrastructure/services/staging/databases/
├── kustomization.yaml   pulls in keycloak/, ai-gateway/, dbtools/
├── keycloak/     namespace: identity + R2 ObjectStore + ScheduledBackup + secret
└── ai-gateway/   Garage ObjectStore + ScheduledBackup + secret
```

Base — the shape of the cluster, environment-independent:

| file | what it declares |
| --- | --- |
| `keycloak/cluster.yaml` | `Cluster keycloak-db`, `instances: 2`, `initdb` database/owner `keycloak`, `storage.size: 10Gi` |
| `ai-gateway/cluster.yaml` | `Cluster ai-gateway-db` in namespace `ai-gateway`, `instances: 2`, `initdb` database/owner `bifrost` with `encoding: UTF8`, `storage.size: 20Gi` |
| `harbor/cluster.yaml` | `Cluster harbor-db`, `instances: 2`, `initdb` database/owner `harbor`, `storage.size: 20Gi`. Namespace `registry` comes from the staging overlay. No backup wiring yet — see `../harbor/README.md`. |
| `openbao/cluster.yaml` | `Cluster openbao-db`, `instances: 2`, `initdb` database/owner `openbao`, `storage.size: 2Gi`, pinned image. Namespace `openbao` (PodSecurity `restricted`: every CNPG container, Barman sidecar included, already meets it). OpenBao's storage once migrated off Raft — see `../openbao/README.md`. Backed up to Garage `cnpg-staging-openbao` (Barman, WAL + daily 03:50, 7 days). |
| `mlops/cluster.yaml` | `Cluster mlops-db` in namespace `mlops`, `instances: 1`, `initdb` database/owner `mlflow` (CNPG generates `mlops-db-app`), managed role `dagster` (password from an OpenBao ExternalSecret in `staging/mlops/secrets`), `Database` objects `dagster` + `mlflow_auth` (`retain`), `storage.size: 5Gi`. No backup, by design — `../mlops/README.md` |
| `*/kustomization.yaml` | one resource each, `cluster.yaml` |

Staging — everything environment-specific (bucket, endpoint, credential,
schedule) is added by the overlay, never by the base:

| file | what it declares |
| --- | --- |
| `keycloak/kustomization.yaml` | `namespace: identity` for the whole overlay, plus the four resources below |
| `keycloak/cluster-backup-patch.yaml` | attaches the `barman-cloud.cloudnative-pg.io` plugin to `keycloak-db` with `isWALArchiver: true`, `barmanObjectName: r2-store`, `serverName: keycloak-db` |
| `keycloak/objectstore.yaml` | `ObjectStore r2-store` → `s3://keycloak-cnpg-staging` on Cloudflare R2, `retentionPolicy: 7d`, gzip + AES256 on WAL and data |
| `keycloak/scheduledbackup.yaml` | `keycloak-db-daily`, `schedule: "0 0 3 * * *"`, `immediate: true`, `method: plugin` |
| `keycloak/r2-backup-credentials.enc.yaml` | SOPS secret with `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`; `.example` is the template |
| `ai-gateway/cluster-backup-patch.yaml` | same plugin attachment with `barmanObjectName: garage-store`, `serverName: ai-gateway-db` |
| `ai-gateway/objectstore.yaml` | `ObjectStore garage-store` → `s3://cnpg-staging-ai-gateway` via `http://garage-s3.garage-gw.svc.cluster.local:3900`, `retentionPolicy: 7d`, gzip, **no** encryption, plus four sidecar env vars |
| `ai-gateway/scheduledbackup.yaml` | `ai-gateway-db-daily`, same schedule and method |
| `ai-gateway/ai-gateway-garage-backup-credentials.enc.yaml` | SOPS secret with the Garage key; `.example` is the template |

### Overlays

`staging/` is the only overlay. An inert production keycloak database overlay
(never reconciled, with a temporary seed-from-staging recovery patch) was deleted
with the rest of the production tree on 2026-09-15.

The base/overlay split is deliberate: the base says how many instances, which
database name and how much disk; the overlay says where backups go and with which
credential. A second environment would reuse both `base/databases/*` directories
unchanged and supply its own ObjectStore, ScheduledBackup and secret.

Two namespace conventions coexist here, and they are not interchangeable:

- `keycloak/` — the base `Cluster` carries **no** `metadata.namespace`; the
  staging overlay's `namespace: identity` places it (and the secret, ObjectStore
  and ScheduledBackup) in `identity`.
- `ai-gateway/` — every manifest names `namespace: ai-gateway` explicitly and the
  overlay sets no namespace of its own.

## Why it is like this

### Two instances, not one

Both clusters run `instances: 2` — one primary, one hot standby — matching
`asp-db`, `fbref-db` and `scraper-db`. Keycloak keeps every durable thing
(realms, clients, users, sessions) in `keycloak-db`. The gateway is the opposite
case: it runs a single pod on purpose (`replicaCount: 1`, a hard rule — see
[`../ai-gateway/README.md`](../ai-gateway/README.md)), so the standby is not
propping up application-level HA. It is what lets CNPG promote on the other node
instead of leaving the gateway with no database at all until one pod and its
volume come back.

### Storage sizes

`keycloak-db` was 2Gi, which was sized for an unused install. A realm with client
registrations, sessions and an event log outgrows that quietly, and Postgres out
of disk is a much worse day than an oversized PVC — hence 10Gi.

`ai-gateway-db` was 10Gi, mirroring the same "sized for an unused install"
mistake, but what actually filled it was not data. WAL archiving to Garage never
succeeded (the region bug below), so Postgres could not recycle a single segment
and `pg_wal` grew until the volume hit 9.94Gi of 10Gi. CNPG then shut the primary
down on its low-disk check, `ai-gateway-db-rw` lost its only endpoint, and the
gateway pod crash-looped on `no route to host`. 20Gi is the headroom that lets
the primary start again *with* the archive still broken — recovery needs Postgres
up before it can drain anything — so every future archive outage gets the same
grace instead of a hard stop. Full incident and runbook:
[`../../../../documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md).

### No migration Job for either cluster

Unlike `asp-db`, `fbref-db` and `scraper-db`, neither cluster here has a Flyway
Job. Those apps do not migrate themselves — their schema is hand-written SQL and
Flyway is its source of truth. Bifrost is the inverse: it ships a numbered
migration ladder (`framework/configstore/migrations.go`) and runs it against this
database at startup. A Flyway Job would race the app's own migrator and force a
hand-transcribed V-file for every Bifrost upgrade. Keycloak manages its own
schema for the same reason.

### `bifrost` / UTF8

The `initdb` database and owner are both `bifrost` because that is what the
Bifrost chart's own default expects (`values-examples/external-postgres.yaml`) —
there is no reason to diverge. `encoding: UTF8` is already CNPG's default;
Bifrost's config store *requires* it, so it is stated explicitly and a future
change of CNPG's default cannot break the gateway quietly.

### One bucket and one credential per cluster

`keycloak-db` archives to its own bucket, not to asp's, so the token in
`r2-backup-credentials` can be scoped to Object Read & Write on
`keycloak-cnpg-staging` alone. Sharing asp's bucket would mean a credential
living in the `identity` namespace that can also rewrite the asp archive — which
is the archive you would be restoring from on the day you needed both.
`ai-gateway-db` follows the same rule on the Garage side: its own bucket
`cnpg-staging-ai-gateway` and its own key
(`ai-gateway-garage-backup-credentials`), never fbref's shared
`garage-backup-credentials`, and the etcd key has no ai-gateway access either.
`fbref-db` keeps its own bucket for the same reason; it simply points at Garage
rather than R2.

### Two different object stores

`keycloak-db` goes to Cloudflare R2 and encrypts WAL and data with `AES256`.
`ai-gateway-db` goes to Garage, reached through the in-cluster HAProxy gateway →
Tailscale egress → the three Garage nodes — the same single endpoint `fbref-db`
and the etcd backup use. Its ObjectStore deliberately omits `encryption:`
entirely: Garage does not support SSE-S3/AES256 (only SSE-C), so setting AES256
there would fail every upload.

Backup topology, retention and the restore procedure are in
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md);
the Garage side (buckets, keys, verification, the tailnet path) is in
[`../../../../documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md).

### The region is load-bearing

Garage is configured with `s3_region = "garage"` and rejects a `HeadBucket`
signed for any other region with a bare `400 Bad Request` — while `GET`, `PUT`
and `ListObjectsV2` with the *same* wrong region succeed. barman-cloud sets no
region, so boto3 signed as `us-east-1`, and the one call that cares is
`barman-cloud-check-wal-archive` "checking the first wal":

```
ERROR: Barman cloud WAL archive check exception:
An error occurred (400) when calling the HeadBucket operation: Bad Request
```

That check gates the *first* WAL only, so the failure was silent and total: base
backups kept uploading, `wals/` stayed empty for three days, and Postgres —
unable to archive — recycled nothing until the volume filled. No other Garage
consumer hit it: etcd-backup already sets `AWS_REGION`, and `fbref-db`'s archive
is non-empty so the check no longer runs there. Both variable names are set
because boto3 reads `AWS_REGION` while the aws CLI honours `AWS_DEFAULT_REGION`.

### The checksum environment variables

boto3 >= 1.36 sends data-integrity checksums that R2 rejects with
`XAmzContentSHA256Mismatch`, which breaks both backup and restore.
`AWS_REQUEST_CHECKSUM_CALCULATION=when_required` and
`AWS_RESPONSE_CHECKSUM_VALIDATION=when_required` restore compatibility
(plugin-barman-cloud issue #411). They are set on the Garage ObjectStore too, the
same way `fbref-db`'s Garage ObjectStore carries them — harmless if Garage accepts
the checksums.

### Why `dbtools/` sits inside this directory

`keycloak/` and `ai-gateway/` hold only a database; the workload lives a tier up.
`dbtools/` is the whole `database` namespace — the `dbtools-db` cluster
(pgAdmin's config database plus nao's users, sessions and chat history) *and* the
two tools that live off it — because the workload there **is** database tooling,
so there is nothing to split a tier up.

### Memory limits, `failoverDelay` and anti-affinity (every CNPG cluster)

These three settings apply to every CNPG cluster in the repo, `apps/` included.
They come from the 2026-10-13 incident, where five replicas were left unable to
rejoin. The patches live in the two staging tier kustomizations
(`apps/staging/databases/kustomization.yaml`,
`infrastructure/services/staging/databases/kustomization.yaml`). `seaweedfs-db`
and `mlops-db` carry the same fields in their own manifests.

**Memory limits make a database immune to the Talos OOM controller.** Talos
picks its victim with `memory_max.hasValue() ? 0.0 : <QoS weight> *
memory_current` (document 20), so any cgroup with a memory limit is never
chosen. Without one, every Postgres pod was `BestEffort` and was the first thing
killed whenever node-1 ran short — often enough to cause the failovers behind
the incident. Sizes are measured, not guessed: the request is about the 7-day
p95 working set, the limit 2–3× the 7-day peak (fbref: 1Gi request, 4Gi limit,
set by the owner).

| Cluster | 7-day peak | request / limit |
|---|---|---|
| `keycloak-db`, `nextcloud-db`, `dbtools-db` | ≤ 131Mi | 128Mi / 512Mi |
| `advisor-db`, `n8n-db`, `ai-gateway-db`, `harbor-db` | 280–376Mi | 256Mi / 1Gi |
| `asp-db`, `scraper-db` | 681–713Mi | 512Mi / 1.5Gi |
| `fbref-db` | 2316Mi | 1Gi / 4Gi |
| `mlops-db`, `seaweedfs-db` | 138 / 222Mi | 256Mi / 1Gi (own manifests) |

The working set counts page cache, which the kernel reclaims inside the cgroup
before it OOM-kills anything; only anonymous memory above the limit kills the
instance.

**`failoverDelay: 30` stops a short kill from becoming a failover.** A primary
killed and restarted in place is back within seconds (`scraper-db-1`: redo done
in 1.2s). Without the delay CNPG promotes the replica at once. The old primary
then has to `pg_rewind` to rejoin, and a `pg_rewind` interrupted midway leaves
an instance that cannot heal (below). The price is up to 30s more write outage
when a primary is really gone.

**`podAntiAffinityType: required`.** CNPG's default is `preferred`, which let
both `nextcloud-db` instances land on node-2, one node failure away from losing
the service. With `required` a replica that cannot find a node without its
primary stays `Pending`. Every `ssd` volume can attach on any node (diskless
DRBD), so only `asp-db` and `fbref-db`, pinned to node-2/3 on node-local
`ssd-cnpg`, have fewer than three choices.

## Traps

- **Never move `resources`, `failoverDelay` or `affinity` into
  `apps/base/databases/*`.** The asp, fbref, scraper and advisor base manifests
  are also the e2e vcluster's `e2e-db-templates`. The dev-platform `LimitRange`
  rejects any container limit above 2Gi, so fbref's 4Gi would break every e2e run.
- **A `bootstrap.recovery` patch must set `database:` and `owner:` explicitly.**
  They are not inherited from `initdb`; CNPG defaults both to `app` and then
  writes a `<cluster>-app` Secret describing an empty `app` database instead of
  the restored one. Both clusters here own the *worse* variant of this, because
  their owner is not `app` — `keycloak`/`keycloak` and `bifrost`/`bifrost` — so a
  defaulted recovery also leaves the workload authenticating as the wrong role
  (`permission denied for table user_entity` on Keycloak, 2026-08-24). Repair
  procedure in
  [`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).
- **`AWS_REGION` and `AWS_DEFAULT_REGION` must both be `garage`** on
  `staging/databases/ai-gateway/objectstore.yaml`. Removing either one silently
  stops WAL archiving; only `HeadBucket` enforces the region, so backups keep
  appearing to work while `wals/` stays empty and the primary eventually fills
  its disk.
- **Do not add `encryption:` to the Garage ObjectStore.** Garage has no
  SSE-S3/AES256 (SSE-C only) and AES256 would fail every upload. The R2
  ObjectStore does the opposite and keeps `AES256` on both `wal` and `data`.
- **Do not lower `ai-gateway-db`'s `storage.size` back to 10Gi.** The extra
  headroom is what lets the primary start with a broken archive. CNPG volumes can
  grow, not shrink.
- **`initdb.database` / `initdb.owner: bifrost` must match the Bifrost chart's
  expectation**, and `encoding: UTF8` is required by Bifrost's config store.
- **Do not add a Flyway/migration Job to either cluster.** Bifrost and Keycloak
  migrate themselves at startup; a Job would race them.
- **`barmanObjectName` in each `cluster-backup-patch.yaml` must equal the
  `ObjectStore`'s `metadata.name`** (`r2-store`, `garage-store`), and `serverName`
  is the prefix under which the archive is written in the bucket
  (`keycloak-db`, `ai-gateway-db`). Changing `serverName` orphans the existing
  archive.
- **Backup credentials are bucket-scoped on purpose.** A token scoped to another
  bucket cannot write here, and the failure surfaces as a failing `Backup` object.
  The `r2-backup-credentials.enc.yaml.example` template states the rule: the token
  must be scoped to `keycloak-cnpg-staging` only.
- **The checked-in `r2-backup-credentials.enc.yaml` is real ciphertext, but its
  own header says the token inside was scoped to `asp-cnpg-staging`.** Read that
  header before assuming the keycloak archive is actually being written.
- **Never commit one of these secrets unencrypted.** `.sops.yaml` selects the
  staging age key by path (`staging/*.enc.yaml`), so an unencrypted file matching
  that pattern is a live R2 token or Garage key in git history.
- **Do not list a credential file in `kustomization.yaml` before it exists** —
  `kubectl kustomize` fails on a missing resource. Listing the ObjectStore and
  ScheduledBackup without the secret is fine: CNPG simply reports the
  ScheduledBackup as failing, visibly.
- **The keycloak overlay's `namespace: identity` is what places every keycloak
  database resource.** The base `Cluster` has no namespace; dropping the overlay
  field would create it in the wrong namespace. The ai-gateway manifests set
  `namespace: ai-gateway` on themselves instead.
- **Keycloak's archive matters more than the others.** MCP users are created in
  the admin console, so this archive is the only copy of who may read the fbref
  database.

## Operating it

### Filling `r2-backup-credentials` (keycloak → R2)

1. R2 → create bucket `keycloak-cnpg-staging`.
2. R2 → API tokens → create a token with **Object Read & Write** on **that bucket
   only**. Not account-wide: the blast radius of this credential is the only
   thing separating an identity backup from the asp archive.
3. Fill and encrypt:

   ```bash
   cd infrastructure/services/staging/databases/keycloak
   cp r2-backup-credentials.enc.yaml.example r2-backup-credentials.enc.yaml
   # paste the two values, then:
   sops --encrypt --in-place r2-backup-credentials.enc.yaml
   ```

4. Verify after Flux reconciles and the first ScheduledBackup runs:

   ```bash
   kubectl -n identity get backup
   kubectl -n identity exec keycloak-db-1 -c plugin-barman-cloud -- \
     barman-cloud-backup-list --cloud-provider aws-s3 \
     s3://keycloak-cnpg-staging keycloak-db
   ```

### Filling `ai-gateway-garage-backup-credentials` (ai-gateway → Garage)

```bash
garage bucket create cnpg-staging-ai-gateway
garage key create ai-gateway-cnpg-staging
garage bucket allow --read --write cnpg-staging-ai-gateway \
  --key ai-gateway-cnpg-staging
```

Then fill and encrypt, and make sure the file is listed in the overlay's
`kustomization.yaml` resources:

```bash
cd infrastructure/services/staging/databases/ai-gateway
cp ai-gateway-garage-backup-credentials.enc.yaml.example \
   ai-gateway-garage-backup-credentials.enc.yaml
# paste the two values, then:
sops --encrypt --in-place ai-gateway-garage-backup-credentials.enc.yaml
```

Verify after Flux reconciles and the first ScheduledBackup runs:

```bash
kubectl -n ai-gateway get backup
kubectl -n ai-gateway exec ai-gateway-db-1 -c plugin-barman-cloud -- \
  barman-cloud-backup-list --cloud-provider aws-s3 \
  s3://cnpg-staging-ai-gateway ai-gateway-db
```

### Routine checks

```bash
kubectl kustomize infrastructure/services/staging     # render check before commit
kubectl -n identity get cluster keycloak-db           # 2/2 instances
kubectl -n ai-gateway get cluster ai-gateway-db       # 2/2 instances
kubectl -n identity get backup
kubectl -n ai-gateway get backup
```

### When it breaks

An app pod crash-looping on

```
dial tcp <ip>:5432: connect: no route to host
```

usually means the CNPG `-rw` service has no ready endpoint because the primary
itself is down — check `kubectl -n <ns> get cluster,pods` before touching the
application. If the primary is down on a low-disk condition, confirm whether WAL
archiving is actually reaching the object store: a backup that "succeeds" while
`.../wals/` stays empty is the failure mode described above. The step-by-step
diagnosis, the Garage-side `s3api head-bucket` check and the recovery are in
[`../../../../documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md);
restore procedures are in
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).

#### A replica that never becomes ready after a failover

Symptoms: one instance `0/1` with restarts climbing about once an hour (the
startup probe), and the Cluster phase `Waiting for the instances to become
active` or `Instance Status Extraction Error`. Its log repeats one of:

```
pg_rewind: error: could not find common ancestor of the source and target cluster's timelines
pg_rewind: error: could not read file ".../pg_wal/<segment>": read 0 of 8192
```

After a failover the old primary runs `pg_rewind` to rejoin. `pg_rewind`
truncates every file it is about to copy before fetching it, so a run cut short
by a node stall, a kill or a lost connection leaves empty timeline histories,
WAL segments and even relation files behind. Every retry then fails. The data
directory cannot be repaired; the replica has to be cloned again from the
primary. The only data lost is what the old primary wrote after the fork, which
the new primary never had.

```bash
kubectl -n <ns> get cluster <cluster>     # currentPrimary is NOT the broken instance
kubectl -n <ns> logs <instance> -c postgres | grep pg_rewind

kubectl -n <ns> delete pvc <instance> --wait=false
kubectl -n <ns> delete pod <instance>
```

`--wait=false` is required. Without it `kubectl delete pvc` blocks for good,
because `pvc-protection` keeps the claim while the pod still mounts it, so the
pod deletion never runs. CNPG then runs a `<cluster>-<n>-join` Job
(`pg_basebackup` from the primary) and starts `<cluster>-<n>` with the next
serial. That takes about a minute for 5Gi, 8 minutes for 16G and 45 for 107G
(document 20). Check it streams before doing the next cluster:

```bash
kubectl -n <ns> exec <primary> -c postgres -- \
  psql -Atc "select application_name, state from pg_stat_replication"
```

One cluster at a time, and never the primary's PVC. `CNPGReplicaNotStreaming`
fires after 30 minutes in this state (`monitoring/configs/README.md`). If the
primary is killed during the join, the Job fails and CNPG retries it.
