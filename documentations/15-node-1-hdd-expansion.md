# 15 — node-1 spare-disk expansion (Longhorn HDD tier)

`staging-controlplane-1` carries four disks. Longhorn saw one of them. This
document is the runbook to change that, and the record of why the result looks
the way it does.

Status: **fully applied 2026-08-16.** All three disks are partitioned, xfs,
mounted, and registered with Longhorn. `hdd-sata-640` is registered **untagged**
(see "Why `hdd-sata-640` ended up untagged" — the tagged plan was abandoned, and
why matters); the two USB disks carry the `hdd` tag. Node-1 now presents four
disks:

```
default-disk-080600000000  /var/lib/longhorn      max=497.6GB   tags: []
hdd-sata-640               /var/mnt/hdd-sata-640  max=639.8GB   tags: []
hdd-usb-1000               /var/mnt/hdd-usb-1000  max=999.7GB   tags: [hdd]
hdd-usb-500                /var/mnt/hdd-usb-500   max=499.9GB   tags: [hdd]
```

Every step below is manual and ordered; the git state alone changes nothing on
the node.

Result of the #13069 gate on Talos v1.13.4 (step 4): **no masking.**

```
MountStatus   EPHEMERAL        /dev/nvme0n1p4   /var                    xfs
MountStatus   u-hdd-sata-640   /dev/sda1        /var/mnt/hdd-sata-640   xfs
```

Each path appears once, and kubelet's own startup gate lists `/var/mnt` among
the volumes it waits for — which is the propagation that makes the absent
`extraMounts` entry correct rather than merely untested. `sda` is now GPT with
`sda1` xfs, partition label `u-hdd-sata-640`.

The USB volumes fail with the message that names the wipe as the only blocker:

```
no disks matched for volume (1 matched selector): 1 have not enough space, 0 have wrong format, 0 have other issues
```

## The finding

Longhorn does not scan block devices. It registers *filesystem paths*, and the
only path it had on node-1 was `defaultDataPath: /var/lib/longhorn`, which lives
on the EPHEMERAL partition of the install disk:

```
MountStatus   EPHEMERAL   /dev/nvme0n1p4   /var   xfs
```

Talos partitions the `installDisk` and nothing else, and `talconfig.yaml`
declared no user volumes, so the other three disks were never given a
filesystem. `sda` had no partition table at all. That is the whole cause — no
Longhorn setting was ever wrong.

## The hardware

| Dev | Size | Model | Transport | Rotational | State when found |
|---|---|---|---|---|---|
| `nvme0n1` | 500 GB | `CT500P3PSSD8` | nvme | no | Install disk. `EFI`/`META`/`STATE`/`EPHEMERAL`. |
| `sda` | 640 GB | `WDC WD6400BPVT-6` | sata | **yes** | Raw. No partition table, no filesystem. |
| `sdb` | 1.0 TB | `ThinkPlus` | **usb** | **yes** | GPT: `EFI System Partition` + 1000 GB **APFS** container. |
| `sdc` | 500 GB | `ThinkPlus` | **usb** | **yes** | GPT: `EFI System Partition` + 500 GB **APFS** container. |

`sdd`–`sdk` also appear in `talosctl get disks`. They are iSCSI-attached
Longhorn replica volumes, not hardware. Ignore them.

Two properties of this hardware drive every decision below.

**`sdb` and `sdc` hold live Apple filesystems.** Partition type
`7c3457ef-0000-11aa-aa11-00306543ecac` is the APFS container GUID. Both disks
are fully allocated — there is no free space for Talos to provision into — so
the user volumes for them cannot come up until the disks are wiped, and wiping
them destroys that data irreversibly. This is the one step in this document that
cannot be undone.

**`sdb` and `sdc` are one USB dock, not two disks.** They report the *same*
WWID and differ only in the LUN at the end of the bus path:

```
sdb  wwid: naa.5000000000000001  .../usb1/1-3/1-3:1.0/host1/target1:0:0/1:0:0:0
sdc  wwid: naa.5000000000000001  .../usb1/1-3/1-3:1.0/host1/target1:0:0/1:0:0:1
```

So WWID is unusable as a disk selector — it matches both — and the selectors in
`talconfig.yaml` discriminate on `disk.size` instead. Beyond selection, USB-SATA
bridges reset under sustained write load and re-enumerate, which Longhorn sees
as a faulted replica. `sda` is a real SATA port and is the only one of the three
worth trusting with data.

## What was changed in git

| File | Change |
|---|---|
| `bootstraping/talconfig.yaml` | Three `UserVolumeConfig` documents and a Longhorn node label/annotation pair, all under `nodes[0].patches` — node-1 only. |
| `infrastructure/controllers/base/longhorn/storageclass-hdd.yaml` | New `longhorn-hdd` StorageClass, `diskSelector: hdd`, one replica. |
| `infrastructure/controllers/base/longhorn/kustomization.yaml` | Registers the class. |

