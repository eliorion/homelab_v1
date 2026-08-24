# SeaweedFS

SeaweedFS is the cluster's bulk-storage provider and its S3 endpoint. It backs
the `hdd` StorageClass — long-term data that does not need low latency — and runs
an S3 gateway so applications can keep their files in a bucket instead of a
volume. Nextcloud is the first such consumer. It replaces the `ceph-block` half
of the storage layer; LINSTOR replaces the other half.

This directory installs the CSI driver and the namespace both charts share. The
cluster itself — the volume-server topology, the filer's database, the
StorageClass, the S3 credentials — is hardware-specific and lives in
[`../../staging/seaweedfs-cluster`](../../staging/seaweedfs-cluster). Migration
narrative and runbook:
[`../../../../documentations/17-linstor-seaweedfs-migration.md`](../../../../documentations/17-linstor-seaweedfs-migration.md).

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Creates `seaweedfs` with `pod-security.kubernetes.io/enforce\|audit\|warn: privileged`. |
| `repository.yaml` | Two `HelmRepository`s in `flux-system`: `seaweedfs` (`https://seaweedfs.github.io/seaweedfs/helm`) and `seaweedfs-csi` (`https://seaweedfs.github.io/seaweedfs-csi-driver/helm`). |
| `release-csi.yaml` | `HelmRelease` `seaweedfs-csi-driver` (chart `0.2.35`, app `v1.4.29`) pointed at the filer, creating no StorageClass of its own, with `node.updateStrategy.type: OnDelete`. |

The overlay adds the `seaweedfs` HelmRelease (chart `4.44.0`), the `seaweedfs-db`
CNPG cluster that holds the filer's metadata, the `hdd` StorageClass and the
SOPS-encrypted S3 identity config. It is reached through
`infrastructure/controllers/staging/kustomization.yaml`.

Flux drives this directory from `clusters/staging/infrastructure.yaml`
(`Kustomization` `infra-seaweedfs`, `wait: true`, 15 minute timeout, health check
on the HelmRelease), depending on `infra-linstor` because the masters claim from
the `ssd` class.

Topology: three masters (raft, one per node), **two volume servers** — node-1 and
node-2, the only nodes with HDDs — two filers, two S3 gateways, plus the admin
and worker pair that runs maintenance.

## Why it is like this

**A PV is a FUSE mount, not a block device.** The CSI driver runs `weed mount`
against a filer subdirectory. There is no `volumeMode: Block` code path at all,
no CSI snapshots, and no `NodeGetVolumeStats` — so `kubelet_volume_stats_*` is
blank for every SeaweedFS PVC and PVC-fullness alerting is blind on this tier.

**No database goes here, ever.** The mount write path never sets `fsync=true`, so
the volume server does not fsync its `.dat` file: a database calls `fsync()`, the
call returns success, and the bytes are still in a page cache that a power cut
empties. SeaweedFS's own benchmark (`test/benchmark/fuse_db/README.md`) states
this outright and measures MySQL OLTP at 10542 → 1144 tx/s. That is `fsync=off`
semantics with a false acknowledgement. Databases live on `ssd` (LINSTOR).

**Two copies, always cross-node — `replication: 010` with `rack` set per node.**
`001` would mean "another server in the same rack", and SeaweedFS counts multiple
volume servers on one host as separate servers, so `001` does not guarantee
different machines. Setting `rack` = hostname and using `010` does. That needs one
StatefulSet per node, because `rack` is a per-StatefulSet value — hence
`volume.enabled: false` plus a `volumes:` map rather than the chart's single
default volume group.

**The filer's metadata is in Postgres, not LevelDB.** Two filers on an embedded
store synchronise by replaying each other's change logs and are explicitly only
*eventually consistent*, which an S3 endpoint needing read-after-write cannot
tolerate. One filer on a replicated block volume is not an answer either: it
inherits Kubernetes' non-configurable 6-minute force-detach, so a node failure
takes S3 down for six or seven minutes. A CNPG-backed store with stateless filers
behind a Service fails over on a readiness probe. `postgres2` rather than
`postgres` because it keeps a table per bucket, which makes bucket deletion cheap.

**The S3 gateway is stateless and runs two replicas.** All bucket, object and
multipart state lives in the filer.

**No disk types.** `ToDiskType("")` and `ToDiskType("hdd")` both return
`HardDriveType`, so tagging the HDDs `hdd` would buy nothing — and tagging
*asymmetrically* would split one pool into two, drop the tagged pool to fewer
racks, and break `010` growth outright.

## What this does not survive

**Losing node-1 or node-2 stops writes to this tier.** Volume growth is
all-or-nothing: `findEmptySlotsForOneVolume` asks for `DiffRackCount + 1` racks
with free slots, so `010` needs two. With racks only on node-1 and node-2, losing
either leaves one, and the master returns `Not enough data nodes found!` rather
than falling back to two copies on one host. Existing volumes stay readable from
their surviving copy and every volume with a replica on the dead node goes
read-only. **Data is safe; writes pause until the node returns.**

node-3 contributes no HDD by choice — its SSD is entirely LINSTOR's. Giving
node-3 a real disk is what lifts this to full node-loss tolerance, and it is
already named in
[`../../../../documentations/16-usb-disk-qualification.md`](../../../../documentations/16-usb-disk-qualification.md)
as the single highest-value hardware change available to this cluster.

