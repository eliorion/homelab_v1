# 17 — retiring Longhorn and Ceph for LINSTOR + SeaweedFS

Status: **planned, not started.** Phase 0 is committed; nothing has touched the
cluster.

Two storage systems leave and two arrive. **Longhorn** (class `longhorn`,
default, three replicas on the install-disk SSDs, still carrying all eight CNPG
Postgres clusters) is replaced by **LINSTOR/DRBD** via the Piraeus Operator,
serving a new `ssd` class. **Rook/Ceph** (class `ceph-block`, live since
2026-08-21 on four USB HDDs, backing thirteen volumes) is replaced by
**SeaweedFS**, serving a new `hdd` class and — new to this cluster — an **S3
gateway**, so Nextcloud can keep its files in a bucket rather than a volume.

Component detail lives with the components:
[`infrastructure/controllers/base/linstor/README.md`](../infrastructure/controllers/base/linstor/README.md)
and
[`infrastructure/controllers/base/seaweedfs/README.md`](../infrastructure/controllers/base/seaweedfs/README.md).
This document is the order of operations and the things that bite.

## Verified live state, 2026-08-23

Measured against the cluster, not inferred from git.

```
staging-controlplane-1   NotReady,SchedulingDisabled     <- out, rejoins ~2026-08-25
staging-controlplane-2   Ready
staging-controlplane-3   Ready
```

