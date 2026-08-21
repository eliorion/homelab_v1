# fbref-db

`fbref-db` is the CloudNativePG Postgres cluster behind the fbref scraper
platform. It lives in its own `fbref` namespace, fully separate from asp, and
runs two instances: the primary takes the engine's writes, and every analytics
reader — nao, pgAdmin, Grafana and fbref-mcp — connects to the
`fbref-db-ro.fbref.svc.cluster.local` replica endpoint instead. It is the
largest database in the cluster and the one that actually grows. The schema is
owned by Flyway, not by the cluster manifest, and the whole thing is archived
to the off-cluster Garage object store with point-in-time recovery.

## How it is wired

Base (`apps/base/databases/fbref/`):

- `namespace.yaml` — the `fbref` Namespace.
- `database.yaml` — the CNPG `Cluster` `fbref-db`: 2 instances,
  `imageName: ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie` pinned to
  what the operator deployed, synchronous replication (`method: any`,
  `number: 1`, `dataDurability: preferred`), tuned
  `postgresql.parameters`, `bootstrap.initdb` for database `fbref` owned by
  `app`, three `managed.roles` (`grafana_ro`, `mcp_ro`, `app`) and `storage.size:
  10Gi`.
- `kustomization.yaml` — lists `namespace.yaml` and `database.yaml` only.
- `db-init-configmap.yaml` — ConfigMap `fbref-db-init` carrying the legacy
  `init.sql` bootstrap schema (a hand-synced copy of
  `services/fbref/postgres/init.sql` in the application repo, plus the CNPG
  grants and the NOLOGIN `grafana_ro` role). It is **not** listed in
  `kustomization.yaml`, so nothing applies it: the schema moved to Flyway when
  the `postInitApplicationSQLRefs` bootstrap was retired. Its comments are
  ConfigMap data, not YAML comments — editing them changes the resource.

Staging overlay (`apps/staging/databases/fbref/`):

- `kustomization.yaml` — pulls the base, forces `namespace: fbref`, adds the
  three SOPS secrets and the backup resources, and applies the three patches
  below.
- `fbref-grafana-ro.enc.yaml` / `fbref-mcp-ro.enc.yaml` — basic-auth Secrets
  holding the passwords the CNPG managed roles `grafana_ro` and `mcp_ro` are
  given. `fbref-mcp-ro` is also read by the fbref-mcp Deployment as its
  `DATABASE_URL` credential.
- `garage-backup-credentials.enc.yaml` — the Garage S3 key used by the barman
  sidecars. `garage-backup-credentials.enc.yaml.exemple` is the plaintext
  template for recreating it.
- `objectstore.yaml` — the barman-cloud `ObjectStore` `garage-store`: 7d
  retention, `s3://cnpg-staging-fbref`, endpoint
  `http://garage-s3.garage-gw.svc.cluster.local:3900`, gzip on WAL and data,
  `jobs: 2`, plus the sidecar environment.
- `scheduledbackup.yaml` — `ScheduledBackup` `fbref-db-daily`, `0 0 3 * * *`,
  `immediate: true`, `method: plugin`.
- `cluster-backup-patch.yaml` — attaches the `barman-cloud.cloudnative-pg.io`
  plugin to the Cluster as the WAL archiver, `barmanObjectName: garage-store`,
  `serverName: fbref-db`.
- `cluster-storage-patch.yaml` — JSON 6902 patch: `storageClass: longhorn`
  (explicit, though Longhorn is also the cluster default storage class on
  Talos) and `storage.size` replaced with `200Gi`. The two Longhorn volumes
  behind those PVCs are patched out of band to `numberOfReplicas: 1`; the class
  provisions 3.
- `cluster-reflector-patch.yaml` — `inheritedMetadata` annotations that permit
  kubernetes-reflector to mirror this cluster's Secrets into the `lab` and
  `database` namespaces.

Flux: the `databases` Kustomization in
[`clusters/staging/apps.yaml`](../../../../clusters/staging/apps.yaml) applies
`./apps/staging/databases` (which lists `fbref/`) with `wait: true` and SOPS
decryption. It depends on `infra-cnpg-plugin` (the barman-cloud plugin, which
owns the `ObjectStore` CRD) and on `infra-reflector` (the central
`ghcr-pull-secret` source in `infrastructure/controllers/staging/reflector`,
mirrored into this namespace). The schema is then applied by the separate
`db-migrations` Kustomization
(`apps/staging/databases/db-migrations/fbref/`), which gates the `apps`
Kustomization on the Flyway Job completing.

