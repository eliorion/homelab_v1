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

## Status: live

The operator and the `CephCluster` are both running. Four OSDs on four USB hard
disks across two nodes, one pool, one StorageClass (`ceph-block`, not the
default). The disks were qualified first — flush honesty, no SMR, 72 h of
saturated concurrent random I/O with zero bus events —
[`documentations/16`](../../../../documentations/16-usb-disk-qualification.md).

**`suspend: true` is no longer a safety catch.** Before bring-up it meant "these
are still ordinary disks". Now the disks belong to Ceph and hold data, so
suspending the HelmRelease only stops Flux reconciling it; it does not hand the
disks back and it does not protect anything. What destroys data now is deleting
the `CephCluster`, or wiping a device out from under an OSD.

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

## Why `size: 2` on `failureDomain: osd`, and what it costs

**Disk redundancy, deliberately not node redundancy.** Two copies land on two
different OSDs, which may sit on the same node. Any single disk can die without
losing data. Losing a *node* can lose data, and that was chosen with the
numbers below in hand.

Three settings encode it and none can be left to a default:

- `size: 2` — two copies.
- `requireSafeReplicaSize: false` — Rook considers anything below 3 unsafe and
  refuses the pool without it. Setting it is an acknowledgement, not a tweak.
- `min_size: "1"` — a PG with one surviving copy keeps serving. Note what this
  does *not* buy here: with `failureDomain: osd` a PG can have both copies on one
  node, so a node going away drops those PGs to zero copies and their I/O blocks
  regardless of `min_size`.

### Why not `failureDomain: host`

Because of how lopsided the disks are. node-1 holds 1.5 TB, node-2 holds 2.3 TB.
Under `host` every object needs one copy on each node, so the smaller node is the
ceiling: ~1,500 GB usable and **~800 GB on node-2 unreachable forever**. Under
`osd` the constraint is only that no disk holds two copies of one object, which
puts one copy of everything on the 2 TB disk and the second copies across the
other three (1,000 + 500 + 320 = 1,820 GB).

| | `host` | `osd` |
|---|---:|---:|
| Theoretical max | 1,500 GB | 1,820 GB |
| Practical, 85 % nearfull | ~1,275 GB | ~1,550 GB |
| Stranded | ~800 GB | none |

The larger gain is recovery. A dead disk rebuilds onto any surviving OSD instead
of only onto its own node's other disk, so the pool self-heals from a much larger
working set:

| Disk that dies | Self-heals if the pool holds under |
|---|---|
| 2 TB (worst case) | **910 GB** |
| 1 TB | 1,410 GB |
| 500 GB | 1,660 GB |
| 320 GB | 1,750 GB |

Under `host` the worst case is ~300 GB. Above whichever threshold applies, a disk
failure leaves the pool running on single copies until someone replaces hardware
— no data lost, but no redundancy either, and that is the window where a second
failure does lose data.

### The cost that is easy to under-price

`failureDomain: osd` does not only mean "a node dying may lose data". It means
**every planned node reboot takes part of the pool offline** — Talos upgrades,
kernel updates, the `apply-config` reboots this repo does routinely. PGs with both
copies on the rebooting node have zero reachable copies and their I/O hangs until
it comes back. Under `host` that never happens.

That trade is acceptable for a bulk tier of regenerable data, which is what
`ceph-block` is here, and it is not acceptable for anything whose hang would be
noticed. There is no backup target for Ceph in this cluster.

Giving node-3 a disk is what would allow `size: 3` on a `host` domain and remove
the whole trade. It remains the single highest-value hardware change available.

## Why `deviceClass: hdd` is forced

The 2 TB disk reports `rotational=0` through its bridge and is a 7200 rpm hard
disk — its measured latency is one platter revolution per durable write. Left to
autodetect, `ceph-volume` would class it `ssd`, and CRUSH would then see two
device classes across four disks and place data unevenly. Both the cluster
storage config and the pool pin `hdd`.

## The dashboard, on the tailnet

**`https://ceph.<your-tailnet>.ts.net`** — real HTTPS on 443, with a certificate
issued to the tailnet device. Authenticated by tailnet identity, reachable
off-LAN, never internet-exposed.

Username `admin`; Rook generates the password and keeps it in a Secret:

```bash
kubectl -n rook-ceph get secret rook-ceph-dashboard-password \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

Two objects in `staging/rook-ceph-cluster/`, and the split matters:

- `dashboard-service.yaml` — a plain `ClusterIP` on port 7000. It is **separate
  from Rook's own `rook-ceph-mgr-dashboard`** because Rook owns and reconciles
  that one, so anything added to it is drift waiting to be reverted. Ours carries
  the identical selector, `mgr_role: active` included — that label is what makes
  the dashboard follow a failover to the standby mgr instead of pointing at a
  dead one.
- `ingress-tailscale.yaml` — `ingressClassName: tailscale`, which terminates TLS
  and serves 443. The same pattern pgAdmin, Keycloak, n8n and the AI gateway
  already use.

**The Service must carry no `tailscale.com/*` annotations.** Ingress and the
Service-annotation method are two different mechanisms; running both registers
two devices contending for one hostname, and the loser is silently renamed
`ceph-1`. This started on the annotation method and was converted, so if a stale
`ceph` device lingers in the tailnet admin console, that is where it came from.

**Precondition:** HTTPS Certificates must be enabled in the Tailscale admin
console (DNS → HTTPS Certificates), or the proxy comes up with no certificate.

The backend is plain HTTP on 7000 because the CephCluster sets
`dashboard.ssl: false`; the proxy adds the TLS. Turning Ceph's own SSL on moves
the backend to 8443 and the Ingress port must move with it.

## Upstream telemetry

This cluster reports to the Ceph project: **`https://telemetry.ceph.com/report`**,
every 24 h, under the [CDLA-Sharing-1.0][cdla] licence. It is opt-in and it is on
deliberately — a Rook-on-Talos cluster with `failureDomain: osd` and USB-attached
OSDs is exactly the shape upstream has no data for.

[cdla]: https://cdla.dev/sharing-1-0/

### What leaves the cluster, and what does not

The payload was read before it was enabled (`ceph telemetry preview`, which needs
no opt-in). It is counts and versions:

- daemon counts, `pg_num`/`size`/`min_size`/usage **per pool id**, CRUSH shape,
  RBD feature bits, cluster capacity
- CPU model, kernel version, distro, Ceph version, Rook version, k8s version
- a `report_id` UUID — random and stored in the mon config-key store, **not** the
  cluster `fsid`

No hostnames, no IP addresses, no pool *names*, no image names, no object data.
The `ident` channel — the one that carries `contact`, `organization` and
`description` — is pinned **off**; so is `perf`. Turning `ident` on is what would
attach a real identity to the report.

Read it yourself at any time:

```bash
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph telemetry preview | less
```

### Why it takes a manual command as well as the chart values

The opt-in is stored in **two different places**, and only one of them is
reachable from the HelmRelease:

| What | Stored in | In git? |
|---|---|---|
| `enabled`, the five `channel_*` flags | mon **config** store (`ceph config`) | yes — `cephConfig.mgr` in `staging/rook-ceph-cluster/release.yaml` |
| the collection opt-in, the licence acknowledgement | mon **config-key** store (`ceph config-key`, written by `set_store()`) | no |

Rook's `cephConfig` renders to `ceph config set`, which cannot write the
config-key store. So flipping `mgr/telemetry/enabled` on its own gets you the
worst of both: the module reports, but `mgr/telemetry/collection` is still `[]`,
so the report is nearly empty **and** `should_nag()` fires
`TELEMETRY_CHANGED` — a permanent `HEALTH_WARN` that our `CephHealthWarning`
alert picks up an hour later.

One command closes the gap, and it is the licence acknowledgement — `ceph
telemetry on` refuses without the `--license` flag by design:

```bash
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- \
  ceph telemetry on --license sharing-1-0
```

It writes the same `mgr/telemetry/enabled` the chart declares, so it does not
drift from git; everything else it touches is config-key state git cannot own.
**Re-run it after a cluster rebuild** — the config-key store does not survive one.

Verify:

```bash
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph telemetry status
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph config-key get mgr/telemetry/collection
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph health detail
```

`status` must show `enabled: true` and, after the first interval, a non-null
`last_upload`. `collection` must be a populated list, not `[]` — and it will
contain `ident_base` and `perf_perf` even though both channels are off. That is
not a leak: collections are opted in wholesale, channels decide what is actually
gathered, and `ceph telemetry show` is the file of record for what left.
Health must be `HEALTH_OK` — a lingering `TELEMETRY_CHANGED` means the command did not run.

### Turning it off

Set `mgr/telemetry/enabled: "false"` in `release.yaml` and commit. That is
sufficient — `ceph telemetry off` does nothing else that matters.

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
- **The chart's own `monitoring.enabled` stays `false`, and that is not the same
  as unmonitored.** Ceph already exposes metrics (the mgr `prometheus` module and
  `rook-ceph-exporter` are on by default); what the chart's flag adds is its own
  ServiceMonitor and PrometheusRules, which would arrive without the
  `release: kube-prometheus-stack` label this cluster's Prometheus selects on,
  and so would be silently ignored. The scrape configs and alerts are
  hand-written under `monitoring/configs/staging/ceph-monitoring/` instead, the
  same as Longhorn's.
- **The dashboard reaches you over HTTPS, but Ceph itself serves plain HTTP.**
  The tailscale proxy terminates TLS; the mgr behind it has `ssl: false`. Nothing
  outside the tailnet can reach either end.
- **A Ceph upgrade can page you through telemetry.** When a release adds a
  collection marked `nag`, `TELEMETRY_CHANGED` raises `HEALTH_WARN` and
  `CephHealthWarning` fires an hour later. That warning is a consent prompt, not
  a fault: read the new collections with `ceph telemetry diff`, then re-opt-in
  with `ceph telemetry on --license sharing-1-0`. Nothing in git changes.

## Bringing it up

```bash
# 1. burn-in is DONE and clean (documentations/16) — this is a re-check, not a gate
kubectl -n hdd-burnin get jobs
grep -E "NEW KERNEL EVENT|STALE MOUNT" scripts/hdd-burn-in/results/watch.log

# 2. tear the rig down — REQUIRED, ceph-volume cannot claim a disk a pod holds open
kubectl delete ns hdd-burnin

# 3. flip suspend: false in staging/rook-ceph-cluster/release.yaml, commit, then
flux reconcile kustomization infrastructure-controllers --with-source

# 4. watch OSDs appear — expect 4
kubectl -n rook-ceph get pods -l app=rook-ceph-osd
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph status
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph osd tree
```


`ceph osd tree` must show two hosts, two OSDs each, all `hdd` class. A third host
or a stray `ssd` class means the device filter or the device class is wrong.

Then confirm the failure domain actually took, because getting it wrong is silent
rather than loud:

```bash
kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- \
  ceph osd crush rule dump ceph-blockpool | grep -A2 chooseleaf
```

It must choose `osd`. If it says `host`, the pool quietly caps at node-1's
capacity and strands ~800 GB on node-2 — no error, just less space than expected.