The volumes land at `/var/mnt/hdd-sata-640`, `/var/mnt/hdd-usb-1000` and
`/var/mnt/hdd-usb-500`, formatted `xfs`, each growing to fill its disk.

### Why the patches are per-node and not in the shared `patches:` block

`talconfig.yaml` has a cluster-wide `patches:` list, and putting the user
volumes there would have been shorter. It would also have been wrong: node-2 and
node-3 have exactly one SATA SSD each — their *install* disk — plus iSCSI
virtual disks. A `disk.transport == 'sata'` selector evaluated on those nodes is
one `!system_disk` clause away from formatting something that matters.

### Why there is no `kubelet.extraMounts` entry for the new paths

This is the trap the repo has carried since doc 06, and it is the reason to read
this section before "fixing" the config:

> Never add a Talos `UserVolumeConfig` for Longhorn while the
> `/var/lib/longhorn` kubelet bind mount exists — mount masking,
> siderolabs/talos#13069.

Upstream #13069 is **closed as not planned and unfixed** (last reported against
v1.12.4). The EPHEMERAL tree stacks on top of the user volume mount points, and
the reporter found no configuration that reliably prevented it. Critically, the
bug affects *any* user volume under `/var/mnt/<name>` — it is not specific to
volumes targeting `/var/lib/longhorn`.

The existing `/var/lib/longhorn` bind in the shared machine patch is
load-bearing and stays. The new paths therefore get **no bind mount of their
own**: Talos ≥1.10 already propagates `/var/mnt` into the kubelet mount
namespace, and a second, hand-written bind over the same path is precisely the
configuration in the bug report. Step 4 below verifies whether the stacking
happens anyway. **If it does, stop** — do not add `extraMounts` to work around
it; the correct response is to leave `sda` unused and reopen the upstream issue
with v1.13.4 evidence.

### Why the Longhorn disks are declared as a node annotation

`node.longhorn.io/default-disks-config`, gated by the
`node.longhorn.io/create-default-disk: config` label, is read **only when
Longhorn first registers a node**. node-1 is already registered, so on the
current cluster this pair does nothing at all — the disks have to be added by
hand once (step 5).

It is in git because that is exactly the reproducibility requirement: a rebuilt
or replaced node-1 comes up with all four disks, correct reserves and correct
tags, with no manual step. The cost is the standard Longhorn split this repo
already documents for `storageReserved` — **git and the cluster can disagree,
and nothing detects it.**

The `/var/lib/longhorn` entry is listed in that annotation alongside the three
HDDs. It must stay listed: with `create-default-disk: config` set, Longhorn
creates *only* what the annotation names, so dropping it gives a rebuilt node no
default disk.

### Why `hdd-sata-640` ended up untagged

The original plan tagged all three disks `hdd` and kept them out of the default
StorageClass. Applying it exposed why that could not stand: node-1's NVMe had
**3.1 GB schedulable** (`max 497.6 − reserved 74.6 − scheduled 419.8`), and two
volumes were stuck permanently at two replicas —

```
insufficient storage: disk default-disk-080600000000 on node staging-controlplane-1
does not have enough storage available for replica … with size 5368709120
```

A tagged disk accepts only volumes whose class requests the tag, so tagging
`sda` would have left 640 GB sitting next to a starved default disk forever. It
is therefore registered with `tags: []` and the default class uses it. The
accepted cost is that Longhorn may place a latency-sensitive replica on a
5400 rpm drive; the rejected alternative was cutting the NVMe's `storageReserved`
from 74.6 GB to ~25 GB, which buys 50 GB by thinning the margin on the fullest
disk in the cluster.

The two **USB** volumes keep the `hdd` tag. They are the unreliable ones, and
`longhorn-hdd` exists for them.

### Why one replica on the HDD class

The tagged disks all live on node-1, and Longhorn will not place two replicas of
a volume on the same node. `numberOfReplicas: "2"` on a `diskSelector: hdd`
class does not degrade the volume — it makes it permanently unschedulable.

Anything on `longhorn-hdd` therefore has exactly one copy, on a rotational disk,
with no backup target configured anywhere in this cluster. It suits bulk,
regenerable, latency-tolerant data (AzuraCast media, Garage backing store) and
nothing else. Do not put a database on it.

### What this does *not* fix

Node-1 is the cluster's storage bottleneck — 393.9 GiB usable against 789.6 GiB
on nodes 2 and 3, which is the entire reason `longhorn-monitoring` exists at two
replicas. Tagging the new disks `hdd` deliberately keeps them out of the default
class, so **that bottleneck is unchanged**. Untagging `hdd-sata-640` would fix
it, at the price of letting Longhorn drop a Postgres replica onto a 5400 rpm
laptop drive whenever the NVMe looks full. The tag is the trade the tag makes;
it is reversible by editing the annotation and the disk's `tags` on the CR.

## Runbook

### 1. Render and validate

```bash
cd bootstraping
SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-1.yaml --mode metal
```

Confirm the blast radius is node-1 only — this must print `0`:

```bash
grep -c "UserVolumeConfig" clusterconfig/Homelab_staging-staging-controlplane-2.yaml
```

### 2. Wipe `sdb` and `sdc` — destructive, irreversible

> **This permanently destroys the APFS filesystems on both disks. There is no
> undo and no backup of them anywhere in this cluster. Verify the data is backed
> up or genuinely disposable before running it.**
>
> Skip this step entirely to bring up only `sda`. The other two user volumes
> simply stay unprovisioned; nothing else breaks.

```bash
talosctl -n 192.168.1.101 wipe disk sdb sdc --drop-partition
```

### 3. Apply the machine config

```bash
talosctl apply-config -n 192.168.1.101 \
  --file clusterconfig/Homelab_staging-staging-controlplane-1.yaml
```

Talos partitions and formats each matched disk, then mounts it under
`/var/mnt/`.

### 4. Verify the mounts — the #13069 gate

```bash
talosctl -n 192.168.1.101 get volumestatus | grep hdd-
talosctl -n 192.168.1.101 get mounts | grep /var/mnt
```

Each volume must be `ready` with a real partition in `LOCATION`, and each path
must appear **once**. A second EPHEMERAL mount stacked on a `/var/mnt/hdd-*`
path is bug #13069 reproducing on v1.13.4: stop here, do not add `extraMounts`,
and do not proceed to step 5.

### 5. Register the disks with Longhorn (one time, live cluster only)

The annotation from step 3 is inert on an already-registered node. Add the disks
to the existing `nodes.longhorn.io` CR:

```bash
kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1 \
  --type=merge -p '{"spec":{"disks":{
    "hdd-sata-640":{"path":"/var/mnt/hdd-sata-640","allowScheduling":true,"storageReserved":96020254310,"tags":[],"diskType":"filesystem"},
    "hdd-usb-1000":{"path":"/var/mnt/hdd-usb-1000","allowScheduling":true,"storageReserved":150030732902,"tags":["hdd"],"diskType":"filesystem"},
    "hdd-usb-500":{"path":"/var/mnt/hdd-usb-500","allowScheduling":true,"storageReserved":75016179302,"tags":["hdd"],"diskType":"filesystem"}}}}'
```

Omit any disk whose volume did not come up in step 4. The reserves are 15% of
raw capacity, matching `storageReservedPercentageForDefaultDisk`. `hdd-sata-640`
carries `tags: []` on purpose — see "Why `hdd-sata-640` ended up untagged".

**This patch is unreconciled drift, by necessity.** `nodes.longhorn.io` CRs are
created by Longhorn at runtime; Flux does not own them and no controller
reverts a hand edit. The `default-disks-config` annotation in `talconfig.yaml`
holds the same four entries, but Longhorn reads it only at first registration,
so on a running cluster it is a *rebuild* recipe, not enforcement. Git and the
cluster can therefore diverge silently — the same hazard the Longhorn README
already records for `storageReserved`. To re-check them against each other:

```bash
kubectl -n longhorn-system get nodes.longhorn.io staging-controlplane-1 -o json \
  | jq -c '[.spec.disks | to_entries[] | {path:.value.path, reserved:.value.storageReserved, tags:.value.tags}]'
kubectl get node staging-controlplane-1 \
  -o jsonpath='{.metadata.annotations.node\.longhorn\.io/default-disks-config}' \
  | jq -c '[.[] | {path, reserved:.storageReserved, tags}]'
```

Verified identical on 2026-08-16 after the patches below were applied.

### 6. Confirm

```bash
kubectl -n longhorn-system get nodes.longhorn.io staging-controlplane-1 \
  -o jsonpath='{range .status.diskStatus.*}{.diskName}{"\t"}{.diskPath}{"\t"}max={.storageMaximum}{"\t"}avail={.storageAvailable}{"\n"}{end}'
kubectl get sc longhorn-hdd
```

Four disks, each `Ready` and `Schedulable`.

## Rolling back

Steps 3–5 are reversible; step 2 is not.

1. `kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1
   --type=json -p '[{"op":"remove","path":"/spec/disks/hdd-sata-640"}]'` (repeat
   per disk). Evict replicas first if any landed there —
   `evictionRequested: true` on the disk, and wait.
2. Remove the `nodes[0].patches` block from `talconfig.yaml`, re-render, re-apply.
   Talos leaves the partitions in place; `talosctl wipe disk` clears them.
3. Delete `storageclass-hdd.yaml` and its `kustomization.yaml` entry.

## Related documentation

- [../bootstraping/README.md](../bootstraping/README.md) — talconfig, render/apply loop
- [../infrastructure/controllers/base/longhorn/README.md](../infrastructure/controllers/base/longhorn/README.md) — Longhorn, the disk reserve, the replica story
- [07-talos-ha-expansion.md](07-talos-ha-expansion.md) — where the #13069 trap was first recorded
- [14-design-decisions.md](14-design-decisions.md) — section 1, "Platform"
