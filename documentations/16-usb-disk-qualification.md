# 16 — qualifying the USB disks for Ceph

Measured 2026-08-17 on `staging`, Talos `v1.13.4`, k8s `v1.36.1`. Five
USB-attached disks across `staging-controlplane-1` and `staging-controlplane-2`,
held as raw block devices for a Rook/Ceph trial. Rig:
[`scripts/hdd-burn-in/`](../scripts/hdd-burn-in/README.md).

**The answer in one line: the enclosure decides, not the disk.** Four of the five
disks honour cache flushes and are physically fit to be OSDs. The fifth is
disqualified outright — its bridge acknowledges flushes it never performs, so
BlueStore would call data durable while it sits in a cache that a power cut
empties.

Status: **complete. All three phases passed for four of the five disks.** The
72 h soak ran 2026-08-17 20:35 to 2026-08-20 20:35 UTC and was clean.

**Ceph is live** since 2026-08-21: `HEALTH_OK`, four OSDs across two hosts,
3.5 TiB raw, `ceph-block` provisioning verified end to end (PVC bound, RBD mapped
as `/dev/rbd0`, data written and checksummed). Alerts and scrapes are wired into
Prometheus, the dashboard is on the tailnet over HTTPS, and the cluster reports
upstream telemetry.
Bring-up cost four bugs, all fixed and all recorded under "Bringing Ceph up".

## Phase 1 — flush honesty

4 KiB writes, `iodepth=1`, `numjobs=1`, 300 s, direct to the raw device. `sync`
sets `O_DSYNC`; `fsync` writes buffered and calls `fdatasync` after each, which
prices the flush on its own.

| Node | Dev | Size | Enclosure | IOPS | write mean | flush cost | p99 | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | `sdl` | 1.0 TB | ASMedia LUN 0 | 119 | 8.39 ms | **8.36 ms** | 8.45 ms | honest |
| 1 | `sdm` | 500 GB | ASMedia LUN 1 | 109 | 9.18 ms | — | 25.8 ms | honest |
| 2 | `sdk` | 2.0 TB | ASMedia LUN 0 | 119 | 8.39 ms | **8.33 ms** | 8.98 ms | honest |
| 2 | `sdl` | 320 GB | ASMedia LUN 1 | 67 | 15.02 ms | — | 34.3 ms | honest |
| 2 | `sdm` | 250 GB | "Storage Device" | **2466** | 0.40 ms | **0.394 ms** | 0.68 ms | **disqualified** |

A durable 4 KiB write cannot cost less than one platter revolution: 8.33 ms at
7200 rpm, 11.1 ms at 5400 rpm. That is not a benchmark convention, it is the
mechanism — the write has to wait for the target sector to come back around.

Read the table against that number and it interprets itself. The four ASMedia
disks land *on* it. node-1 `sdl` returns 8.39 ms with a p99 of 8.45 ms: one
rotation, 119 times a second, with almost no spread. node-2 `sdm` returns
0.394 ms — twenty times faster than its own platter can turn. It is not a fast
disk; it is a bridge answering "done" before the data left the enclosure.

### The cross-check that makes the result trustworthy

On node-1 `sdl`, buffered writes with an explicit `fdatasync`:

```
write mean = 0.02 ms      fdatasync mean = 8.36 ms      p99 = 8.45 ms
```

The write returns in 20 µs into page cache; the flush costs a full revolution.
The rig therefore *can* see a free flush and *does* charge for a real one — the
119 IOPS figure is not an artefact of the harness. The same split on node-2 `sdm`
reads `write 0.028 ms / fdatasync 0.394 ms`: it charges for nothing on either
path, which rules out one primitive being honoured and the other dropped.

### Control

`hdd-sata-640` on node-1 — a native SATA 5400 rpm disk, measured through its
filesystem while carrying a live `nextcloud/nextcloud-db-2` Postgres replica:
**20 IOPS, 50.6 ms mean, 88.6 ms p99, 99.2 % utilisation.** Slower than every USB
disk above, because it was contended rather than idle. It is in the record as
proof that the method reports honest-and-busy as slow, not as broken.

## Phase 2 — SMR, and what it actually found

300 GiB sequential, `bs=1M`, `iodepth=4`, direct to the raw device (250 GiB on the
320 GB disk). One disk at a time per node; both nodes in parallel.