## Traps

- **A `bootstrap.recovery` patch on `seaweedfs-db` must carry
  `database: seaweedfs` and `owner: seaweedfs`.** Neither is inherited from
  `initdb` and CNPG defaults both to `app`, which leaves the filer authenticating
  as the wrong role against an empty database — the non-`app` owner makes this
  the failing variant, not the silently-empty one. See
  [`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).
- **`weed volume -max` defaults to `8`, not to auto.** Left alone every server
  caps at 8 × 30 GB = 240 GB and the 2 TB disks are invisible. `maxVolumes: 0`
  per `dataDirs` entry is what sets `-max 0`. A count mismatch between `-dir` and
  `-max` is fatal at startup.
- **The master weights placement by free volume *slots*, not bytes.** A
  `maxVolumeCount` that does not track real disk size silently corrupts both
  placement and `volume.balance`.
- **Every chart `hostPathPrefix` default is `/ssd` or `/storage`, and both are
  read-only on Talos** — eleven of them across the values file. Every enabled
  component's `data` and `logs` must be redirected or set to `emptyDir`, or the
  pod dies with `mkdir /ssd: read-only file system`.
- **The volume StatefulSet appends a fixed `/object_store/` to each
  `hostPathPrefix`**, so two `dataDirs` sharing a prefix collide. One prefix per
  disk.
- **`master.data` must be a `persistentVolumeClaim` on the first install.** On
  `hostPath` a rescheduled master returns with an empty `-mdir` and a brand new
  cluster UUID, and `volumeClaimTemplates` is immutable afterwards.
- **`hostPath` volume dirs use `DirectoryOrCreate`.** Starting a volume server
  before its Talos user volume is mounted silently creates the directory on
  `EPHEMERAL` and writes bulk data onto the install disk. This is why the
  overlay's HelmRelease ships `suspend: true`.
- **A misspelled StorageClass parameter is not an error.** The driver logs
  `VolumeContext '<key>' ignored` and mounts anyway. Verify against the real
  `weed mount` argv in the `seaweedfs-mount` pod.
- **Rolling the CSI node or mount DaemonSet breaks every pod using a SeaweedFS
  PVC on that node.** `node.updateStrategy.type: OnDelete` makes a chart bump a
  deliberate, drained operation instead of something Flux does at 03:00.
- **Under-replication never self-heals on its own.** `volume.fix.replication`
  restores one replica per volume per run; the `admin` + `worker` pair exists so
  the default 17-minute maintenance script runs it.
- **The worker gives up if it starts before the admin.** It retries the admin
  gRPC port for about 45 seconds with `no route to host`, then stops trying and
  stays `Running` forever — so a healthy-looking pod means nothing. Confirm with
  `Plugin worker connected` in the admin log; `kubectl rollout restart
  deploy/seaweedfs-seaweedfs-worker` is the fix. Note the admin's own
  `Topology status: … 0 workers` line is a *different* registry and reads 0 even
  when the plugin worker is connected and running tasks — do not trust it.
- **`-minFreeSpacePercent` is 1.** Crossing it marks *all* of that server's
  volumes read-only at once.
- **`fs.configure` applies at write time only.** Configure a path before creating
  its bucket; moving files in afterwards does not re-place them.
- **Each bucket is a collection that pre-allocates ~7 volumes of ~30 GB.** Set
  `fs.configure -locationPrefix=/buckets/ -volumeGrowthCount=1 -apply` or a
  handful of buckets returns `no free volumes left`.
- **`global.seaweedfs.monitoring.additionalLabels` must carry `release:
  kube-prometheus-stack`** or the chart's ServiceMonitors are applied and then
  silently ignored — the same trap recorded for Ceph and Longhorn in
  `monitoring/configs/README.md`.
- **Erasure coding silently does nothing below four data nodes.** `ec.encode`
  logs one line and returns `nil`. Do not plan around it.

## Operating it

```bash
kubectl kustomize infrastructure/controllers/base/seaweedfs >/dev/null
flux reconcile kustomization infra-seaweedfs --with-source
kubectl -n seaweedfs get pods -o wide
```

`weed shell` is the control surface:

```bash
W() { kubectl -n seaweedfs exec -it deploy/seaweedfs-filer -- weed shell "$@"; }
# inside: cluster.check / volume.list / volume.fix.replication / fs.configure
```

Watch the thing that fails silently — node-1 or node-2 running out of free
volume slots, after which new volumes stop being placed there:

```bash
kubectl -n seaweedfs exec -it deploy/seaweedfs-filer -- weed shell <<< 'volume.list'
```

## Filer configuration is not in the chart

`fs.configure` and `s3.bucket.create` write to the filer's metadata store, which
here is the `seaweedfs-db` CNPG cluster — not to any Helm value. Applied by hand
they survive pod restarts and disappear with the database. They ship instead as
`infrastructure/controllers/staging/seaweedfs-config`, a Job carrying
`configure.sh`, applied by the `infra-seaweedfs-config` Flux Kustomization with
`force: true` so a script change deletes and recreates the Job. Both commands are
idempotent — re-creating an existing bucket is a no-op that exits 0 — so the Job
is safe to re-run at any time. Add new buckets there, not in a shell.