## Why it is like this

**Own namespace and cluster.** fbref does not share anything with asp; the two
CNPG clusters are independent.

**`dataDurability: preferred`.** Writes fall back to asynchronous replication
when the replica is unavailable so they never block. This is a homelab pair,
not real HA worth protecting a write path for.

**`max_standby_streaming_delay: 300s`.** The replica is the analytics copy: nao,
pgAdmin, Grafana and fbref-mcp all read `fbref-db-ro`, and nothing reads the
primary but the engine. At the 30s default, WAL replay cancels any reader whose
snapshot still needs row versions vacuum wants gone — a `nao sync` lost three
tables to `canceling statement due to conflict with recovery`, among them
`player_season_stats` and `player_stats`, the two the agent most needs. Raising
the delay lets *replay* wait. The alternative, `hot_standby_feedback=on`, makes
the *primary* wait instead: it holds vacuum back for whatever the replica is
doing, and the readers here are people and agents with no statement timeout.
`player_stats` is 26GB, `player_match_stats` carries around 590k dead tuples on
a good day, and the volume was at 72% of the 50Gi it had already been resized to
once after an ENOSPC took the whole stack down. Stale reads on an analytics
replica cost nothing; unbounded bloat on that primary costs the cluster. The
price is replica lag, bounded by this value and paid only during a conflict;
the longest observed sync query was 21.4s.

**No `postInit` bootstrap.** The schema is owned by Flyway (the
`fbref-db-migrations` Job, gated ahead of the apps tier), mirroring asp. A fresh
cluster comes up empty and the Job applies V1 onward; the pre-existing cluster
is baselined at 0 and healed by V2/V3 (which drop the stale `kind` CHECK and add
`worker_control`).

**Managed roles.** Flyway creates `grafana_ro` (V1) and `mcp_ro` (V7) as NOLOGIN
roles with the grants they need; CNPG then ensures each is present and flips it
to LOGIN using the password from the SOPS-encrypted Secret in this overlay.
`mcp_ro` gets SELECT on the data tables and the `mcp` schema and deliberately
**not** `worker_control`, so the MCP server cannot pause the engine. That grant
is what makes fbref-mcp read-only in the database itself, underneath the replica
endpoint it connects to and the `default_transaction_read_only` it sets per
connection. `app` carries `createrole: true` because Flyway V3 creates the
worker-control and nocodb roles while connected as `app`; the missing privilege
was hit on 2026-06-12 on a fresh initdb.

**200Gi on Longhorn in staging, one Longhorn replica per volume.** 10Gi filled
and CNPG halted the primary with "Not enough disk space", which took the whole
fbref stack down with it: `fbref-db-rw` has a single endpoint (the primary), so
fbref-engine got "No route to host", CrashLooped, stopped submitting, and the
scraper platform's fbref queue drained to zero. The size lives in the overlay
rather than in base because this is staging's Longhorn sizing and base is shared
with a cluster whose disks are not this size. The 50Gi to 100Gi step was
ordinary growth, not relief: both instances reached 85% of 50Gi on real data.
Longhorn thin-provisions, so the extra is provisioned, not consumed.

The 100Gi to 200Gi step on 2026-08-21 could not be taken at three replicas.
Every Longhorn volume costs its provisioned size on *each* node, so 2 instances
× 100Gi × 3 replicas is 200Gi of node-1's disk — and node-1's install disk is a
500GB NVMe presenting 394Gi schedulable, against 928GB SSDs on nodes 2 and 3.
Node-1 and node-2 were both down to 3Gi schedulable; three-replica fbref caps at
roughly 197Gi *per instance* even after evicting every other volume off node-1,
which is below where it already sat. The volumes were therefore patched to
`numberOfReplicas: 1` with `dataLocality: best-effort`, which freed 400Gi at
once and pinned each volume's single replica to the node its pod already runs
on (`fbref-db-1` → node-2, `fbref-db-3` → node-3).