| Node | Dev | avg | first 10 min | last 10 min | min 1 s sample | duration |
|---|---|---:|---:|---:|---:|---:|
| 1 | `sdl` 1.0 TB | 122 MB/s | 116 | 127 | 57 | 42 min |
| 1 | `sdm` 500 GB | 106 MB/s | 117 | 92 | 86 | 48 min |
| 2 | `sdk` 2.0 TB | 212 MB/s | 214 | 209 | 147 | 24 min |
| 2 | `sdl` 320 GB | 72 MB/s | 85 | 55 | 7 | 60 min |

**No SMR.** Every curve is a smooth monotonic taper, which is zone-bit recording —
outer tracks hold more sectors per revolution than inner ones, so a sequential
write from LBA 0 slows as it moves inward. SMR looks nothing like this: it holds
media rate until the CMR cache fills, then collapses to 10–30 MB/s and *stays*
there while the drive does read-modify-write on shingled zones. The deepest taper
here is `sdl` on node-2, 85 → 55 MB/s across 78 % of the platter, which is the
expected outer:inner ratio. `sdk` barely tapers because 300 GiB is only the outer
15 % of a 2 TB disk.

These rates also settle what the hardware is. 212 MB/s and an 8.33 ms rotation are
3.5" 7200 rpm desktop drives, not the 5400 rpm laptop drives doc 15 assumed. Doc 15's
"the trade is that a Postgres replica can land on a 5400 rpm drive" was written
about `hdd-sata-640`, which genuinely is one — the USB disks are better hardware
than the docs implied.

### The finding was in `dmesg`, not in the bandwidth curve

node-1's dock reset eight times under load:

```
sd 10:0:0:0: [sdl] tag#8 uas_eh_abort_handler 0 uas-tag 7 inflight: CMD IN
scsi host10: uas_eh_device_reset_handler start
usb 4-2: reset SuperSpeed USB device number 3 using xhci_hcd
scsi host10: uas_eh_device_reset_handler success
I/O error, dev sdl, sector 0 op 0x0:(READ) flags 0x80700 phys_seg 16
```

| | node-1 dock (`usb 4-2`) | node-2 dock (`usb 4-6`) |
|---|---:|---:|
| bus resets | **8** | 0 |
| UAS aborts | **8** | 0 |
| hard I/O errors | **5** | 0 |
| bytes written under load | 600 GiB | 550 GiB |
| peak sustained rate | 122 MB/s | 212 MB/s |

All eight resets fell between 15:21:48 and 15:25:46 — the first four minutes of
sustained load — after which the dock ran 85 more minutes of saturated writes
clean. They are spaced **exactly 30 seconds apart**, which is the SCSI command
timeout: a command hangs, the timer expires, UAS aborts it and resets the bus,
the next command hangs the same way. The I/O errors are reads of sector 0, 128 and
the last sectors of the disk — the kernel re-reading the partition table after each
reset, and failing.

The two docks are the same model with identical USB descriptors (ASMedia
`174c:55aa`, `speed 5000`, `version 3.20`, `bMaxPower 0mA`, one interface), on the
same driver, and node-2's carried *more* throughput without a single error.

### The test caused its own failure

Repeating the identical 300 GiB pass on the **unchanged** port and cable produced
**zero** resets, zero aborts, zero I/O errors across 48 minutes:

| | run 1 | run 2 |
|---|---:|---:|
| resets / aborts / I/O errors | 8 / 8 / 5 | **0 / 0 / 0** |
| avg | 122.1 MB/s | 106.8 MB/s |
| min / max 1 s sample | 57 / 197 MB/s | 53 / 195 MB/s |

Not reproducible, so not a link fault. The mechanism is in the Talos service log:

```
15:22:22 service[udevd](Running): Health check failed: Timed out while waiting for udev queue to empty.
15:24:32 service[udevd](Running): Health check successful
```

That window sits inside the reset window, and node-2 logged nothing like it.
Reconstructed:

1. fio's first 1 MiB writes landed at LBA 0 and destroyed the GPT that
   `talosctl wipe disk` had left behind.
2. The kernel raised change events; udev re-probed the disk — which is a read of
   sector 0, sector 128, and the disk's last sectors, the GPT primary and backup
   locations. **Those are exactly the five sectors that erred.**
3. Each probe read queued behind 4-deep 1 MiB writes saturating the bridge, aged
   past the 30-second SCSI command timeout, and UAS aborted and reset the bus —
   hence the resets spaced exactly 30 s apart.
4. Each reset raised another change event, which triggered another probe. The loop
   fed itself until the partition table was definitively gone and udev had nothing
   left to re-read.

