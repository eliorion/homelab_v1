# bootstraping

The Talos layer. Flux does not reconcile any of it: nothing here is applied by a controller,
it is pushed to the nodes by hand with `talosctl`, and only when the machine configuration
itself changes.

One file is the source of truth — **`talconfig.yaml`**, a [talhelper](https://github.com/budimanjojo/talhelper)
config that renders the three machine configs for `staging-controlplane-1/2/3`. Cluster
`Homelab_staging`, Talos `v1.13.4`, Kubernetes `v1.36.1`, API endpoint
`https://192.168.1.100:6443` (the VIP).

> This directory was originally driven by raw `talosctl gen config`, and this README used to
> document that flow. It does not apply anymore: `controlplane.yaml` is no longer hand
> written or hand copied per node. Everything is rendered from `talconfig.yaml`.

The end-to-end runbook — hardware, factory image, the two Secrets Flux does not create, the
manual `cilium install`, `flux bootstrap` — is
[../documentations/00-bootstrap-cluster.md](../documentations/00-bootstrap-cluster.md).
This README covers the input file and the render/validate/apply loop around it.

## What is in this directory

| Path | What it is |
|---|---|
| `talconfig.yaml` | **Committed. The only thing to edit.** talhelper input: cluster-wide settings, a `nodes[]` entry per machine, and two raw `patches`. |
| `talsecret.sops.yaml` | **Committed, SOPS-encrypted.** The cluster PKI (etcd CA, machine CA, Kubernetes CA). Read by talhelper at render time. Never regenerate it. |
| `clusterconfig/` | **Generated, gitignored.** `Homelab_staging-staging-controlplane-{1,2,3}.yaml` plus a `talosconfig`. Overwritten on every render — never hand edit. |
| `talosconfig`, `kubeconfig` | Gitignored credentials for `talosctl` / `kubectl` against this cluster. |
| `controlplane-1/2/3.yaml`, `worker.yaml` | Gitignored leftovers from before talhelper was adopted (June 2026). Not inputs, not outputs — talhelper writes the `Homelab_staging-`-prefixed files under `clusterconfig/` instead. Stale; the `worker.yaml` still names the retired Proxmox VM endpoint. |
| `.envrc` | Local direnv helper, gitignored. Exports `TALOSCONFIG`/`KUBECONFIG` for the shell; talhelper does not read it (its `--env-file` default is `talenv*.yaml`, which this repo does not use). |

## Rendering, validating, applying

```bash
cd bootstraping
SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
```

Without `SOPS_AGE_KEY_FILE` the render fails: `talsecret.sops.yaml` cannot be decrypted.
`--offline-mode` skips the POST to the image factory (it derives the schematic ID locally)
and is what the migration runbooks use. `--dry-run` prints a diff instead of writing —
useful before a change, but the diff carries the same key material the rendered files do,
so do not paste it anywhere.

Validate before applying:

```bash
talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-1.yaml --mode metal
```

Apply per node. `--insecure` is only for a node still in maintenance mode with no PKI of
its own; a node already in the cluster is applied over the authenticated Talos API:

```bash
talosctl apply-config --insecure -n 192.168.1.101 \
  --file clusterconfig/Homelab_staging-staging-controlplane-1.yaml
```

`talosctl` must address nodes by their real IPs. The Talos API is deliberately not behind
the VIP — the VIP is an etcd lease, and `talosctl` has to keep working when etcd is the
broken thing.

## What `talconfig.yaml` declares

### Cluster-wide

| Field | Value | Note |
|---|---|---|
| `clusterName` | `Homelab_staging` | Also the filename prefix under `clusterconfig/`. |
| `talosVersion` | `v1.13.4` | Appended as the tag to each node's `talosImageURL` at render time. |
| `kubernetesVersion` | `v1.36.1` | Drives the `registry.k8s.io/kube-*` image tags. |
| `endpoint` | `https://192.168.1.100:6443` | The Kubernetes API through the VIP. |
| `allowSchedulingOnControlPlanes` | `true` | All three nodes run workloads; there is no worker. |
| `additionalMachineCertSans` / `additionalApiServerCertSans` | `192.168.1.100` | Without the VIP in both SAN lists, TLS to the VIP fails hostname verification. |
| `clusterPodNets` / `clusterSvcNets` | `10.244.0.0/16` / `10.96.0.0/12` | Cilium reuses the per-node podCIDR Talos allocates out of this range (`ipam.mode: kubernetes`). |
| `cniConfig.name` | `none` | Talos installs no CNI at all. |

### Per node

| Field | node-1 | node-2 | node-3 |
|---|---|---|---|
| `hostname` | `staging-controlplane-1` | `staging-controlplane-2` | `staging-controlplane-3` |
| `ipAddress` | `192.168.1.101` | `192.168.1.102` | `192.168.1.103` |
| `installDisk` | `/dev/nvme0n1` | `/dev/sda` | `/dev/sda` |
| `talosImageURL` schematic | `65cf8364…` (AMD box, amd-ucode) | `36cd6536…` (Intel, intel-ucode) | `36cd6536…` |
| `patches` | one `UserVolumeConfig` + Longhorn disk annotation | — | `RawVolumeConfig` + `EPHEMERAL` sizing |

node-1 carries per-node `patches` for its 640 GB SATA HDD: an `xfs` user volume at
`/var/mnt/hdd-sata-640`, registered with Longhorn. The selector matches
`disk.transport == 'sata' && disk.rotational && !system_disk`, which is exactly why the block
must stay per-node — evaluated on node-2 or node-3 it would match their install disk.
Runbook and rationale:
[../documentations/15-node-1-hdd-expansion.md](../documentations/15-node-1-hdd-expansion.md).

The USB disks on node-1 and node-2 deliberately have **no** `UserVolumeConfig`. They are raw
block devices held for a Rook/Ceph trial, and giving them a filesystem here takes them away
from Ceph:
[../documentations/16-usb-disk-qualification.md](../documentations/16-usb-disk-qualification.md).

#### node-3's `fastpool` raw volume

node-3 has no second disk, so it is the only node in the cluster with no Ceph OSD — which is
what pins the Ceph pool to `failureDomain: osd` and makes every planned reboot take part of
the pool offline
([../infrastructure/controllers/base/rook-ceph/README.md](../infrastructure/controllers/base/rook-ceph/README.md)).
A `RawVolumeConfig` carves 250 GB of unformatted space out of the install disk instead, which
gives node-3 an OSD without new hardware. It is deliberately **SSD class**: the four existing
OSDs are USB spindles measured at 67–119 durable IOPS, which is a bulk tier and not somewhere
a Postgres commit can live.

Unlike `UserVolumeConfig`, a raw volume is never formatted or mounted. Talos provisions the
partition, labels it `r-<name>`, and publishes a stable symlink at
`/dev/disk/by-partlabel/r-fastpool`. Rook takes that path in its `devices` list.

**The volume is named `fastpool`, not anything containing `ceph`, and that is load-bearing.**
`ceph-volume` reads a partition label holding the substring `ceph` as a legacy ceph-disk
device and skips it with `skipping device 'sdaN': ['Used by ceph-disk']`. This was
siderolabs/talos#11778, closed as a documentation fix rather than a code change, so the
constraint is permanent.

Raw volumes are provisioned **before** `EPHEMERAL`, which is what lets the two coexist on one
disk. `EPHEMERAL` is capped at 740 GB rather than left to fill the disk (it is `/dev/sda6` at
998 GB today) because it carries both `/var/lib/longhorn` and the container image store. The
cap has to clear the sum of the two, not just Longhorn — see the traps below.

The 250 GB is sized by what node-3 can spare today, not by what the SSD pool eventually wants.
Longhorn holds 478 GB scheduled here; as workloads move to Ceph that shrinks and the partition
can be re-cut larger, at the cost of another EPHEMERAL wipe.

#### node-1 has no `fastpool`, and cannot get one without a rebuild

**Talos applies `EPHEMERAL` sizing only when that volume is first provisioned, never
retroactively, and XFS cannot be shrunk.** node-1 was installed with `EPHEMERAL` filling the
disk — `/dev/nvme0n1p4`, 498 GB of a 500 GB NVMe — so there is no unallocated space for a raw
partition. A `RawVolumeConfig` added afterwards does not fail loudly: the volume sits `failed`
with

```
no disks matched for volume (1 matched selector): 1 have not enough space
```

and the `block.VolumeManagerController` retries it every 30 s indefinitely. The blocks were
removed from this node on 2026-08-22 so the config converges; the volume then goes
`failed -> closed`.

**A reboot does not help, and neither does re-applying the config.** There is no persisted
reset marker in META (`talosctl get metakeys` shows only `0x09`, null — identical to node-3,
which provisioned cleanly). Only a first provisioning creates the layout.

Nor is there a second disk to point it at. Every disk on node-1 is claimed:

| Disk | Size | Owner |
|---|---:|---|
| `nvme0n1` | 500 GB | Talos system + `EPHEMERAL` |
| `sda` | 1.0 TB | Ceph OSD — Talos reports `bluestore` |
| `sdb` | 500 GB | Ceph OSD — `bluestore` |
| `sdc1` | 640 GB | `u-hdd-sata-640`, the Longhorn user volume |

`sdc` is the only one that could be freed, and it is a 5400 rpm `WDC WD6400BPVT` measured at
**20 IOPS** ([`../documentations/16`](../documentations/16-usb-disk-qualification.md)).
`fastpool` exists to give Postgres an SSD tier away from the 119-IOPS USB spindles, so putting
it there would satisfy the config and defeat its purpose. That disk belongs in the *HDD* pool.

Giving node-1 a `fastpool` therefore requires a controlled reinstall with `EPHEMERAL` capped
from the start — planned downtime, not a config change.

Everything else in `networkInterfaces` is identical across the three: `deviceSelector.physical: true`
(match the physical NIC whatever it is called), `dhcp: false` with a static `/24`,
`vip.ip: 192.168.1.100`, nameserver `192.168.1.1`, a default route via `192.168.1.1`, and a
static route for `100.64.0.0/10` via `192.168.1.200`.

Hostnames are hyphenated because Kubernetes rejects underscores in node names.

### The machine patch

| Setting | What it is for |
|---|---|
| `kubelet.defaultRuntimeSeccompProfileEnabled: true` | Pods with no seccomp profile get `RuntimeDefault` instead of unconfined. |
| `kubelet.disableManifestsDirectory: true` | Turns off the static-pod directory, so the only way to run something on a node is through the API. |
| `kubelet.extraArgs.rotate-server-certificates: true` | The kubelet requests its serving certificate from the cluster CA by CSR. Paired with the `kubelet-serving-cert-approver` manifest below. |
| `kubelet.extraMounts` → `/var/lib/longhorn` (`bind`, `rshared`, `rw`) | Longhorn's data path has to be visible inside the kubelet mount namespace with shared propagation. |
| `install.wipe: false` | Applying a config does not wipe the install disk. |
| `install.grubUseUKICmdline: true` | GRUB boots with the kernel command line carried in the UKI. |
| `features.diskQuotaSupport: true` | XFS project quotas for ephemeral storage limits. |
| `features.kubePrism.port: 7445` | Host-network local API load balancer on `localhost:7445`. Cilium's `k8sServicePort` must carry the same number (`../infrastructure/controllers/base/cilium/release.yaml`) — that is how its kube-proxy replacement reaches the API. |
| `features.hostDNS` + `forwardKubeDNSToHost: true` | Host DNS resolver, with kube-dns queries from the host forwarded into the cluster. |
| `features.kubernetesTalosAPIAccess` | Grants the `etcd-backup` namespace the `os:etcd:backup` role on the Talos API. |
| `nodeLabels` → `node.kubernetes.io/exclude-from-external-load-balancers` | Standard control-plane label; kept even though every node is also a workload node. |

### The cluster patch

| Setting | What it is for |
|---|---|
| `proxy.disabled: true` | No kube-proxy. Cilium does service load balancing in eBPF. |
| `discovery.registries.kubernetes.disabled: true`, `service: {}` | Node discovery goes through the Talos discovery service, not through the Kubernetes registry. |
| `extraManifests` → `kubelet-serving-cert-approver` | Approves the kubelet serving CSRs produced by `rotate-server-certificates`. Nothing in core Kubernetes approves them. |
| `extraManifests` → `metrics-server` | The cluster's only metrics-server. It is a Talos manifest, not a Flux HelmRelease — `kubectl top` depends on this layer. |
| `extraManifests` → gateway-api `v1.4.1` `standard-install.yaml` + experimental `tlsroutes.yaml` | The Gateway API CRDs Cilium 1.19 needs. Plain CRDs with no secret material in them, so fetching them by URL at boot is safe. TLSRoute is included only so the Cilium operator stops logging a missing CRD. |

## Why it is like this

**Why talhelper rather than three machine configs.** Per-node hardware differences are
`nodes[]` fields and everything shared lives in one block that cannot drift between nodes.
The alternative, which is how the HA expansion actually started, was three near-identical
25 KB files kept in sync by hand — the stale `controlplane-1/2/3.yaml` in this directory are
what that looked like. The cost is that the rendered output is gitignored, so what is
actually on the nodes can only be inferred from the input, and rendering needs the offline
age key.

**Why `talsecret.sops.yaml` is committed and frozen.** talhelper was retrofitted onto an
already-running cluster: the secret was extracted from the live PKI with `gensecret -f`
rather than rebuilding the cluster to fit the tool. It has to stay because disaster recovery
means rebuilding node configs from the *same* CAs. It is encrypted with the age key in
`clusters/staging/age.agekey`, which is also the only thing that can decrypt it — etcd
snapshots do not cover the Talos machine PKI, so losing that key means the cluster cannot be
rebuilt at all.

**Why the API VIP is a Talos etcd lease.** All three control planes carry `vip.ip` and elect
through etcd; the winner ARPs for `192.168.1.100`. No keepalived to install on an immutable
OS. The price: all three nodes must share one L2 segment, total quorum loss takes the VIP
with it, and the Cilium LB-IPAM pool (`192.168.1.110`–`.130`) has to stay clear of
`.100`–`.103` or two ARP speakers collide.

**Why `cniConfig.name: none` and `proxy.disabled: true`.** Cilium is a Flux HelmRelease
(`../infrastructure/controllers/base/cilium`), not a Talos inline manifest, so it stays
reviewable and Renovate-bumpable and no Hubble CA lands in git. Talos therefore installs no
datapath, and a freshly bootstrapped cluster sits `NotReady` until Cilium arrives. On a
completely cold cluster that means one manual `cilium install` before Flux can reach
anything.

**Why the two nodes have different installer schematics.** Both factory images carry
`siderolabs/iscsi-tools` and `siderolabs/util-linux-tools` for Longhorn; they differ only in
the microcode extension (amd-ucode for the AMD box, intel-ucode for the two Intel ones).
Booting a stock Talos image instead gives a cluster where Longhorn fails with
`failed to execute iscsiadm: No such file or directory`.

**Why `kubernetesTalosAPIAccess` instead of a mounted `talosconfig`.** The etcd-backup
CronJob calls the Talos API for snapshots. Through this feature it gets short-lived,
auto-rotated certificates from a `ServiceAccount` CR instead of a static admin credential in
a Secret, and the `os:etcd:backup` role grants exactly one method,
`/machine.MachineService/EtcdSnapshot`. A leaked backup credential cannot read or reboot
anything.

**Why the `100.64.0.0/10` route via `192.168.1.200` is vestigial.** `100.64.0.0/10` is the
tailnet CGNAT range, and `192.168.1.200` was the Proxmox host that ran the only tailscaled
subnet router (doc 06). Nothing depends on that path now: doc 07 Phase 4 replaced the subnet
router with the Tailscale operator's in-cluster egress proxies — the scraper dials
`tailscale-proxy-*.tailscale.svc`, and Garage is reached through the `garage-s3` HAProxy
gateway — and Phase 5 wiped that host and rebuilt it as bare-metal `192.168.1.101`. Removing
the route block from all three node configs is a Phase 4 step that was never carried out, so
it is still in `talconfig.yaml`.

## Traps

- **Never regenerate `talsecret.sops.yaml`.** It holds the etcd CA, the machine CA and the
  Kubernetes CA. A new secret is a new PKI: node certificates stop validating, `talosconfig`
  and `kubeconfig` stop authenticating, etcd members cannot re-form. There is no undo.
- **Never hand edit anything under `clusterconfig/`.** It is regenerated and overwritten on
  the next `talhelper genconfig`, and it is gitignored, so the edit is invisible in review
  and silently lost.
- **Do not re-add `admissionControl` / `auditPolicy` to the cluster patch.** talhelper emits
  both by default and the defaults already match the live cluster (`enforce: baseline`,
  `audit`/`warn: restricted`, `kube-system` exempt). Adding them here appends a second
  `kube-system` entry to the exemptions list.
- **Do not remove the `kubernetesTalosAPIAccess` block** — it looks unused from inside this
  file, and removing it kills the etcd-backup CronJob
  (`../infrastructure/services/base/etcd-backup`); its pods lose the only credential they
  have for the Talos API.
- **Do not remove the `kubelet-serving-cert-approver` manifest** while
  `rotate-server-certificates` is on, and do not remove `rotate-server-certificates` while
  metrics-server is expected to scrape over verified TLS. The two are a pair.
- **The gateway-api CRDs must stay at `v1.4.1`.** That is what Cilium 1.19 requires; the
  older v1.2 set is wrong. They also have to exist *before* the Cilium chart installs, which
  is why the Talos config is applied before Flux reconciles.
- **Do not enable Cilium's `bpf.masquerade`** while `hostDNS.forwardKubeDNSToHost` is `true`
  here. That combination breaks CoreDNS.
- **Never pair a Talos user volume with a `kubelet.extraMounts` bind on the same path.**
  That combination is mount masking, siderolabs/talos#13069 — closed as not planned, still
  unfixed, and it hits *any* `/var/mnt/<name>` volume, not only ones aimed at
  `/var/lib/longhorn`. node-1's `hdd-sata-640` volume therefore has no `extraMounts` entry;
  Talos propagates `/var/mnt` to the kubelet by itself. The `/var/lib/longhorn` bind in the
  shared machine patch predates user volumes and stays.
- **node-1's `patches` must never move into the shared cluster-wide `patches:` block.** Its
  disk selector matches on `transport`/`rotational`; nodes 2 and 3 have a single SATA SSD
  each, which is their *install* disk.
- **Removing a `UserVolumeConfig` and applying unmounts the volume without a reboot.** That is
  the recovery path when a USB disk re-enumerates and leaves a stale mount behind — verified
  on v1.13.4, 2026-08-17
  ([../documentations/16-usb-disk-qualification.md](../documentations/16-usb-disk-qualification.md)).
- **`/var/lib/longhorn` lives on the EPHEMERAL partition.** There is no separate disk for it
  in this file, so `talosctl reset --system-labels-to-wipe=EPHEMERAL` destroys that node's
  Longhorn replicas. One node is survivable; all three at once is not.
- **A raw volume name must never contain the substring `ceph`.** `ceph-volume` treats the
  `r-<name>` partition label as a legacy ceph-disk marker and refuses the device, so the OSD
  is silently never created. siderolabs/talos#11778, closed as documentation — it will not be
  fixed in Talos.
- **Shrinking `EPHEMERAL` requires wiping it; Talos will not shrink a volume in place.**
  Adding node-3's `maxSize: 630GB` to a node whose EPHEMERAL already fills the disk does
  nothing until `talosctl reset --system-labels-to-wipe=EPHEMERAL`, which on a control plane
  also drops that node out of etcd and destroys its Longhorn replicas. Never run it on two
  nodes at once.
- **node-3's `EPHEMERAL` cap must clear Longhorn's scheduled bytes *plus* the image store.**
  Measured 2026-08-21: 478 GB scheduled, 163 GB of container images, 348 GB actually used of
  997 GB. Longhorn admits against *provisioned* size, and this disk carries
  `storageReserved: 0` — the chart's 15 % default never applied to it, because that setting
  only touches disks Longhorn adds after it lands. So nothing but this cap stops Longhorn
  scheduling into space the images already hold. 740 GB leaves ~99 GB of margin once the
  re-registered disk finally does pick up the 15 % reserve.
- **`minSize` + `maxSize` on the raw volume plus the `EPHEMERAL` cap must fit the disk**,
  leaving ~2 GB for the system partitions (`STATE` 105 MB, `META` 1 MB, plus EFI/BOOT).
  250 + 740 against node-3's 997 GB. Raw volumes are provisioned first, so an over-large pair
  starves `EPHEMERAL`, not the OSD.
- **Wiping node-3's EPHEMERAL destroys three things, not one:** its etcd member, its Longhorn
  replicas, and the `rook-ceph-mon-b` store under `/var/lib/rook`. All three re-form from the
  surviving two nodes, and both quorums hold at 2 of 3 — but there is no second fault budget
  while it runs, so never overlap it with any other node work.
- **`fbref/fbref-db-3` runs `numberOfReplicas: 1` with its only replica on node-3.** Wiping
  EPHEMERAL destroys it outright. It is the CNPG *replica* (primary is `fbref-db-1` on
  node-2), so the recovery is to delete the pod and PVC and let CNPG re-bootstrap — a 214 GB
  `pg_basebackup` over the network. Check this placement again before any node wipe; it moves.
- **Apply the machine config before Flux installs Cilium.** Doing it the other way round
  deadlocked the live cluster on 2026-06-12.
- **Keep the Talos API off the VIP.** Point `talosconfig` endpoints at `192.168.1.101–103`,
  never at `.100`, or the recovery tool depends on the thing being recovered.
- **`talosImageURL` carries no tag on purpose.** talhelper appends `:${talosVersion}`. Bumping
  `talosVersion` therefore changes the installer image on all three nodes at once, and the
  schematic must still carry the Longhorn extensions.

## Verifying

```bash
cd bootstraping
SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
for n in 1 2 3; do
  talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-$n.yaml --mode metal
done
```

Against the live cluster:

```bash
talosctl -n 192.168.1.101 etcd members     # 3 members, no learners
talosctl -n 192.168.1.101,192.168.1.102,192.168.1.103 version
kubectl get nodes                          # 3 Ready
kubectl top nodes                          # proves the metrics-server extraManifest landed
```

## Related documentation

- [../documentations/00-bootstrap-cluster.md](../documentations/00-bootstrap-cluster.md) — the full bootstrap runbook
- [../documentations/06-k3s-retirement.md](../documentations/06-k3s-retirement.md) — the move off k3s
- [../documentations/07-talos-ha-expansion.md](../documentations/07-talos-ha-expansion.md) — one VM to three bare-metal control planes
- [../documentations/08-cilium-cni-ingress-migration.md](../documentations/08-cilium-cni-ingress-migration.md) — the CNI swap and the 2026-06-12 incident
- [../documentations/09-etcd-backup-dr.md](../documentations/09-etcd-backup-dr.md) — etcd snapshots and disaster recovery
- [../documentations/14-design-decisions.md](../documentations/14-design-decisions.md) — section 1, "Platform"