**Ceph is HEALTH_WARN and part of the pool is unreadable right now.** osd.2 and
osd.3 (node-1's 1.0 TB and 500 GB) are `down` with reweight 0; osd.0, osd.1 and
osd.4 are up.

```
[WRN] PG_AVAILABILITY: Reduced data availability: 3 pgs inactive
    pg 1.14 is stuck inactive for 39h, current state unknown, last acting []
    pg 1.1a is stuck inactive for 39h, current state unknown, last acting []
    pg 1.1e is stuck inactive for 39h, current state unknown, last acting []
[WRN] SLOW_OPS: 256 slow ops, oldest one blocked for 138158 sec, osd.0 has slow ops
```

Pool 1 is `ceph-blockpool`, so **3 of its 32 PGs have no reachable copy at all** —
`last acting []`. That is roughly 9% of the RBD data, and it is exactly why phase
2 must not start before node-1 is back. The 38-hour slow-op backlog on osd.0
wants explaining before the teardown, not during it.

**The data is far smaller than the provisioned sizes suggest.**

| | Provisioned | Actually stored |
|---|---|---|
| `ceph-block` (13 volumes) | ~451 Gi | **2.0 GiB**, 927 objects |
| `longhorn` (15 volumes) | ~545 Gi | **~222 GB**, of which fbref-db is ~186 GB |

Nexus's 350 Gi is very nearly empty — it was migrated by discard-and-re-cache in
`d9268a0` and never refilled. Every 3-replica Longhorn volume currently reads
`degraded` because node-1 is down; the two fbref volumes are `healthy` at
`numberOfReplicas: 1`.

So the whole migration moves a couple of hundred gigabytes, not terabytes, and
LVM-thin pools totalling ~1.22 TB raw are comfortable at `placementCount: 2`.

**Hardware confirmed.** node-2 and node-3 both install onto a **1.0 TB Samsung
SSD 840** — an old consumer TLC SATA drive, which is what the `ssd` tier will
actually be on two of three nodes. node-3's `sda7` is `r-fastpool`, 250 GB,
currently holding `bluestore`: keep the partition, wipe the contents. The
`by-path` selectors in `talconfig.yaml` were checked against the live symlinks
and match exactly:

```
sdk 2.0 TB  ST2000DM008  -> /dev/disk/by-path/pci-0000:00:14.0-usb-0:6:1.0-scsi-0:0:0:0
sdl 320 GB  ST320LT020   -> /dev/disk/by-path/pci-0000:00:14.0-usb-0:6:1.0-scsi-0:0:0:1
```

There is also an undocumented empty `.smb` pool alongside `ceph-blockpool` and
`.mgr`.

**The `rook-ceph-cluster` HelmRelease is already failing.** Every Flux
Kustomization is Ready, but:

```
flux-system  rook-ceph-cluster  v1.20.4  READY=False
  Helm rollback to previous release rook-ceph/rook-ceph-rook-ceph-cluster.v14
  failed: release rook-ceph-rook-ceph-cluster failed: timeout waiting for:
  [CephCluster/rook-ceph/rook-ceph status: 'InProgress']
```

Its `upgrade.remediation.strategy: rollback` keeps retrying against a CephCluster
that cannot go Ready while node-1's OSDs are down. **Suspend the HelmRelease
before patching `cleanupPolicy`**, or the remediation loop races the teardown and
Helm's release history is left in a state that makes the uninstall harder than it
needs to be:

```bash
flux suspend helmrelease rook-ceph-cluster -n flux-system
```

Two other things the live cluster shows that git does not: there is no
`node-role.kubernetes.io/control-plane:NoSchedule` taint on any node, so Piraeus
needs no tolerations block; and a chart-created `longhorn-static` StorageClass
exists alongside `longhorn`, which the Longhorn uninstall must also account for.

## The shape of the end state

```
ssd   linstor.csi.linbit.com   placementCount 2 + diskless tiebreaker
        LVM-thin on a raw partition of every install disk
        -> 8x CNPG Postgres, Prometheus TSDB, Grafana, azuracast-db,
           n8n, nao, nextcloud webroot, seaweedfs masters + its own database

hdd   seaweedfs-csi-driver     replication 010, rack == node
        xfs user volumes on the five USB/SATA HDDs of node-1 and node-2
        -> azuracast media, nexus cache, lab scratch, audiobookshelf

S3    weed s3 :8333            buckets under /buckets, backed by the same pool
        -> nextcloud primary object store
```

| Node | Install disk | EPHEMERAL | LINSTOR | SeaweedFS |
|---|---|---|---|---|
| node-1 | 500 GB NVMe | 240 GB | `r-linstor` 240 GB | USB 1.0 TB + USB 500 GB + SATA 640 GB |
| node-2 | ~998 GB SSD | 250 GB | `r-linstor` 730 GB | USB 2.0 TB + USB 320 GB |
| node-3 | 997 GB SSD | 740 GB, unchanged | `r-fastpool` 250 GB, reused from Ceph | none |

## Two things this does not survive, by choice

**`placementCount: 2` leaves one copy after a node loss.** Quorum holds — LINSTOR
auto-creates a diskless tiebreaker on the third node, so the survivor plus the
tiebreaker are 2 of 3 votes and writes continue — but redundancy is gone until a
replica is rebuilt, and that rebuild is manual while auto-eviction stays off.
`placementCount: 3` is what keeps two copies through a failure, at 1.5× the
space; node-1's 240 GB partition is what makes that expensive.

**Losing node-1 or node-2 pauses writes to the `hdd` tier.** SeaweedFS volume
growth is all-or-nothing and `010` needs two racks with free slots; with racks
only on two nodes, losing one leaves one. Existing data stays readable from its
surviving copy, every volume with a replica on the dead node goes read-only, and
no new volume can be grown. Giving node-3 a real HDD is what lifts this, and
[`16-usb-disk-qualification.md`](16-usb-disk-qualification.md) already calls that
the single highest-value hardware change available here.

## The `ssd` pool is one pool, described by two objects

`linstor storage-pool list` shows `ssd` on every node that has one, with the same
LVM VG (`linstor_ssd/ssd`) and the same driver. The StorageClass selects it by
name, so there is exactly one pool as far as any PVC is concerned.

It is written as two `LinstorSatelliteConfiguration` objects only because the
backing partitions are labelled differently: node-1 and node-2 use
`/dev/disk/by-partlabel/r-linstor`, while node-3 still carries `r-fastpool`
inherited from Ceph. `source.hostDevices` is per-configuration, so two device
paths need two objects.

**This collapses when node-3 is repartitioned.** Its raw volume is renamed
`linstor`, and the two objects become one with no `nodeAffinity` — every node
carrying `r-linstor` gets the pool. Until then, do not delete `ssd-pool-node-3`:
Piraeus deletes any storage pool that disappears from its config, and that one
is live.

## Measured: these SSDs are slow

A Longhorn replica rebuild between node-2 and node-3 — both **Samsung 840 EVO
1TB**, sequential WWIDs, same batch, node-3 on firmware `EXT0CB6Q` — sustained
**26 MB/s**, and node-3 dropped to `NodeStatusUnknown` once under that load
before recovering. `dmesg` shows no I/O errors: the drives are not failing, they
are simply this slow, which matches the 840 EVO's documented read degradation on
cold data.

That is the hardware the `ssd` class sits on for two of three nodes, and DRBD
protocol C makes every commit wait for the slowest replica. node-1's Crucial
NVMe is the only modern device in the set. Treat "high performance" as unproven
here until it is benchmarked; [16-usb-disk-qualification.md](16-usb-disk-qualification.md)
is the method this repo already uses to qualify a disk before trusting it.

## Phase 0 — git only (done)

New: `infrastructure/controllers/base/{linstor,seaweedfs}/`,
`infrastructure/controllers/staging/{linstor-cluster,seaweedfs-cluster}/`, the
`infra-linstor` and `infra-seaweedfs` Flux Kustomizations, and the
`bootstraping/talconfig.yaml` changes — new schematics, `machine.kernel.modules`,
the `r-linstor` raw volumes, the EPHEMERAL caps and the five HDD user volumes.

Both cluster directories are staged **inert**:

- `seaweedfs-cluster`'s HelmRelease ships `suspend: true`. Its volume servers use
  `hostPath` with `DirectoryOrCreate`, so starting them before the Talos user
  volumes are mounted creates empty directories on `EPHEMERAL` and writes bulk
  data onto the install disk.
- `linstor-cluster` is commented out of
  `infrastructure/controllers/staging/kustomization.yaml` until the `r-linstor`
  partitions exist.

Two things deliberately **not** done yet, both of which would break the cluster
if done early:

- **`rook-ceph` stays in git.** `infrastructure-controllers` runs `prune: true`,
  so removing it deletes the CephCluster immediately — with no `cleanupPolicy`
  and `allowUninstallWithVolumes: false` blocking on thirteen live PVs. That is
  the classic stuck-`Terminating` namespace. Rook leaves git in phase 3.
- **No PVC is re-pinned to `ssd`/`hdd`.** `storageClassName` is immutable on a
  bound PVC, so Flux cannot apply the edit at all and fails the whole
  Kustomization. Those edits land per volume, at migration time.

Verify:

```bash
kubectl kustomize infrastructure/controllers/staging >/dev/null
cd bootstraping && SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
for n in 1 2 3; do talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-$n.yaml --mode metal; done
```

## Phase 1 — node-1 rejoins, repartitioned

node-1 is out of the cluster. Fold the storage work into its rejoin rather than
paying for a second reboot.

```bash
# 1. new image: adds siderolabs/drbd. This REBOOTS.
talosctl upgrade --nodes 192.168.1.101 \
  --image factory.talos.dev/installer/11928acc918f7c25902bba02422dd200004f11d29f18ab9410d4863e7c3047e7:v1.13.4

# 2. verify the module before trusting anything above it
talosctl -n 192.168.1.101 get extensions
talosctl -n 192.168.1.101 read /proc/modules | grep drbd
talosctl -n 192.168.1.101 read /sys/module/drbd/parameters/usermode_helper   # -> disabled

# 3. new machine config: kernel.modules, r-linstor, EPHEMERAL cap, HDD volumes
talosctl apply-config --nodes 192.168.1.101 \
  --file clusterconfig/Homelab_staging-staging-controlplane-1.yaml

# 4. EPHEMERAL only ever grows, so the new sizing needs a wipe.
#    This destroys node-1's etcd member, its Longhorn replicas and /var/lib/rook.
talosctl reset --nodes 192.168.1.101 --system-labels-to-wipe EPHEMERAL --graceful

# 5. after it rejoins
talosctl -n 192.168.1.101 get volumestatus
kubectl get nodes
kubectl -n kube-system exec -it etcd-... -- etcdctl member list   # 3 members
```

Then keep Longhorn off node-1 for the rest of the migration — its disk is now
240 GB and cannot hold a third of the cluster's volumes:

```bash
kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1 --type=merge \
  -p '{"spec":{"disks":{"default-disk-...":{"allowScheduling":false}}}}'
```

Longhorn runs two-replica on node-2 and node-3 from here until it is uninstalled.

## Phase 2 — evacuate Ceph

**Gate.** Do not start until node-1's OSDs are back:

```bash
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph -s        # HEALTH_OK
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph osd tree  # 4 hdd OSDs up/in
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph pg stat   # no unavailable/incomplete
```

`ceph-blockpool` is `size: 2` on `failureDomain: osd`, so while node-1 is absent
any PG with both copies there has **zero** reachable copies. Copying data out
before that clears risks a silent partial copy.

Keep: AzuraCast ×4, `n8n-data-pvc`, `nao-project`. Discard: Nexus 350 Gi,
Prometheus TSDB 30 Gi, Grafana 10 Gi, the lab volumes.

> `n8n-data-pvc` holds n8n's **encryption key**. Without it every stored
> credential is undecryptable even with the database intact.

Per volume, with the workload stopped — never `--ignore-mounted` on live data:

```bash
flux suspend kustomization apps
kubectl -n n8n scale deploy/n8n --replicas=0
kubectl -n n8n wait --for=delete pod -l app=n8n --timeout=5m
pv-migrate --source-namespace n8n --source n8n-data-pvc \
           --dest-namespace   n8n --dest   n8n-data-new --dest-delete-extraneous-files
```

Checksum both sides before deleting anything, the way commits `2d2655c` and
`ca47e9f` did. Cilium here is a datapath only with no default deny
([14 §10](14-design-decisions.md)), so pv-migrate needs no NetworkPolicy flags.

## Phase 3 — delete Ceph, stand up LINSTOR, retire Longhorn

Order matters. Patching the **live** CR first is what makes the cleanup jobs run;
deleting the HelmRelease first makes Helm uninstall the cluster with no cleanup
policy and leaves the disks dirty.

```bash
# 0. stop the failing rollback loop first (see "Verified live state")
flux suspend helmrelease rook-ceph-cluster -n flux-system

# 1. arm the cleanup on the LIVE CR. Rook stops reconciling from this moment.
kubectl -n rook-ceph patch cephcluster rook-ceph --type=merge \
  -p '{"spec":{"cleanupPolicy":{"confirmation":"yes-really-destroy-data"}}}'

# 2. only now let Flux go
flux suspend kustomization infrastructure-controllers
kubectl -n flux-system delete helmrelease rook-ceph-cluster

# 3. watch the cleanup jobs. If they never start, a consumer still exists —
#    Rook blocks silently on a leftover PVC or CephBlockPool.
kubectl -n rook-ceph get jobs -w

# 4. operator, then CRDs LAST — deleting CRDs early strands finalizers
kubectl -n flux-system delete helmrelease rook-ceph-operator
kubectl get crd | grep ceph.rook.io | awk '{print $1}' | xargs kubectl delete crd
```

Then commit the removal of the `rook-ceph` trees and
`monitoring/configs/staging/ceph-monitoring/`, and `flux resume`.

Wipe the disks. The OSDs here are **raw mode**, not LVM, so the upstream
`dmsetup` / `/dev/mapper/ceph--*` half of the cleanup is a no-op — "no matches"
is not a failed wipe. `--method FAST` erases only filesystem signatures and
leaves BlueStore metadata that later reads as "OSD belongs to a different ceph
cluster", so use Rook's zap script from a privileged Job for the four USB disks
and `ZEROES` for the small partition. Expect USB bus resets ([16](16-usb-disk-qualification.md)
measured them) and re-check `talosctl get disks` afterwards, because device
letters move.

`r-fastpool` is **kept** — it becomes node-3's LINSTOR pool — so wipe its
contents, not the partition.

Bring LINSTOR up:

```bash
# uncomment linstor-cluster/ in infrastructure/controllers/staging/kustomization.yaml
flux reconcile kustomization infra-linstor --with-source
L() { kubectl -n piraeus-datastore exec deploy/linstor-controller -- linstor "$@"; }
L node list          # 3 Online
L storage-pool list  # pool `ssd` on node-1 (240G) and node-3 (250G)
```

Prove it before trusting it — this is the drill, not a formality:

```bash
# provision, write, checksum
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: drbd-drill, namespace: default}
spec:
  storageClassName: ssd
  accessModes: [ReadWriteOnce]
  resources: {requests: {storage: 1Gi}}
EOF
# ... write a file, sha256 it, then hard-stop the node holding the primary and confirm:
#   - the HA controller taints drbd.linbit.com/lost-quorum
#   - the pod is evicted and its VolumeAttachment force-deleted
#   - it restarts elsewhere in SECONDS, not the ~15 min stock Kubernetes takes
#   - the checksum still matches
L resource list   # TieBreaker on the third node is expected and correct
```

Migrate off Longhorn. For CNPG, editing the class alone does nothing — the
operator only uses it for PVCs it creates. Replicas first, primary last:

```bash
# git: spec.storage.storageClass: ssd  (+ resizeInUseVolumes: false), commit
kubectl cnpg status keycloak-db -n identity
kubectl cnpg destroy keycloak-db 2 -n identity     # rebuilds on ssd via pg_basebackup
kubectl cnpg status keycloak-db -n identity        # wait: streaming, no lag
kubectl cnpg promote keycloak-db 2 -n identity
kubectl cnpg destroy keycloak-db 1 -n identity
```

With only two instances there is no spare during each rebuild; bump to three
first if that matters. Everything else moves with pv-migrate.

Uninstall Longhorn:

```bash
kubectl -n longhorn-system patch --type=merge \
  -p '{"value":"true"}' lhs deleting-confirmation-flag
# HelmRelease spec.uninstall.timeout MUST be >= 15m: the chart's pre-delete Job
# has activeDeadlineSeconds 900 and Flux's default 5m aborts it mid-uninstall,
# leaving finalizer-blocked CRs and a Terminating namespace.
```

Finally repartition node-2 — same four steps as node-1, with schematic
`b86969a5…` — and add its 730 GB pool.

## Phase 4 — SeaweedFS

Only now apply the HDD user volumes: provisioning **repartitions** the disks, and
doing it before the Rook wipe races Ceph for the same devices.

```bash
talosctl apply-config --nodes 192.168.1.101 --file clusterconfig/...-1.yaml
talosctl -n 192.168.1.101 get volumestatus | grep u-hdd
talosctl -n 192.168.1.101 get mountstatus  | grep /var/mnt
```

Each path must appear exactly once. Then unsuspend and bring it up:

```bash
# drop suspend: true from seaweedfs-cluster/release.yaml, commit
flux reconcile kustomization infrastructure-controllers --with-source
kubectl -n seaweedfs get pods -o wide   # 3 masters, 2 volume servers, 2 filers, 2 s3
```

Configure paths **before** creating buckets — `fs.configure` applies at write
time only, and each bucket otherwise pre-allocates ~7 volumes of ~30 GB:

```bash
kubectl -n seaweedfs exec -it deploy/seaweedfs-filer -- weed shell <<'EOF'
fs.configure -locationPrefix=/buckets/ -volumeGrowthCount=1 -apply
s3.bucket.create -name nextcloud
EOF
```

Drill the tier: provision a PVC on `hdd`, write and checksum, kill a volume
server, confirm reads still serve and the volume went **read-only rather than
lost**, restore it, run `volume.fix.replication -apply`, re-verify. Then
round-trip an S3 object byte-for-byte with `aws-cli` — SeaweedFS has a history of
CRC32 corruption with boto3 ≥ 1.36, and the escape hatch is
`AWS_REQUEST_CHECKSUM_CALCULATION=when_required`, which this repo already sets
for R2.

Restore the staged AzuraCast volumes onto `hdd`. Recreate Nexus empty and let CI
refill it — discard-and-re-cache, as `d9268a0` did. Recreate Prometheus and
Grafana empty on `ssd`.

## Phase 5 — Nextcloud onto S3

There is **no supported filesystem → S3 migration**: the objectstore config only
takes effect at install, and `occ objectstore:migrate` does not exist — it is a
hallucination from a widely-copied blog post. The real surface is
`occ files:object:{list,get,info,put,delete,orphans}`. The dataset is ~1.5 GB, so
a fresh instance and a client re-sync is the cheap, supported path.

```
OBJECTSTORE_S3_BUCKET=nextcloud
OBJECTSTORE_S3_HOST=seaweedfs-s3.seaweedfs.svc.cluster.local
OBJECTSTORE_S3_PORT=8333
OBJECTSTORE_S3_SSL=false
OBJECTSTORE_S3_USEPATH_STYLE=true
OBJECTSTORE_S3_AUTOCREATE=false
```

`use_path_style` is mandatory. A small `ssd` PVC still mounts at `/var/www/html`
for the code tree, `config/`, `custom_apps/`, themes and PHP temp files; only
`appdata_<instanceid>` moves to the bucket.

**The database becomes the only record of every filename, directory and share.**
The bucket holds flat `urn:oid:<fileid>` blobs and `occ files:scan` cannot
rebuild the tree from them. `nextcloud-db`'s backup posture — currently a daily
CNPG backup to Garage at 03:30 with 7-day retention — now matters strictly more
than it did.

## Phase 6 — the backup this cluster has never had

[14 §10](14-design-decisions.md) has listed "Longhorn `backupTarget`: volume data
has no backup at all" as the next piece of work in three separate documents.
LINSTOR ships S3 snapshot shipping, and Garage is already wired:

```bash
L remote create s3 garage garage-s3.garage-gw.svc.cluster.local:3900 \
  <bucket> garage <access-key> <secret-key> --use-path-style
```

`--use-path-style` is mandatory — Garage does no virtual-host addressing — and
the remote is unreadable without the `linstorPassphraseSecret`. Treat that
passphrase like the offline age key for the etcd snapshots.

This is also why the pools are `LVM_THIN` and not `FILE_THIN`: snapshot shipping
is unsupported on file pools (linstor-server#374), so the shortcut that would
have avoided every repartition would have forfeited exactly this.

## Related documentation

- [`../infrastructure/controllers/base/linstor/README.md`](../infrastructure/controllers/base/linstor/README.md)
- [`../infrastructure/controllers/base/seaweedfs/README.md`](../infrastructure/controllers/base/seaweedfs/README.md)
- [15-node-1-hdd-expansion.md](15-node-1-hdd-expansion.md) — the hardware inventory
- [16-usb-disk-qualification.md](16-usb-disk-qualification.md) — why these four disks and not the fifth
- [09-etcd-backup-dr.md](09-etcd-backup-dr.md) — what an EPHEMERAL wipe costs
- [12-garage-object-storage.md](12-garage-object-storage.md) — the S3 target and its region trap