node-2's dock escaped it by being faster: 212 MB/s against 122 drained the write
queue quickly enough that probe reads never aged into a timeout. The resets are
therefore a property of *throughput under a udev storm*, not of a cable.

**Consequence for Ceph, and it is not hypothetical.** Rook zaps a device before
creating an OSD, which is the same "destroy the partition table while writing hard"
sequence. Expect one reset burst per OSD at creation on the slower dock. It is
recoverable — fio completed and wrote all 300 GiB — but an OSD that flaps during
its own initialisation is worth knowing about in advance, and the fix if it bites
is to let the zap settle before starting the OSD, not to blame the hardware.

The `usb-storage.quirks=174c:55aa:u` remedy was **not** applied. It would trade
throughput across the whole chipset for a fault that does not exist.

## Two things the kernel says that are not true

**`/sys/block/sdk/queue/rotational` = `0` on a 2 TB hard disk.** The ASMedia
bridge advertises the disk as non-rotational. Its measured latency signature —
8.39 ms per durable write, p99 8.98 ms — is one 7200 rpm revolution, so the
mechanism is mechanical and the flag is wrong. This matters for Ceph specifically:
BlueStore picks defaults from that flag, so it would tune a spindle as flash. Any
Rook `CephCluster` using these disks has to override it rather than trust
autodetection.

**`Synchronize Cache(10) failed: Result: hostbyte=DID_ERROR`** appears in node-1's
`dmesg` for both dock LUNs. That was the device-removal path, not the write path;
phase 1 shows flushes are honoured during normal I/O. Alarming, and not the same
finding as the 250 GB disk's.

## The stale-mount failure mode, measured

This is the part worth reading before anyone puts data behind a USB bridge again.

node-1's dock was moved to a USB 3 port (it had been enumerating at 480 Mb/s —
see below). The kernel re-enumerated it and renamed the disks `sdb`/`sdc` →
`sdl`/`sdm`. `/proc/mounts` did not follow:

```
/dev/sdb1 /var/mnt/hdd-usb-1000 xfs rw,...     # /dev/sdb1 no longer exists
/dev/sdc1 /var/mnt/hdd-usb-500  xfs rw,...
```

Consequences, in order:

1. Every I/O to those paths returned EIO.
2. Longhorn marked both disks `Ready=False Schedulable=False`, `avail=0`.
3. A pod requesting the path did not fail — it never started:
   ```
   MountVolume.SetUp failed for volume "target" :
     hostPath type check failed: /var/mnt/hdd-usb-1000 is not a directory
   ```

The third is the one that matters. A replica pod in that state is not degraded, it
is stuck in `ContainerCreating` indefinitely. Talos exposes no unmount API and
`MountController` will not re-mount over a stale mount, so nothing recovers on its
own.

**Recovery is cheaper than expected.** Removing the `UserVolumeConfig` from
`talconfig.yaml` and running `talosctl apply-config` unmounted both stale mounts
immediately — `Applied configuration without a reboot`, and `/proc/mounts` came
back clean. The planned drain-and-reboot was not needed: node-1 was cordoned and
drained, then uncordoned with every volume still healthy and `dbtools-db-1`
untouched at 23 h uptime. Zero downtime.

Two caveats on that. The drain could not complete — `instance-manager` and
`dbtools-db-1` (a **single-instance** CNPG cluster, no replica to fail over to)
both correctly refused eviction on their PodDisruptionBudgets. And this recovery
works because the volume was being *removed*; restoring one means re-adding the
config and applying again.

The trigger here was a deliberate cable pull against empty disks. A bridge reset
under load reaches the same state with live data on the disk, which is what phase
3 is for.

## The USB 2.0 episode

node-1's dock was on a 480 Mb/s root hub (`usb 1-3: new high-speed USB device`)
while the machine had two unused 10 Gb/s controllers. Both of its disks shared
that 480 Mb/s — a ~35–40 MB/s combined ceiling, low enough to hide an SMR cliff
completely. It now runs at `speed 5000` on `usb 4-2`.