One Longhorn replica is not one copy of the data. CNPG runs two instances, each
on its own volume on a different node, with streaming replication between them,
plus a daily Barman base backup and continuous WAL archiving to Garage. Losing a
node loses one instance's volume; CNPG re-provisions it and re-syncs from the
survivor. Six Longhorn copies of a 74GB scraped, re-derivable dataset was the
largest single consumer in a 2.3TB cluster. Nexus already runs this way for the
same reason — see
[`../../../../infrastructure/services/base/nexus/README.md`](../../../../infrastructure/services/base/nexus/README.md).

**Garage instead of R2.** fbref is the one CNPG cluster archived to the
off-cluster Garage store rather than Cloudflare R2, reached through the
in-cluster HAProxy gateway and Tailscale egress — the same single endpoint the
etcd backup uses. Garage has no SSE-S3, so the ObjectStore omits `encryption:`
entirely. Connectivity was verified with `barman-cloud-backup-list` (exit 0)
before the plugin was attached. See
[`documentations/03-backups.md`](../../../../documentations/03-backups.md) and
[`documentations/12-garage-object-storage.md`](../../../../documentations/12-garage-object-storage.md).

**`AWS_REGION: garage`.** barman-cloud was signing HeadBucket for `us-east-1`
while Garage's region is `garage`, which is what produced the earlier `exit
status 4` archiving failure; with the region set, ContinuousArchiving is True
and WAL recycles. It is not a live bug on this cluster any more — the one call
that rejects a mismatched region is the HeadBucket that
`barman-cloud-check-wal-archive` issues for the *first* WAL only, and this
archive is non-empty — but it is a restore-time landmine, because bootstrapping
a fresh cluster off this bucket starts with an empty archive again. That is
exactly how `ai-gateway-db` filled its disk. The
`AWS_REQUEST_CHECKSUM_CALCULATION` / `AWS_RESPONSE_CHECKSUM_VALIDATION` pair is
defensive: the same class of boto3 >= 1.36 data-integrity checksum rejection
seen with R2 (plugin-barman-cloud issue 411), harmless if Garage accepts them.
Path style was verified — boto3 uses path style for a custom endpoint, and
`barman-cloud-backup-list` against this bucket through the gateway returned
cleanly.

**Reflector annotations.** `inheritedMetadata` is CNPG's only hook for
annotating the Secrets the operator generates, in particular the `-app`
connection Secret (cloudnative-pg issue 5883). It stamps *all* cluster objects,
so this overlay puts nothing there but the reflection permit. Each consumer
namespace pulls exactly the `-app` Secret through its own explicit `reflects`
stub; with no auto-mirror, the `-ca`, `-server` and `-replication` Secrets are
never copied out of the `fbref` namespace. The consumers are `lab` (the analysis
sandbox, `apps/staging/lab/`) and `database` (pgAdmin and nao,
`infrastructure/services/staging/databases/dbtools/`). The `ghcr-pull-secret`
in this namespace is not defined here at all — it is mirrored in from the
central reflector source.

## Traps

- The Cluster image field is `imageName`, not `image`, and
  `ghcr.io/cloudnative-pg/cloudnative-pg` is the *operator* image — it must
  never be used here.
- `dataDurability: required` would block writes whenever the replica is
  unavailable.
- Do not lower `max_standby_streaming_delay` back toward the 30s default: the
  analytics readers on `fbref-db-ro` start getting `canceling statement due to
  conflict with recovery`.
- The `app` managed role must keep `createrole: true` or Flyway V3 fails on a
  fresh initdb.
- The ObjectStore must not set `encryption:`. Garage supports SSE-C only, not
  SSE-S3/AES256, and AES256 would fail every WAL and base upload.
- `AWS_REGION` and `AWS_DEFAULT_REGION` must both stay `garage`. A wrong region
  is silent on this cluster and fatal on a restore into a fresh one.
- `db-init-configmap.yaml` is deliberately absent from `kustomization.yaml`.
  Adding it back would reintroduce a schema source that competes with Flyway.
- The `-app` Secret leaves this namespace only because of the reflector
  annotations in `cluster-reflector-patch.yaml`; anything else added under
  `inheritedMetadata` lands on every object the cluster owns.
- The storage size is overlay-scoped: base stays at `10Gi`, staging replaces it
  with `200Gi`. Raising it in base would apply it to a cluster whose disks are
  not this size.
- **`numberOfReplicas: 1` lives on the Longhorn volume, not in git.** The
  `longhorn` class provisions 3, so a recreated PVC comes back at 3 replicas and
  will not fit. Re-apply the patch under "Operating it" after any PVC recreate.
- **Growing this cluster is bounded by one node, not by the cluster total.**
  `fbref-db-1`'s volume lives on node-2 and `fbref-db-3`'s on node-3, and each
  needs the full increase on its own node. Check schedulable space per node
  before raising `storage.size`.
- **Raising `storage.size` does not resize the PVCs by itself** once the cluster
  is already in "Not enough disk space". CNPG's low-disk guard returns before it
  reaches PVC reconciliation, so the Cluster carries the new size and the PVCs
  stay at the old one. Patch them by hand — see "Operating it".
- **A Garage outage fills this volume.** Failing WAL archiving is not just a
  missing backup: PostgreSQL retains every unarchived segment. Watch
  `ContinuousArchiving` on the Cluster, not only the disk.
- The etcd Garage key has **no** fbref access. The backup key must be a
  dedicated Garage key scoped to the fbref bucket.
- The header comments still sitting in `garage-backup-credentials.enc.yaml`
  name the bucket `homelab-staging-fbref`, but the bucket the ObjectStore
  actually reads and writes is `cnpg-staging-fbref`.
- `*.enc.yaml` files are SOPS ciphertext; edit them only through `sops`.

## Operating it

Render check before committing:

```bash
kubectl kustomize apps/staging/databases/fbref
flux get kustomizations
```

Apply a `storage.size` increase to the PVCs when CNPG will not (see Traps):

```bash
for p in $(kubectl -n fbref get pvc -l cnpg.io/cluster=fbref-db -o name); do
  kubectl -n fbref patch "$p" --type=merge \
    -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'
