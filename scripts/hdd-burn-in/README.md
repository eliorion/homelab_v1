# USB disk burn-in rig

Qualifies — or disqualifies — the USB-attached disks on `staging-controlplane-1`
and `staging-controlplane-2` as Ceph OSDs. Three questions, in the order where a
"no" costs least to discover:

1. **Does the USB bridge honour cache flushes?** If it acknowledges a flush it
   never performed, BlueStore treats a commit as durable while it sits in an
   enclosure cache that a power cut empties. Nothing fixes this — not a kernel
   arg, not a Ceph setting. Five minutes per disk to find out.
2. **Is the disk SMR?** A shingled drive collapses once its CMR cache fills,
   turning an OSD backfill into a multi-day event that provokes the next failure.
3. **Does the bridge stay up under sustained load?** A reset re-enumerates the
   device under a new letter, and this repo has measured what that costs — see
   "The stale-mount failure mode".

Results and verdicts:
[`documentations/16-usb-disk-qualification.md`](../../documentations/16-usb-disk-qualification.md).

## Run status: complete, teardown pending

The qualification run finished 2026-08-20. Four disks passed, one was
disqualified, and the verdicts are in
[`documentations/16`](../../documentations/16-usb-disk-qualification.md).

**The `hdd-burnin` namespace is still up**, holding four `Complete` Jobs. It has
to go before Ceph can start — `ceph-volume` cannot claim a disk another pod holds
open. So on this cluster, right now, it is pending teardown rather than leftover.

## This is deliberately not Flux-managed

Nothing here sits under a path any Flux Kustomization reconciles
(`clusters/staging/*.yaml` covers `apps/`, `infrastructure/`, `monitoring/` and
`clusters/staging/flux-system` only). It is applied by hand and deleted when the
run is over — the same considered exception
[`scripts/azuracast-load-test/README.md`](../azuracast-load-test/README.md)
argues: a measurement harness is not desired cluster state, and putting it in
git-as-truth would leave a disk burner permanently in the cluster. If you find
the `hdd-burnin` namespace on a cluster and nobody is running a test, it is
leftover — delete it.

## Every phase destroys the disk it touches

`run.sh` writes to the **raw block device** from LBA 0. That is deliberate: Ceph
consumes whole devices, so there is nothing to preserve and no filesystem to
measure through. It is also why `run.sh` refuses to start unless
`talosctl get disks` reports the device's transport as `usb` — the guard exists
because `sdl` on one node is a 1 TB USB disk and on another node is something you
do not want zeroed.

Results are written to the node's own `/var/log/hdd-burnin` (an `EPHEMERAL`
path), never to the disk under test, so log writes cannot perturb the
measurement. `run.sh pull` fetches them with `talosctl read`.

## The subjects

Two of the three enclosures are the same ASMedia dock; the third is a different
animal, and the difference is the whole point.

| Node | Dev | Size | Enclosure | Driver | Link | `rotational` |
|---|---|---|---|---|---|---|
| 1 | `sdl` | 1.0 TB | ASMedia `174c:55aa`, LUN 0 | `uas` | 5 Gb/s | 1 |
| 1 | `sdm` | 500 GB | ASMedia `174c:55aa`, LUN 1 | `uas` | 5 Gb/s | 1 |
| 2 | `sdk` | 2.0 TB | ASMedia `174c:55aa`, LUN 0 | `uas` | 5 Gb/s | **0 — false** |
| 2 | `sdl` | 320 GB | ASMedia `174c:55aa`, LUN 1 | `uas` | 5 Gb/s | 1 |
| 2 | `sdm` | 250 GB | "Storage Device", no WWID | `usb-storage` | **480 Mb/s** | 1 |

Both ASMedia docks report the *same* fabricated WWID `naa.5000000000000001` for
both of their LUNs, so WWID is useless as a disk selector anywhere in this
cluster. Talos selectors discriminate on `disk.size`; doc 15 records why.

`sdk` reports `rotational=0` while being a hard disk. Its measured latency
signature is one platter revolution per durable write, which is the proof. Ceph
reads that flag to pick BlueStore defaults, so it would tune a 7200 rpm spindle
as flash.