node-2's 250 GB disk is still on a 480 Mb/s path: `usb 3-1.3: new high-speed USB
device`, behind an internal EHCI hub, bound to `usb-storage` rather than `uas`,
`queue_depth=1` — one command in flight at a time. It was intended to be "directly
on USB 3". It is disqualified on flush honesty regardless, so the link no longer
matters for it, but the lesson stands: check
`/sys/bus/usb/devices/<dev>/speed` before trusting any USB bandwidth number.

## Consequences for the Ceph plan

- **The 250 GB disk cannot be an OSD.** Not tunable, not quirk-able. Excluding it
  is also the only way to keep the pool off a 480 Mb/s `queue_depth=1` path, which
  would have gated every OSD in the cluster.
- **The four survivors sit on two nodes, and unevenly: 1.5 TB on node-1, 2.3 TB
  on node-2.** That asymmetry, not the node count, is what drove the failure
  domain. A `host` domain needs one copy per node and so caps the pool at the
  smaller node, stranding ~800 GB. `size: 3` on a `host` domain is impossible
  with two nodes at all — it would leave the pool unschedulable rather than
  degraded, the same trap doc 15 hit when `longhorn-hdd` was set to two replicas
  with every tagged disk on one node.
- **There is no device for BlueStore WAL/DB.** node-1's NVMe has 3.1 GB
  schedulable and node-2's only fast disk is its install disk. WAL and DB colocate
  on the spindles, so the usual "put the journal on flash" escape does not exist
  here. Expect commit latency in the 8–15 ms range measured above.
- **`rotational` must be overridden**, not autodetected, for `sdk`.

### What was decided

`size: 2`, `failureDomain: osd`, `min_size: 1`, Ceph alongside Longhorn with
Longhorn staying the default class.

**Disk redundancy, explicitly not node redundancy.** Two copies on two different
OSDs, which may share a node. Any one disk can die with no data loss; losing a
node can lose data, and that was chosen deliberately over `failureDomain: host`
because the disks are lopsided — node-1 holds 1.5 TB against node-2's 2.3 TB, so
a host domain caps the pool at ~1,500 GB and strands ~800 GB on node-2 forever.

| | `host` | `osd` (chosen) |
|---|---:|---:|
| Theoretical max | 1,500 GB | 1,820 GB |
| Practical at 85 % nearfull | ~1,275 GB | ~1,550 GB |
| Self-heals after worst-case disk loss, up to | ~300 GB | **910 GB** |

The recovery column is the bigger reason. Under `osd` a dead disk rebuilds onto
any surviving OSD rather than only onto its own node's other disk, so the pool
repairs itself across roughly three times the working set.

Two costs, both accepted:

- **Every planned node reboot takes part of the pool offline**, not just an
  unplanned failure. PGs with both copies on the rebooting node have zero
  reachable copies and their I/O blocks until it returns; `min_size: 1` does not
  help, because the floor is zero and not one. Talos upgrades and `apply-config`
  reboots are routine in this repo, so this is a recurring cost, not a rare one.
- **A second disk failure before recovery completes loses data**, on a pool with
  no backup target.

Giving node-3 a disk is what would allow `size: 3` on a `host` domain and remove
the whole trade. It remains the single highest-value hardware change available to
this cluster.

The manifests live in `infrastructure/controllers/base/rook-ceph/` (operator) and
`infrastructure/controllers/staging/rook-ceph-cluster/` (the `CephCluster`, whose
device paths are hardware-specific). Rook `v1.20.4`, both charts pinned together.
The cluster HelmRelease is **suspended** until this document records a phase 3
pass — unsuspending hands the disks to `ceph-volume`, which wipes them.

Talos needed nothing: `/proc/devices` lists `252 rbd` and `/proc/filesystems`
lists `ceph`, so both are compiled into the kernel. No system extension, no
`machine.kernel.modules`, no schematic change, no reboot. Guides that tell you to
load the `rbd` module predate this.

## What changed in git

Merged as `2e00a19`, one squashed commit. What it carries:

| Path | Change |
|---|---|
| `bootstraping/talconfig.yaml` | Dropped the `hdd-usb-1000` / `hdd-usb-500` `UserVolumeConfig` documents and their entries in the Longhorn `default-disks-config` annotation. `hdd-sata-640` stays. |
| `infrastructure/controllers/base/longhorn/storageclass-hdd.yaml` | Deleted. `longhorn-hdd` selected `tags: [hdd]`, which only the two USB disks carried; with them gone the class matches no disk and any PVC on it hangs forever rather than failing. Nothing used it. |
| `infrastructure/controllers/base/rook-ceph/` | New: operator, namespace, Helm repository. Rook `v1.20.4`. |
| `infrastructure/controllers/staging/rook-ceph-cluster/` | New: the `CephCluster`, pool and StorageClass. `suspend: true`. |
| `clusters/staging/infrastructure.yaml` | New `infra-rook-ceph` Kustomization. |
| `scripts/hdd-burn-in/` | New rig, plus results. |
| `bootstraping/README.md`, `infrastructure/controllers/{README.md,base/longhorn/README.md}`, `CLAUDE.md`, `documentations/15` | Prose caught up with the above. |

Live-cluster changes not expressible in git, in order applied:

```bash
# 1. Longhorn requires allowScheduling: false before a disk can be removed
kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1 --type=merge \
  -p '{"spec":{"disks":{"hdd-usb-1000":{"allowScheduling":false},"hdd-usb-500":{"allowScheduling":false}}}}'
kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1 --type=json \
  -p '[{"op":"remove","path":"/spec/disks/hdd-usb-1000"},{"op":"remove","path":"/spec/disks/hdd-usb-500"}]'

# 2. the machine config, which unmounted both stale volumes without a reboot
cd bootstraping && SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
talosctl apply-config -n 192.168.1.101 --file clusterconfig/Homelab_staging-staging-controlplane-1.yaml

# 3. the disks, raw for Rook — irreversible
talosctl -n 192.168.1.101 wipe disk sdl sdm --drop-partition
talosctl -n 192.168.1.102 wipe disk sdk sdl --drop-partition

# 4. the .mgr pool, which Ceph auto-created at size 3 on a host domain that two
#    hosts cannot satisfy. cephConfig in the HelmRelease covers a REBUILD; this
#    is the one-time fix for the pool that already exists.
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph osd pool set .mgr size 2
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph osd pool set .mgr min_size 1
```

node-1 was cordoned and drained before step 2 and uncordoned after. The drain
could not complete — `instance-manager` and `dbtools-db-1` (a **single-instance**
CNPG cluster, no failover partner) both refused eviction on their
PodDisruptionBudgets — and it turned out not to matter, because no reboot was
needed. Every volume stayed healthy and `dbtools-db-1` was never restarted.

node-1 now presents two Longhorn disks, `default-disk-080600000000` and
`hdd-sata-640`, both `Ready`/`Schedulable`. This partially reverts `ab28713`; doc
15 stays as the record of how those disks were provisioned and why, because the
same reasoning applies if they ever come back to Longhorn.
## Phase 3 — the 72 h soak: passed

Ran 2026-08-17 20:35 to 2026-08-20 20:35 UTC. All four surviving disks, both bays
of both docks concurrently — one bridge serving two LUNs is the contention that
provokes a reset, and sequential runs never reproduce it. `randrw` 70/30,
`bs=64k`, `iodepth=8`, `numjobs=2`, 100 GiB region per disk.

| Node | Dev | read IOPS | write IOPS | read lat | write lat | moved |
|---|---|---:|---:|---:|---:|---:|
| 1 | `sdl` 1.0 TB | 65 | 28 | 219 ms | 66 ms | 1 460 GiB |
| 1 | `sdm` 500 GB | 98 | 42 | 157 ms | 14 ms | 2 217 GiB |
| 2 | `sdk` 2.0 TB | 122 | 52 | 103 ms | 66 ms | 2 749 GiB |
| 2 | `sdl` 320 GB | 76 | 32 | 204 ms | 16 ms | 1 713 GiB |

**Nothing failed.** Three independent accounts agree:

- **Kernel**: zero qualifying events on either node across the whole window — no
  UAS abort, no bus reset, no I/O error, no command timeout, no failed
  `Synchronize Cache`. The lifetime counters still read exactly what phase 2 left
  them at (node-1 8/8/5, node-2 0/0/0), and the ring buffer never wrapped, so
  that is a complete record rather than a sampled one.
- **fio**: `total_err=0`, no short or dropped I/Os, on all four, over the full
  259 261 s.
- **Kubernetes**: four Jobs `Complete 1/1`, zero pod restarts.

Just under **8 TiB** moved in aggregate, on top of the ~1.7 TiB phase 2 wrote.

Latency looks alarming and is not: at 16 outstanding I/Os (`iodepth 8` ×
`numjobs 2`), 65 IOPS *is* 219 ms by Little's law. Every disk matches its own
prediction, so the queue is saturated at the drive's natural random-seek rate —
which is what a 7200 rpm spindle does with a 64 KiB random workload.

No degradation over three days. Per-6-hour means stay inside a narrow band, with
no trend on any disk:

```
n1-sdl   1.68 1.43 1.36 1.49 1.37 1.34 1.40 1.37 1.35 1.35 1.54 1.61   MB/s
n1-sdm   2.37 1.99 2.30 2.12 2.12 2.19 2.09 2.20 2.14 2.13 2.28 2.34
n2-sdk   3.37 2.96 2.37 2.94 3.16 1.88 2.79 3.10 2.18 2.16 2.96 2.69
n2-sdl   1.76 1.75 1.71 1.68 1.70 1.73 1.68 1.66 1.68 1.69 1.64 1.63
```

Comparing only the first hour against the last suggests `n2-sdk` fell by half.
The 6-hour view shows why that is wrong: it is the most variable disk (1.88–3.37)
and it ends mid-range. `n2-sdl` is the only monotonic one, drifting 7 % over
three days, which is nothing.

### What the soak does and does not license

It says these four disks and their two bridges survive three days of saturated
concurrent random I/O without a single bus event. That was the open question, and
it is now answered.

It does not say the bridges survive a **partition-table rewrite under load** —
phase 2 showed node-1's does not, and Rook does exactly that when it zaps a
device to create an OSD. Expect that burst once per OSD at creation, and do not
mistake it for the soak's verdict being wrong.

## Bringing Ceph up — four bugs worth knowing

The soak said the hardware was fine. Bring-up was still four failures deep, and
every one of them presented as healthy until a PVC was actually created.

**1. Only two OSDs appeared instead of four.** node-1's disks were skipped:

```
skipping device "sdl": failed to execute ceph-volume inventory on disk "/dev/sdl".
RuntimeError: No udev data could be retrieved for /sys/block/sdl
```

`/run/udev/data` had no entry for that device — fallout from the phase 2 reset
storm, where `udevd`'s queue timed out. `ceph-volume inventory` walks *every*
block device to build its list, so one device without udev data raises before it
reaches the others, which is why both node-1 disks were skipped rather than one.
Talos refuses `service udevd restart` over the API, so the fix is a node reboot:
coldplug repopulates `/run/udev/data`, which is tmpfs.

**2. `storageClass.parameters` replaces the chart's defaults, it does not merge.**
Setting `imageFormat`/`imageFeatures`/`fstype` silently dropped the four CSI
secret name/namespace pairs the chart ships, and every provision failed with
`provided secret is empty` while the pool, the OSDs and every CSI pod looked
healthy. Worse on the second pass: StorageClass `parameters` is **immutable**, so
the corrected Helm chart could not patch it —
`updates to parameters are forbidden`. The class has to be deleted and recreated.

**3. Rook v1.20 installs only half of ceph-csi.** It delegates CSI to
`ceph-csi-operator` and pulls in the operator, but the `Driver` CRs, their
ServiceAccounts and their RBAC live in a separate `ceph-csi-drivers` chart that
Rook does not install. Nothing created `rbd-ctrlplugin-sa`/`rbd-nodeplugin-sa`, so
the plugin DaemonSet could not schedule at all:
`error looking up service account`. That chart is now its own HelmRelease. The
driver name is load-bearing twice over — it must equal the StorageClass
provisioner, *and* the operator derives both ServiceAccount names from it.

**4. Self-inflicted: never live-patch a HelmRelease that owns CRDs.** Toggling
`csi.installCsiOperator` on the live release to test an alternative uninstalled
the CSI subchart, and its `clientprofiles.csi.ceph.io` CRD then stuck in
`Terminating` behind a `ClientProfile` holding the `csi.ceph.com/cleanup`
finalizer — whose controller had just been removed. Helm then timed out waiting
for that CRD on every retry and rolled back four times. Breaking the deadlock
needs the finalizer cleared by hand:

```bash
kubectl -n rook-ceph patch clientprofiles.csi.ceph.io rook-ceph \
  --type=merge -p '{"metadata":{"finalizers":[]}}'
