# Longhorn

Longhorn is the cluster's block-storage provider: it backs the `longhorn`
StorageClass that every stateful workload here provisions from. Volume data
lives on each node's local disk under `/var/lib/longhorn` and is replicated
three ways, one replica per node, so the death of a single node is a rebuild
rather than a loss. This directory installs the upstream chart with Flux and
adds the two things the chart cannot do on its own: a namespace with the
privileged Pod Security labels Talos demands, and a daily `filesystem-trim`
recurring job.

Deep detail lives in
[../../../../documentations/07-talos-ha-expansion.md](../../../../documentations/07-talos-ha-expansion.md)
(the 1 → 3 replica migration, growing a volume, the storage reserve, the disk
UUID gotcha) and in
[../../../../documentations/14-design-decisions.md](../../../../documentations/14-design-decisions.md)
(section 3, Storage — why each of these values was chosen and what was
rejected).

## How it is wired

| File | What it does |
| --- | --- |
| `kustomization.yaml` | Lists the four resources below. |
| `namespace.yaml` | Creates `longhorn-system` with `pod-security.kubernetes.io/enforce\|audit\|warn: privileged`. |
| `repository.yaml` | `HelmRepository` `longhorn` in `flux-system`, `https://charts.longhorn.io`, refreshed every 24h. |
| `release.yaml` | `HelmRelease` `longhorn` (chart `1.12.0`, kept current by Renovate) into `longhorn-system`: replica counts, data path, disk reserve, and the Tailscale annotations on the UI Service. |
| `recurringjob-trim.yaml` | `RecurringJob` `trim`, daily `filesystem-trim` on the `default` volume group. |

Flux drives the directory from `clusters/staging/infrastructure.yaml`
(`Kustomization` `infra-longhorn`, `path: ./infrastructure/controllers/base/longhorn`).
That Kustomization uses `wait: true` with a health check on the HelmRelease and
a **15 minute timeout**, because the first install has to pull every Longhorn
image onto a cold node.

The host side is not in this directory. `bootstraping/talconfig.yaml` gives the
kubelet a bind `extraMount` of `/var/lib/longhorn` (`bind,rshared,rw`), and the
Talos factory schematic includes the `siderolabs/iscsi-tools` and
`siderolabs/util-linux-tools` extensions that Longhorn requires.

### Overlays

There is no staging or production overlay. `infrastructure/controllers/staging/kustomization.yaml`
does not reference Longhorn at all; the Flux Kustomization points straight at
this `base/` directory, so the base *is* the deployed configuration.

## Why it is like this

**Privileged namespace.** Talos applies the baseline Pod Security profile by
default, which blocks the privileged host access Longhorn's system components
need. The namespace therefore ships from `namespace.yaml` with all three PSA
labels set to `privileged`, and the HelmRelease sets `install.createNamespace:
false` so Helm never creates a bare, baseline-enforced namespace instead.

**Three replicas, one per node.** Longhorn data lives on the ephemeral
partition of each node's install disk, which `talosctl reset` wipes. Three
replicas turn one node's death into a rebuild. One replica was what the
single-node cluster ran; two was the documented fallback if the new machines
had shipped with smaller disks. The cost is three times the provisioned space
on every volume — which is exactly what later blocked a routine database
growth — and the reminder that **replicas are resilience, not backup**: there
is no `backupTarget` configured, so three copies of a deleted file is still
zero copies.

**Disk reserve cut from 30% to 15%.** Longhorn's stock 30% reserve took 299GB
out of each 997GB disk and left only 26GB schedulable, which blocked a routine
`fbref-db` growth while real usage was about 537GB of 997GB. These are
dedicated Talos data partitions that Longhorn owns outright, so nothing else on
the host competes for the space the reserve is meant to protect, and 15% is the
standard value for that situation.