done
```

Longhorn expands online; the filesystem grows without restarting the pods.

Pin the volumes back to one Longhorn replica after a PVC recreate:

```bash
for pv in $(kubectl -n fbref get pvc -o jsonpath='{.items[*].spec.volumeName}'); do
  kubectl -n longhorn-system patch volumes.longhorn.io "$pv" --type=merge \
    -p '{"spec":{"numberOfReplicas":1,"dataLocality":"best-effort"}}'
done
```

Schedulable space per node, which is what bounds `storage.size`:

```bash
kubectl get nodes.longhorn.io -n longhorn-system -o json | jq -r '.items[]
  | .metadata.name as $n | (.spec.disks // {}) as $s | .status.diskStatus
  | to_entries[] | [$n, .key,
      ((.value.storageMaximum - ($s[.key].storageReserved // 0)
        - .value.storageScheduled) / 1073741824 | floor)] | @tsv'
```

Recreate the Garage backup credential from the template. The `garage` commands
run on a Garage node — the admin API is not exposed through the in-cluster
gateway:

```bash
garage bucket create cnpg-staging-fbref
garage key create fbref-cnpg-staging
garage bucket allow --read --write cnpg-staging-fbref --key fbref-cnpg-staging
cp garage-backup-credentials.enc.yaml.exemple garage-backup-credentials.enc.yaml
# fill in the key id + secret, then encrypt in place
sops -e -i garage-backup-credentials.enc.yaml
```

Restore procedure and the 2026-07-26 restore drill for this exact cluster
(bootstrap-recovery of `fbref-db` out of `cnpg-staging-fbref` into a throwaway
`fbref-restore-test` cluster) are in
[`documentations/03-backups.md`](../../../../documentations/03-backups.md).

### Overlays

Only a `staging` overlay exists (`apps/staging/databases/fbref/`); there is no
production overlay for fbref, unlike asp. Base on its own gives the Namespace
and a Cluster with the default storage class and `10Gi`, no backups and no
secrets. Staging adds the Longhorn storage class and `100Gi`, the barman-cloud
plugin and the Garage `ObjectStore` + `ScheduledBackup`, the two managed-role
password Secrets, and the reflector permit annotations.