```

### The device-letter rotation, and why `devicePathFilter` earned its place

The node-1 reboot in bug 1 renamed every disk on the node. The SATA disk holding
a live Longhorn replica moved `sda` → `sdc`, and the 1 TB USB disk took `sda`:

```
pci-0000:04:00.4-usb-0:2:1.0-scsi-0:0:0:0 -> ../../sda   (1.0 TB USB)
pci-0000:04:00.4-usb-0:2:1.0-scsi-0:0:0:1 -> ../../sdb   (500 GB USB)
```

A `devices: [{name: sdl}]` config would have been stale, and a config naming
`sda` would have pointed Rook at whichever disk happened to hold that letter. The
by-path filter resolved to the correct pair across the rename without edits.

## Monitoring, and the dashboard on the tailnet

Both added 2026-08-21, after bring-up.

**Alerts live in `monitoring/configs/staging/ceph-monitoring/`, not in the
chart.** The chart's `monitoring.enabled: true` would generate a ServiceMonitor
and PrometheusRules without the `release: kube-prometheus-stack` label this
cluster's Prometheus selects on — objects that apply cleanly, appear in
`kubectl get`, and are never scraped, with no error anywhere. That is the exact
failure `monitoring/configs/README.md` warns about, so the flag stays `false` and
the configs are hand-written, the same as Longhorn's. Ceph exposes the metrics
regardless: the mgr `prometheus` module and `rook-ceph-exporter` are on by
default.

Two ServiceMonitors — the mgr for the cluster-wide view, the exporter for
per-node daemon metrics. Only the *active* mgr serves metrics and its Service
already selects `mgr_role: active`, so the scrape follows a failover unaided.
Four targets up, verified: one mgr, three exporters.

Seven alerts. Every expression was read off the live `/metrics` on Ceph 20.2.2
rather than lifted from a dashboard, then evaluated in Prometheus to confirm it
returns a series — the encoding traps are real:

- `ceph_health_status` is **unlabelled**, valued 0 / 1 / 2.
- `ceph_osd_up`, `ceph_osd_in`, `ceph_mon_quorum_status` are per-`ceph_daemon`
  1 / 0.
- the `ceph_pg_*` family is keyed by `pool_id`, an integer — join through
  `ceph_pool_metadata` for a readable name.
- `ceph_cluster_total_bytes` and `..._used_bytes` are **raw**. At `size: 2` the
  usable figure is roughly half, and the practical ceiling is lower still.

**The `for:` durations are the part tuned to this cluster.** `failureDomain: osd`
means a node reboot puts Ceph into `HEALTH_WARN` by design, so
`CephHealthWarning` waits an hour rather than paging on every Talos upgrade, and
`CephPGsDegraded` waits two because recovery onto USB spindles is slow and a
progressing rebuild is not an incident. `CephOSDDown` stays at 10 minutes: at
`size: 2` one OSD down leaves those PGs on a single copy, with no backup target.

**The dashboard is at `https://ceph.<tailnet>.ts.net`** — real HTTPS on 443,
served by an `Ingress` with `ingressClassName: tailscale`, the same mechanism
pgAdmin, Keycloak, n8n and the AI gateway use. It started on the
Service-annotation expose (plain HTTP on 7000) and was converted; the annotations
were removed from the Service in the same change, because running both mechanisms
registers two tailnet devices contending for one hostname and the loser is
silently suffixed `ceph-1`. Ceph itself still speaks plain HTTP behind the proxy
(`dashboard.ssl: false`), so turning its own TLS on moves the backend to 8443 and
the Ingress must move with it.