**`storageOverProvisioningPercentage` stays at its 100% default, deliberately.**
Raising it is the other way to make room and it is the wrong one: it lets
Longhorn schedule more than the disk physically holds, and a volume growing
into space that does not exist is exactly how ai-gateway and fbref both went
down (see
[../../../../documentations/12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md)).
Failing fast at scheduling time — a hard admission-webhook denial — was chosen
over failing late at write time. Freeing real reserve keeps the "never
oversubscribe" guarantee intact.

**Daily `filesystem-trim`.** WAL recycling, table bloat and deleted files free
blocks inside the filesystem that Longhorn otherwise keeps counted in
`actualSize`. Trim returns them, so reported usage tracks real usage. It runs
at 04:00, after the 03:00 CNPG backups. Per-volume recurring-job labels were
rejected in favour of the `default` group, which Longhorn applies to every
volume that carries no explicit recurring-job labels — here, all of them. The
cost is trim I/O on every volume at once, bounded only by `concurrency: 2`; the
before/after effect has never been quantified.

**UI on the tailnet.** The chart's UI Service, `longhorn-frontend`, carries
`tailscale.com/expose` and `tailscale.com/hostname` annotations, so the Longhorn
UI is published through the Tailscale operator: authenticated by tailnet
identity, reachable off-LAN, never internet-exposed. The annotations are inert
no-ops until that operator is installed, which happens in
`infrastructure/controllers/staging/tailscale-operator`. It is the same pattern
as the asp and fbref admin UIs, and it needs no extra ACL work because the
operator already owns `tag:k8s`. This matters because the Longhorn UI can delete
volumes.

## Traps

- **Do not let Helm create the namespace.** `install.createNamespace: false` is
  load-bearing: `namespace.yaml` carries the privileged PSA labels, and a
  Helm-created namespace would not.
- **`defaultDataPath: /var/lib/longhorn` must match the Talos kubelet
  `extraMounts` bind destination** in `bootstraping/talconfig.yaml`. Change one
  and you must change the other.
- **`storageReservedPercentageForDefaultDisk` only applies to disks Longhorn
  adds *after* the setting lands.** Existing node disks keep the
  `storageReserved` they were created with and must be patched on the
  `nodes.longhorn.io` CRs by hand, per node and per disk. The consequence:
  **git and the cluster can disagree about the disk reserve, and nothing
  detects it.**
- **Replica-count defaults only affect new volumes.** `defaultReplicaCount` and
  `persistence.defaultClassReplicaCount` do nothing to volumes that already
  exist; those have to be patched (`spec.numberOfReplicas`).
- **`retain: 0` on the trim job is correct** — `filesystem-trim` takes no
  snapshot, so there is nothing to retain.
- **The Tailscale expose annotation is L3** and forwards the Service port
  (`longhorn-frontend` :80). The UI is reached at
  `http://longhorn.<your-tailnet>.ts.net` — plain HTTP, not 443.
- **Nothing here configures a `backupTarget`.** Volume data has no backup of
  its own; only workloads with their own database-level backup (CNPG → R2 /
  Garage, see
  [../../../../documentations/03-backups.md](../../../../documentations/03-backups.md))
  survive a correlated failure across all three nodes.
- **Never add a `kubelet.extraMounts` bind for a Talos user volume path.** The
  `/var/lib/longhorn` bind stays, but node-1's `/var/mnt/hdd-*` user volumes
  deliberately have none: a hand-written bind stacked on a user volume mount
  point is mount masking, siderolabs/talos#13069, closed as not planned and
  still unfixed. See
  [../../../../documentations/15-node-1-hdd-expansion.md](../../../../documentations/15-node-1-hdd-expansion.md).
- **`longhorn-hdd` is one replica on one node.** Its `diskSelector: hdd` only
  matches the two USB disks on `staging-controlplane-1`, and Longhorn will not
  stack two replicas of a volume on one node — raising `numberOfReplicas` makes
  volumes unschedulable, not degraded. No backup target exists. Bulk regenerable
  data only, never a database.
