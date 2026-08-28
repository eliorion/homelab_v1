# LINSTOR (Piraeus Operator)

LINSTOR is the cluster's block-storage provider: it backs the `ssd` StorageClass
that every database and every latency-sensitive workload provisions from. Volumes
are DRBD devices replicated over the network on top of an LVM-thin pool carved
from each node's install disk. It replaces Longhorn, which replicated at the
filesystem level over iSCSI.

This directory installs the operator. The cluster itself — storage pools, the
Talos loader override, the StorageClass — is hardware-specific and lives in
[`../../staging/linstor-cluster`](../../staging/linstor-cluster). Migration
narrative and runbook:
[`../../../../documentations/17-linstor-seaweedfs-migration.md`](../../../../documentations/17-linstor-seaweedfs-migration.md).

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Creates `piraeus-datastore` with `pod-security.kubernetes.io/enforce\|audit\|warn: privileged`. |
| `repository.yaml` | `HelmRepository` `piraeus` in `flux-system`, **`type: oci`**, `oci://ghcr.io/piraeusdatastore/piraeus-operator`. |
| `release.yaml` | `HelmRelease` `piraeus-operator` (chart `piraeus` `2.11.0`) into `piraeus-datastore`, with `installCRDs: true`. |
| `monitoring/` | The tier's `ServiceMonitor` and `PrometheusRule`, applied by their own Flux `Kustomization` `infra-linstor-monitoring` -- NOT by `infra-linstor`, whose `wait: true` would deadlock a cold bootstrap on a CRD the monitoring chart has not installed yet. |

Flux drives the directory from `clusters/staging/infrastructure.yaml`
(`Kustomization` `infra-linstor`, `wait: true`, 15 minute timeout, health check
on the HelmRelease). `infra-seaweedfs` depends on it, because SeaweedFS's masters
claim from the `ssd` class this provides.

The overlay adds the `LinstorCluster`, the Talos loader override and the storage
pools, the two StorageClasses, the SOPS passphrase Secret, and the tailnet
`Ingress` that publishes the controller's GUI.

The operator deploys, from the `LinstorCluster` CR: the LINSTOR controller, the
satellite DaemonSet, the CSI controller and node plugin, the **HA controller**,
and the affinity controller. The four CRDs are `LinstorCluster`,
`LinstorSatelliteConfiguration`, `LinstorNodeConnection` and the read-only
operator-generated `LinstorSatellite`.

The host side is not in this directory. `bootstraping/talconfig.yaml` carries the
factory schematic with `siderolabs/drbd` and the `machine.kernel.modules` block
that loads it.

## Why it is like this

**A privileged namespace, shipped here rather than by Helm.** Satellites load
DRBD, open raw block devices and use `Bidirectional` mount propagation, which
Kubernetes permits only to privileged containers — so `baseline`, Talos's
default, rejects them. The Piraeus *kubectl manifest* ships a namespace already
carrying the labels; the **Helm chart does not template a Namespace at all**, so
`--create-namespace` would produce a bare, baseline-enforced one. `namespace.yaml`
therefore owns the labels and `install.createNamespace: false` is load-bearing,
exactly as for `longhorn-system` and `rook-ceph`.

**`installCRDs: true`.** The chart defaults it to `false` and the four
`piraeus.io` CRDs never land, so the operator starts and does nothing.

**An OCI HelmRepository.** Piraeus publishes no classic Helm index; the charts
exist only as OCI artifacts under `ghcr.io/piraeusdatastore`.