**The dashboard's own panels stayed dark for a day after that**, which is worth
recording because nothing about it looks like a misconfiguration until you read
the banner. Ceph's dashboard does not discover Prometheus; it needs
`mgr/dashboard/PROMETHEUS_API_HOST` set, and without it every graph fails with
*Invalid URL '/api/v1/query': No schema supplied* — a URL built from an empty
host. `ALERTMANAGER_API_HOST` is separate, because the alerts panel reads
Alertmanager directly rather than through Prometheus.

**Setting it through `cephConfig` did not work, and failed in the most
misleading way available.** Rook owns `mgr/dashboard/PROMETHEUS_API_HOST`: every
dashboard reconcile deletes it from `mgr.a` and `mgr.b` along with
`PROMETHEUS_API_SSL_VERIFY`, `ssl`, `server_port`, `ssl_server_port` and
`url_prefix`, rewrites them from `cephClusterSpec.dashboard`, and restarts the
dashboard module. Rook applies `cephConfig` first and reconciles the dashboard
second, so the operator log reads `successfully set option` about seven seconds
before the deletion that undoes it, and `ceph config dump` afterwards shows the
key present with an empty value — which greps like success. The fix is the field
Rook actually reads, `dashboard.prometheusEndpoint`. `ALERTMANAGER_API_HOST` is
untouched by any of this: Rook's binary contains one occurrence of
`PROMETHEUS_API_HOST` and no Alertmanager string at all.

`ceph config log` is what settled it — it records who changed what and when,
which is the only view in which a value that is set and then immediately
reverted looks different from a value that was never set:

```
--- 28 --- 02:01:01 ---  + mgr/mgr/dashboard/PROMETHEUS_API_HOST = http://…:9090
--- 29 --- 02:01:08 ---  - mgr/mgr/dashboard/PROMETHEUS_API_HOST = http://…:9090
                         + mgr/mgr/dashboard/PROMETHEUS_API_HOST =
```

The Hosts and Physical Disks pages failed differently, with *503 Orchestrator is
unavailable*, and that one also cost log volume: the mgr `prometheus` module
retried `Failed to collect cephadm daemon status` **every 15 seconds**. Two
settings fix it and neither implies the other — `mgr.modules` enabling the `rook`
module makes the backend available, `mgr/orchestrator/orchestrator` selects it.
Rook enables modules from the spec but never selects a backend; its binary
carries no `orch set backend`. All of it is in the HelmRelease.

## Upstream telemetry, and the half of it git cannot hold

Enabled 2026-08-21. The cluster reports to `https://telemetry.ceph.com/report`
every 24 h under CDLA-Sharing-1.0. Counts and versions only — daemon counts,
per-`pool_id` sizing and usage, CRUSH shape, capacity, CPU model, kernel, Ceph /
Rook / k8s versions, and a random `report_id` that is **not** the cluster `fsid`.
No hostnames, no addresses, no pool names, no object data; `ceph telemetry
preview` prints the whole payload and needs no opt-in to run. The `ident` channel
— `contact`, `organization`, `description` — and `perf` are both pinned off.

The point of writing it up is that **the opt-in is split across two mon stores,
and the HelmRelease can only reach one of them**:

| What | Store | Reachable from the chart |
|---|---|---|
| `enabled`, the five `channel_*` flags | config (`ceph config`) | yes — `cephConfig.mgr` |
| collection opt-in, licence acknowledgement | config-**key** (`ceph config-key`, via the module's `set_store()`) | no |

Rook renders `cephConfig` to `ceph config set`, which cannot write config-key.
Setting `mgr/telemetry/enabled: "true"` alone therefore lands in a state that
looks enabled and is not useful: `mgr/telemetry/collection` stays `[]`, so
`compile_report` skips almost every section, and `should_nag()` finds the two
collections flagged `nag` — `perf_perf` and `basic_rook_v01` — missing and raises
`TELEMETRY_CHANGED`. That is a **permanent `HEALTH_WARN`**, and this cluster's
`CephHealthWarning` picks it up an hour later. The same shape as the `.mgr` pool
trap above: a default that quietly parks the cluster at WARN and masks real
warnings.

One command closes it, and it is the licence acknowledgement — the module refuses
without the flag by design:

```bash
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- \
  ceph telemetry on --license sharing-1-0
```

It writes the same `mgr/telemetry/enabled` the chart declares, so it does not
fight Flux. **It must be re-run after a cluster rebuild** — config-key state does
not survive one, and `cephConfig` will happily re-enable telemetry without it.

## Still open

- **No backup target**, exactly like Longhorn. `ceph-block` is for regenerable
  data until that changes.
- **The two-node failure domain.** `size: 2`, `min_size: 1` on
  `failureDomain: osd` survives any one disk with no data loss, and does not
  survive losing a node. It also means every *planned* node reboot takes part of
  the pool offline. Giving node-3 a disk lifts this to `size: 3` on a `host`
  domain and removes the trade entirely — the single highest-value hardware
  change available to this cluster.
- **The 250 GB disk.** Still attached to node-2, excluded by the device filter,
  unused. Physically removing it is the safest end state: a filter is a weaker
  guarantee than an absent disk.

## Related documentation

- [../scripts/hdd-burn-in/README.md](../scripts/hdd-burn-in/README.md) — the rig
- [15-node-1-hdd-expansion.md](15-node-1-hdd-expansion.md) — how these disks were
  provisioned for Longhorn, and the hardware inventory
- [../infrastructure/controllers/base/rook-ceph/README.md](../infrastructure/controllers/base/rook-ceph/README.md) — the Ceph component itself
- [../infrastructure/controllers/base/longhorn/README.md](../infrastructure/controllers/base/longhorn/README.md)
- [../monitoring/configs/README.md](../monitoring/configs/README.md) — why every
  ServiceMonitor and rule needs the `release: kube-prometheus-stack` label
- [05-alerting.md](05-alerting.md) — how alerts reach Telegram
- [14-design-decisions.md](14-design-decisions.md) — section 1, "Platform"