- **node-1's `hdd-sata-640` is deliberately untagged**, so the default class
  uses it. Tagging it would strand 640 GB beside an NVMe with 3.1 GB
  schedulable, which is what actually happened on 2026-08-16
  ([../../../../documentations/15-node-1-hdd-expansion.md](../../../../documentations/15-node-1-hdd-expansion.md)).
  The trade is that a Postgres replica can land on a 5400 rpm drive.
- **A disk's `tags` and the StorageClass `diskSelector` are one setting in two
  files.** `bootstraping/talconfig.yaml` carries the tags (in the
  `node.longhorn.io/default-disks-config` annotation, and on the live CRs);
  `storageclass-hdd.yaml` carries the selector. Removing the selector does not
  widen the class — it makes the tagged disks unreachable.
- **Never upgrade Talos without an explicit `install.image`.** The extensions
  Longhorn needs (`iscsi-tools`, `util-linux-tools`) silently vanish and
  Longhorn dies.
- **A StatefulSet's `volumeClaimTemplates` and `storageClassName` are
  immutable.** Resizing or changing the class of such a volume means deleting
  the StatefulSet and the PVC.

## Operating it

Render check before commit, then let Flux reconcile:

```bash
kubectl kustomize infrastructure/controllers/base/longhorn >/dev/null
flux reconcile kustomization infra-longhorn --with-source
flux get helmreleases -A   # longhorn Ready, new revision
```

Check the managers and nodes are healthy:

```bash
kubectl -n longhorn-system get pods -o wide | grep longhorn-manager  # 3 pods, 3 nodes
kubectl -n longhorn-system get nodes.longhorn.io                     # 3 nodes, Ready/Schedulable
```

Check replica count and robustness of every volume:

```bash
kubectl -n longhorn-system get volumes.longhorn.io \
  -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.numberOfReplicas,ROBUSTNESS:.status.robustness
kubectl -n longhorn-system get replicas.longhorn.io \
  -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeID,STATE:.status.currentState
```

Check headroom before promising a volume size — every replica needs the space
on its own node:

```bash
kubectl -n longhorn-system get nodes.longhorn.io -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .status.diskStatus.*}max={.storageMaximum} avail={.storageAvailable} sched={.storageScheduled}{end}{"\n"}{end}'
```

Inspect or patch the per-disk reserve:

```bash
kubectl -n longhorn-system get nodes.longhorn.io -o custom-columns=\
NAME:.metadata.name,RESERVED:.spec.disks.*.storageReserved
# then per node, per disk key:
kubectl -n longhorn-system patch nodes.longhorn.io <node> --type=merge \
  -p '{"spec":{"disks":{"<disk-key>":{"storageReserved":149611031347}}}}'
```

### When it breaks

- **`admission webhook "validator.longhorn.io" denied the request: cannot
  schedule <N> more bytes to disk ...`** — the expansion exceeds schedulable
  space (`disk_max - reserved`, capped at 100% over-provisioning). Free space
  or patch the reserve; do not raise over-provisioning. Full procedure in
  [../../../../documentations/07-talos-ha-expansion.md](../../../../documentations/07-talos-ha-expansion.md)
  ("Growing a volume, and the storage reserve").
- **Volumes `detached`/`faulted` after a node reinstall**, node CR condition
  `DiskFilesystemChanged` ("record diskUUID doesn't match the one on the
  disk"), manager logs "Bringing up 0 replicas for auto-salvage" — a
  regenerated `/var/lib/longhorn/longhorn-disk.cfg` UUID, not a disk problem.
  The data is intact. Fix: rewrite the cfg with the **original** UUID from a
  privileged pod with a hostPath mount (the namespace already carries the PSA
  labels), wait about 30s for re-validation, and auto-salvage revives the
  replicas. This is triggered by every reinstall or reset.
- **CNPG will not reconcile PVCs while the cluster is in `Not enough disk
  space`.** Break the deadlock by patching the PVC directly to the size already
  in git; CNPG then agrees and rolls the pod.