**LVM-thin, not FILE_THIN.** `FILE_THIN` needs no repartitioning — it is a sparse
file plus `losetup` — and it was rejected anyway: roughly 2.3× slower than
LVM-thin in LINBIT's own forum benchmark, its capacity is just `df` of whatever
filesystem it sits on so it cannot be isolated from the container image store,
and **snapshot shipping to S3 is unsupported for it** (linstor-server#374), which
forfeits the single feature worth adopting LINSTOR for. The cost is that each
node's `EPHEMERAL` has to be re-provisioned smaller to free a raw partition.

**Two replicas plus an automatic diskless tiebreaker.** Chosen for capacity. It
survives one node failing — the survivor and the tiebreaker hold 2 of 3 quorum
votes, so writes continue — but it leaves a **single copy** of the data until a
replica is rebuilt, and that rebuild is manual. `placementCount: 3` is what would
keep redundancy intact through a node loss, at 1.5× the space.

## Traps

- **Do not let Helm create the namespace.** The chart templates none, so a
  Helm-created one carries no PSA labels and every satellite is rejected.
- **The DRBD extension is version-locked to the Talos patch release**
  (`ghcr.io/siderolabs/drbd:9.3.2-v1.13.4`). `talosImageURL` carries no tag and
  talhelper appends `:${talosVersion}`, so bumping `talosVersion` needs a
  schematic whose DRBD build matches. This is the same trap that used to cost
  `iscsi-tools`, except the consequence is now **every local replica going
  Diskless**, not a failed mount. Upgrade one node at a time and verify before
  touching the next:
  ```bash
  talosctl -n <ip> read /proc/modules | grep drbd
  talosctl -n <ip> read /sys/module/drbd/parameters/usermode_helper   # -> disabled
  ```
- **An extension cannot be added with `apply-config`.** It is baked into the
  image: `talosctl upgrade --image factory.talos.dev/installer/<id>:v1.13.4`,
  which reboots the node.
- **The extension alone does nothing.** Without `machine.kernel.modules` the
  modules are never loaded and no volume is ever created (piraeus-operator#692).
- **Piraeus's `drbd-module-loader` does not work on Talos** — it compiles DRBD
  from source against kernel headers Talos does not ship, and Talos has no entry
  in the loader's os-image match table, so it falls through to an Ubuntu image
  and fails. The `talos-loader-override` `LinstorSatelliteConfiguration` deletes
  it and `drbd-shutdown-guard` alongside.
- **Piraeus deletes storage pools that disappear from its config**
  (`ManagedByProperty` → `DeleteStoragePool`). Flux reconciles every minute, so a
  careless edit to a `LinstorSatelliteConfiguration` attempts to remove a live
  pool. This is a larger blast radius than Longhorn or Rook ever exposed.
- **A pool's `source` and type are immutable.** Changing either means evacuating
  every volume on it first.
- **Always set `storagePool` on a StorageClass.** DRBD is protocol C: a write
  completes only when the slowest replica confirms. One replica on a 5400 rpm USB
  spindle turns an NVMe database into an HDD one.
- **Always set `resourceGroup`.** Without it LINSTOR creates a fresh resource
  group per PVC.
- **Never set `DrbdOptions/Disk/disk-flushes: no`.** The tuning blogs assume
  battery-backed cache. This cluster runs consumer SSDs and has already
  disqualified one enclosure for *faking* flushes (`documentations/16`).
- **Auto-eviction is off by default and should stay off.** Piraeus ships
  `DrbdOptions/AutoEvictAllowEviction: "false"`. Turning it on means any node
  offline for more than `AutoEvictAfterTime` (60 min) triggers an auto-place onto
  the third node and a **full** resync, where a reboot otherwise costs only a
  bitmap-delta resync.
- **The master passphrase is not recoverable.** `linstorPassphraseSecret` is what
  LINSTOR encrypts S3 remote credentials under; losing it makes existing remotes
  unreadable. Treat it like the offline age key for the etcd backups.
- **The GUI cannot be published without the REST API.** The bundle calls `/v1` on
  the page's own origin, so the `Ingress` has to front the controller's root path;
  there is no "expose only `/ui`" variant that still works. Every write verb of the
  API is on the tailnet unauthenticated as a result, `/metrics` included.
- **Turning on controller API TLS breaks that Ingress.** With HTTPS configured the
  controller keeps 3370 only to answer `/v1` and `/ui` with a redirect to
  `https://<host>:3371`, and nothing publishes 3371 on the tailnet.

## Operating it
- **There are two classes, and only one is safe for data.** `ssd` places two
  diskful replicas plus a diskless tiebreaker. `ssd-single`
  (`placementCount: 1`) places one and has no redundancy at all: lose the node
  and the data is gone, and while that node is down the volume does not follow
  the pod, so its consumer stays down too. It exists for the Nexus proxy cache,
  which is rebuildable from upstream. Never point a database at it.
- **The pool is LVM-thin, so provisioned size is not reserved.** The sum of PVC
  requests already exceeds each node's pool. That is fine until it is not: if a
  thin pool fills, *every* volume on that node fails at once, not just the one
  that grew. Check headroom with `linstor storage-pool list` before adding a
  large volume, and treat a large non-database volume as the main risk.

```bash
kubectl kustomize infrastructure/controllers/base/linstor >/dev/null
flux reconcile kustomization infra-linstor --with-source
kubectl -n piraeus-datastore get pods
```

Everything else is the `linstor` client inside the controller:

```bash
L() { kubectl -n piraeus-datastore exec deploy/linstor-controller -- linstor "$@"; }
L node list                 # all three Online, satellites connected
L storage-pool list         # pool `ssd` on every node, free capacity
L resource list             # per-volume replica placement and state
L resource list-volumes
L error-reports list
```

The GUI is the same control surface with a mouse. `linstor-gui` is a Debian
package inside `piraeus-server`, so the controller has been serving it since the
image was pulled; its HTTP server maps the bundle at `/ui`, and a Tailscale
`Ingress` (`ingress-tailscale.yaml` in the overlay) publishes port 3370 as
`https://linstor-gui.tail45b0ca.ts.net`. **Use
`https://linstor-gui.tail45b0ca.ts.net/ui/#!/`.** Measured against v1.34.2: the
bare root answers `303` to `/ui/`, so it works too, but `/ui` without the trailing
slash is a flat `404` — the redirect exists only at `/`. In-cluster the same thing
is `http://linstor-controller.piraeus-datastore.svc.cluster.local:3370/ui/#!/`.

It shows nodes, storage pools, resources and volumes, and it creates and deletes
them — the same verbs as `L resource create`. There is no login: controller
authentication is not enabled, and the GUI is a static bundle whose requests go to
`/v1` on its own origin, so putting `/ui` on the tailnet necessarily puts the whole
REST API there under the same hostname. `curl -X DELETE
https://linstor-gui.tail45b0ca.ts.net/v1/resource-definitions/<name>` needs no
credential and destroys a volume Kubernetes still believes it has. That is the
Longhorn UI's exposure transplanted onto this tier; the tailnet is the only
authentication plane and the cost is stated in
[`../../../../documentations/14-design-decisions.md`](../../../../documentations/14-design-decisions.md).

A replica is healthy when it reads `UpToDate`. `TieBreaker` on the third node is
expected and correct — it is a diskless quorum vote, not a missing replica.

### When it breaks

- **Satellite up, no volumes provision** — the DRBD module is absent. Check
  `/proc/modules`; the node was almost certainly upgraded onto an image without
  the extension.
- **Storage pool missing on one node** — the `r-linstor` partition does not
  exist there, or still carries a Ceph/LVM signature that `pvcreate` refuses.
- **A pod stuck after its replica's node died** — the HA controller should taint
  `drbd.linbit.com/lost-quorum`, evict the pod and delete the `VolumeAttachment`
  within seconds. If it does not, the volume has no quorum policy, or fewer than
  two votes exist.
- **Restoring redundancy after a node loss** is manual while auto-eviction is
  off: place a new replica with `L resource create <node> <resource> --storage-pool ssd`,
  then watch it sync with `L resource list-volumes`.
- **The GUI loads but every panel errors** — the browser has an absolute controller
  origin pinned in `localStorage.LINSTOR_HOST`, which wins over the same-origin
  default. Clear site data for `linstor-gui.tail45b0ca.ts.net`.
