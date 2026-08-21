# Rook / Ceph

A second storage backend, alongside Longhorn, on four USB-attached hard disks.
Longhorn keeps every existing workload and stays the default StorageClass; Ceph
offers `ceph-block` and nothing uses it until something asks for it by name.

Two pieces, two tiers:

| Path | What |
|---|---|
| `infrastructure/controllers/base/rook-ceph/` | The operator, its namespace and Helm repository. Portable. |
| `infrastructure/controllers/staging/rook-ceph-cluster/` | The `CephCluster`, pool and StorageClass. **Hardware-specific** — it names PCI paths of this cluster's USB ports, so it cannot live in `base/`. |

The two charts are pinned to the **same version** and must be bumped together,
the same rule the two ARC charts already carry.

## Status: the cluster HelmRelease is suspended

`suspend: true` on `rook-ceph-cluster`. Unsuspending hands four raw disks to
`ceph-volume`, which wipes them, and those disks are running a 72-hour burn-in
([`scripts/hdd-burn-in/`](../../../../scripts/hdd-burn-in/README.md)). Flip it to
`false` only after that passes and
[`documentations/16`](../../../../documentations/16-usb-disk-qualification.md)
records the verdict.

The operator is safe to run before then: with no `CephCluster` it watches and
does nothing.

## Why the disks are selected by `devicePathFilter`

Not by name, and not by WWID. Both fail on this hardware, and both failures were
observed rather than guessed:

- **Device letters move.** A USB bridge that re-enumerates renames its disks;
  node-1's went `sdb`/`sdc` → `sdl`/`sdm` on a single replug. `devices: [{name:
  sdl}]` would then point Rook at whatever now holds that letter.
- **WWID is fabricated.** Both docks report `naa.5000000000000001` for *both*
  their bays, so it identifies four different disks across two nodes.

`/dev/disk/by-path` encodes the PCI address and USB port, which is stable across
re-enumeration on the same port:

| Node | Path | Disk |
|---|---|---|
| 1 | `pci-0000:04:00.4-usb-0:2:1.0-scsi-0:0:0:0` | 1.0 TB |
| 1 | `…-scsi-0:0:0:1` | 500 GB |
| 2 | `pci-0000:00:14.0-usb-0:6:1.0-scsi-0:0:0:0` | 2.0 TB |
| 2 | `…-scsi-0:0:0:1` | 320 GB |

**Moving a dock to a different port breaks the filter**, and Rook then finds no
devices on that node. That is deliberate: failing visibly beats silently
adopting the wrong disk. If a dock moves, re-read
`talosctl -n <ip> list /dev/disk/by-path` and update the filter.

The filter on node-2 also excludes, by construction, the 250 GB disk on
`pci-0000:00:1d.0`. Its bridge acknowledges cache flushes it never performs —
0.394 ms for a durable write on a 7200 rpm spindle, where one revolution is
8.33 ms. Ceph would treat every commit as durable while it sat in a cache that a
power cut empties. **It must never become an OSD.**

## Why `size: 2`, and what it costs

OSDs exist on node-1 and node-2 only; node-3 has no spare disk. With
`failureDomain: host` that caps replication at two copies — asking for three
would leave the pool permanently unschedulable rather than degraded, which is
exactly the trap `longhorn-hdd` hit in
[`documentations/15`](../../../../documentations/15-node-1-hdd-expansion.md).

Three settings encode one decision, and none of them can be left to a default:

- `size: 2` — one copy per host, survives losing a node.
- `requireSafeReplicaSize: false` — Rook considers anything below 3 unsafe and
  refuses the pool without it. Setting it is an acknowledgement, not a tweak.
- `min_size: "1"` — the pool keeps accepting writes while only one copy is
  reachable. This is what makes surviving a node loss actually useful; at
  `min_size: 2` a node loss blocks all writes instead. **The cost is real: a
  second disk failure before recovery completes loses data.** There is no backup
  target for Ceph in this cluster, so treat `ceph-block` as regenerable data.

Giving node-3 a disk is what lifts this to `size: 3`, and it is the single
highest-value hardware change available.

## Why `deviceClass: hdd` is forced

The 2 TB disk reports `rotational=0` through its bridge and is a 7200 rpm hard
disk — its measured latency is one platter revolution per durable write. Left to
autodetect, `ceph-volume` would class it `ssd`, and CRUSH would then see two
device classes across four disks and place data unevenly. Both the cluster
storage config and the pool pin `hdd`.

## Talos specifics

Less than expected. Verified on v1.13.4, kernel 6.18.34:

- **RBD and CephFS are compiled into the kernel**, not modules: `/proc/devices`
  lists `252 rbd` and `/proc/filesystems` lists `ceph`. No system extension, no
  `machine.kernel.modules` entry, no schematic change, no reboot. Older Rook-on-
  Talos guides tell you to load `rbd` — that advice predates this.
- `nbd.ko` ships too, so `rbd-nbd` is available as a fallback mounter.
- `dataDirHostPath: /var/lib/rook` lives on the `EPHEMERAL` partition, which is
  writable and has 400 GB+ free on every node.
- The namespace needs `pod-security.kubernetes.io/enforce: privileged`. OSDs open
  raw block devices and the CSI plugin bind-mounts host paths; both are forbidden
  at this cluster's `baseline` default.

## Things that will bite

- **`crds.enabled: true` is only meaningful at first install.** Turning it off
  later and deleting the CRDs destroys the cluster. See Rook's disaster-recovery
  guide before touching it.
- **Expect a USB bus reset when an OSD is first created.** `ceph-volume` destroys
  the partition table while writing hard, and on the slower dock that provokes a
  udev re-probe storm whose reads time out at 30 s and reset the bridge. Measured,
  understood, and recoverable — the mechanism is in
  [`documentations/16`](../../../../documentations/16-usb-disk-qualification.md).
  It is not a reason to blame the hardware or to reach for
  `usb-storage.quirks`.
- **Ceph has no backup target here**, exactly like Longhorn. Only workloads with
  their own database-level backup survive a correlated failure
  ([`documentations/03-backups.md`](../../../../documentations/03-backups.md)).
- **Monitoring is off.** `monitoring.enabled: false` on both charts, so no
  ServiceMonitor and no Ceph PrometheusRules yet. That is a deliberate first
  bring-up choice, not an oversight — wiring Ceph alerts into the conventions of
  [`documentations/05-alerting.md`](../../../../documentations/05-alerting.md) is
  its own change.
- **The dashboard is HTTP, no TLS**, reachable only in-cluster. It is not exposed
  on the tailnet the way Longhorn's UI is.

## Bringing it up

```bash
# 1. burn-in must be finished and clean
kubectl -n hdd-burnin get jobs
grep -E "NEW KERNEL EVENT|STALE MOUNT" scripts/hdd-burn-in/results/watch.log

# 2. tear the rig down so nothing holds the disks open
kubectl delete ns hdd-burnin

# 3. flip suspend: false in staging/rook-ceph-cluster/release.yaml, commit, then
flux reconcile kustomization infrastructure-controllers --with-source

# 4. watch OSDs appear — expect 4
kubectl -n rook-ceph get pods -l app=rook-ceph-osd
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph status
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph osd tree
```

`ceph osd tree` must show two hosts, two OSDs each, all `hdd` class. A third
host or a stray `ssd` class means the device filter or the device class is wrong.