### Device letters are not stable

A USB bridge that re-enumerates gets new letters — node-1's disks were `sdb`/`sdc`
before a replug and are `sdl`/`sdm` after. Re-check with `talosctl get disks`
before every destructive run. If a Job sits in `ContainerCreating`, the
`BlockDevice` hostPath is pointing at a letter that no longer exists, which is
itself a finding.

### The stale-mount failure mode

On 2026-08-17 node-1's dock was moved to a USB 3 port. The kernel re-enumerated
it and renamed the disks; `/proc/mounts` kept pointing at the old `/dev/sdb1` and
`/dev/sdc1`. Every I/O to `/var/mnt/hdd-usb-*` then returned EIO, Longhorn marked
both disks `Ready=False Schedulable=False`, and a pod requesting that hostPath
never started:

```
MountVolume.SetUp failed for volume "target" :
  hostPath type check failed: /var/mnt/hdd-usb-1000 is not a directory
```

Not a degraded volume — an unschedulable one. Talos has no unmount API and
`MountController` will not re-mount over a stale mount, so the state persists
until someone intervenes. Removing the `UserVolumeConfig` and running
`talosctl apply-config` clears it **without a reboot**; that is the cheap
recovery, verified on v1.13.4.

That was a deliberate cable pull against empty disks. A bridge reset under load
reaches the identical state with live data on the disk. Hence phase 3, and hence
`watch-dmesg.sh` comparing every mounted device against `talosctl get disks` on
each pass.

## Files

| File | What it is |
|---|---|
| `namespace.yaml` | The `hdd-burnin` namespace. `enforce: privileged` is required, not a preference: the pod is privileged and mounts a host block device, both forbidden at the cluster default (`baseline`). `apps/staging/lab/namespace.yaml` documents that default. |
| `fio-job.yaml` | `envsubst` template for one `Job`. `alpine:3.22` + `apk add --no-cache fio` at start-up, so the pod needs egress to the Alpine CDN. Pinned to a node by `nodeSelector`; the disk arrives as a `BlockDevice` hostPath at `/dev/target`; outputs go to a `DirectoryOrCreate` hostPath on `/var/log/hdd-burnin`. `privileged: true` is unavoidable — a `BlockDevice` hostPath mounts the device node, but the device cgroup still denies access without it. |
| `run.sh` | One phase, one device, one node. Guards on transport before writing. |
| `watch-dmesg.sh` | Hourly kernel + device-mapping checkpoint per node, with the reset and stale-mount alarms. Runs on the workstation. |
| `plot-bw.sh` | Collapses an fio bandwidth log into per-bucket mean MB/s. The SMR cliff is visible in that table. |
| `results/` | Pulled fio JSON, the phase-2 bandwidth logs, and `soak-summary.csv` (per-10-minute read/write means for the 72 h soak). The soak's raw 10 s samples are gitignored — 415k lines for what the summary says in 1.7k. |

## Running it

`run.sh` exports `KUBECONFIG` and `TALOSCONFIG` itself.

```bash
cd scripts/hdd-burn-in

# 1. flush honesty — 5 min per disk, and the cheapest possible "no"
./run.sh sync  1 sdl          # O_DSYNC path
./run.sh fsync 1 sdl          # fdatasync path — should agree
./run.sh pull  1 sdl

# 2. SMR / sustained sequential — one disk at a time per node; a dock's two
#    bays share one bus, so concurrent runs measure the bus
./run.sh seq   1 sdl 300G
./run.sh pull  1 sdl
./plot-bw.sh results/n1-sdl-seq_bw.1.log

# 3. the 72h soak — both bays of a dock at once, which is the point
NOFOLLOW=1 ./run.sh soak 1 sdl
NOFOLLOW=1 ./run.sh soak 1 sdm
./watch-dmesg.sh 3600 101 102 | tee -a results/watch.log

kubectl delete ns hdd-burnin   # teardown
```

## Reading the results

`sync` reports write IOPS with `O_DSYNC` set; `fsync` reports buffered writes plus
an explicit `fdatasync`, and splits the cost out as `sync.lat_ns`. **On a
rotational disk** one durable write cannot cost less than one revolution — 8.3 ms
at 7200 rpm, 11.1 ms at 5400:

| fsync latency | Verdict |
|---|---|
| 8–35 ms | Honest. The flush reaches the platter. |
| 1–8 ms | Suspicious. Compare against the other LUN of the same enclosure. |
| < 1 ms | **Disqualifying.** The bridge acknowledges flushes it never performed. |

The two paths must agree. If `O_DSYNC` is slow and `fdatasync` is instant, or the
reverse, the enclosure is honouring one primitive and dropping the other — treat
it as a lie.

**The threshold does not transfer to an SSD**, where thousands of honest sync IOPS
are normal. Where an enclosure holds both an SSD and a HDD, measure the HDD: the
bridge is what handles `SYNCHRONIZE CACHE`, so the spinning disk's verdict covers
everything behind the same bridge.

`seq` + `plot-bw.sh`: a sustained fall from ~110 MB/s to 10–30 MB/s partway
through is the CMR cache exhausting — **SMR, disqualifying**. A flat line near
35 MB/s is not a disk result at all; the link has dropped to USB 2.0, so check
`/sys/bus/usb/devices/<dev>/speed` before believing anything.

`soak`: **any single occurrence** of a bus reset, a re-enumeration, a UAS command
timeout, an I/O error, a failed `Synchronize Cache`, or an fio I/O error is
disqualifying. `watch-dmesg.sh` prints them as they appear.

If resets appear on an ASMedia dock, the one remedy worth trying is dropping UAS
for that bridge and re-running phase 3: `usb-storage.quirks=174c:55aa:u` in
`extraKernelArgs` under the relevant `nodes[]` entry of
`bootstraping/talconfig.yaml` (per-node — the same blast-radius rule as the user
volumes), then re-render and `talosctl apply-config`. Confirm the rebind in
`dmesg`: `scsi hostN: usb-storage` replaces `scsi hostN: uas`.

## Resuming after the session that started the run ends

The soak does not depend on whoever launched it. The fio Jobs are Kubernetes
objects, they write their results to `/var/log/hdd-burnin` on each node, and the
verdict — did the bridge reset — lives in the node's kernel ring buffer. Only
`watch-dmesg.sh` dies with its shell, and its hourly snapshots are a convenience:
the ring buffer holds the same events. Measured 2026-08-19, three days after
boot: ~280 KB and ~3 000 lines per node, still including the boot messages, so
there is ample headroom before it wraps.

To pick the run back up:

```bash
export KUBECONFIG=/workspaces/homelabv1/bootstraping/kubeconfig
export TALOSCONFIG=/workspaces/homelabv1/bootstraping/clusterconfig/talosconfig

# 1. are the jobs still going, or did they finish?
kubectl -n hdd-burnin get jobs

# 2. the verdict — SINCE is the soak start, not now
for ip in 101 102; do
  talosctl -n 192.168.1.$ip dmesg | grep -E "2026-08-1[789]|2026-08-20" \
    | grep -iE "uas_eh_|reset (Super|high)Speed USB device|I/O error, dev sd|command timeout|Synchronize Cache.*failed"
done

# 3. restart the hourly watcher if the run is still going
# SINCE is this run's start time, not now
SINCE=2026-08-17T20:35 nohup ./watch-dmesg.sh 3600 101 102 > results/watch.log 2>&1 &

# 4. once complete, collect
for spec in 1:sdl 1:sdm 2:sdk 2:sdl; do ./run.sh pull "${spec%%:*}" "${spec##*:}"; done
```

Known counts to compare against, all from the phase 2 partition-table storm and
none from the soak: node-1 **8** resets, **8** UAS aborts, **5** I/O errors;
node-2 **0/0/0**. Anything above those numbers is a soak failure.

Two things genuinely lose the run, session or no session: a **node reboot**,
which kills the Jobs (`backoffLimit: 0`) and clears the ring buffer; and a pod
killed mid-run, because fio buffers its bandwidth and latency logs in memory and
writes them only on completion. Neither costs the reset verdict, which is in
`dmesg` either way.
