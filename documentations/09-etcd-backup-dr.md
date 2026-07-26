# etcd Backups & Disaster Recovery — Talos → Garage S3

etcd holds the entire Kubernetes control-plane state: every object, every
Secret. Losing 2 of the 3 control planes at once means total loss of service,
and without a snapshot the cluster is unrecoverable.

Snapshots run **every 6 hours** via a Flux-managed CronJob, are encrypted with
`age` before leaving the cluster, and land in the `etcd` bucket on an
**off-cluster** Garage host.

## What this does and does not cover

| Covered | Not covered |
|---|---|
| All Kubernetes API objects (Deployments, Secrets, ConfigMaps, CRs, RBAC…) | **Longhorn volume data** — a restore brings back PV/PVC *objects*, not their contents |
| Cluster membership + control-plane config | Talos machine PKI (lives in `bootstraping/talsecret.sops.yaml`) |
| | Postgres PITR — separately covered by CNPG → R2, see `03-backups.md` |

Longhorn currently has **no `backupTarget` configured**
(`infrastructure/controllers/base/longhorn/release.yaml`). Volume data survives
a node reset only because replicas live on `/var/lib/longhorn`, a bind mount
outside the wiped `EPHEMERAL` partition. That is resilience, not backup. Closing
this gap is the next piece of work.

## Components

```mermaid
graph TD
  subgraph cluster["Talos cluster (staging)"]
    subgraph ns["namespace etcd-backup"]
      sa["ServiceAccount CR<br/>(talos.dev/v1alpha1)<br/>roles: os:etcd:backup"]
      sec_talos["Secret etcd-backup-talos-secrets<br/>(client cert, auto-rotated by Talos)"]
      cj["CronJob etcd-backup<br/>(talos-backup, every 6h)"]
      sec_s3["Secret etcd-backup-s3<br/>(SOPS-encrypted)"]
    end
    api["Talos machined API<br/>/machine.MachineService/EtcdSnapshot"]
    etcd[("etcd")]
    pr["PrometheusRule<br/>etcd-backup"]
  end

  garage[("Garage bucket `etcd`<br/>OFF-CLUSTER host")]
  tg["Telegram<br/>(Alertmanager)"]

  sa -- "Talos materialises" --> sec_talos
  sec_talos -- "mounted at /var/run/secrets/talos.dev" --> cj
  sec_s3 -. "endpoint, keys, age pubkey" .-> cj
  cj -- "EtcdSnapshot RPC" --> api
  api --> etcd
  cj -- "zstd + age encrypt, upload" --> garage
  pr -- "job failed / no success in 9h" --> tg
```

### Why `kubernetesTalosAPIAccess` instead of a mounted `talosconfig`

`bootstraping/talconfig.yaml` enables:

```yaml
      features:
        kubernetesTalosAPIAccess:
          enabled: true
          allowedRoles:
            - os:etcd:backup
          allowedKubernetesNamespaces:
            - etcd-backup
```

Talos then watches for `talos.dev/v1alpha1` `ServiceAccount` CRs in that one
namespace and issues **short-lived, auto-rotated** client certs as a Secret.
The `os:etcd:backup` role grants exactly one API method —
`/machine.MachineService/EtcdSnapshot`. A leaked backup credential cannot read
machine config, fetch other secrets, or reboot a node.

The alternative — generating a long-lived `talosconfig` and committing it as a
SOPS secret — means a static credential with no rotation. Don't.

### Encryption

The snapshot contains every Kubernetes Secret in plaintext. `talos-backup`
encrypts it with `age` using `AGE_RECIPIENT_PUBLIC_KEY` before upload.
**Never set `DISABLE_ENCRYPTION`.**

### Security limitation — Garage has no object lock or versioning

Unlike the R2 buckets used for CNPG (`03-backups.md`), Garage cannot make
objects immutable. Anyone holding the write key can delete every snapshot.
Mitigations in place: the Garage key is scoped to the `etcd` bucket only, and
the age **private** key is stored outside the cluster entirely. Full 3-2-1
(replicating snapshots to the existing R2 account) is a deliberate future step.

## File map

| Concern | Path |
|---|---|
| Talos API access feature | `bootstraping/talconfig.yaml` (machine patch) |
| Namespace, ServiceAccount CR, CronJob | `infrastructure/services/base/etcd-backup/` |
| S3 + age config (SOPS) | `infrastructure/services/staging/etcd-backup/etcd-backup-s3.enc.yaml` |
| Overlay wiring | `infrastructure/services/staging/kustomization.yaml` |
| Alerting | `monitoring/configs/staging/etcd-backup-alerts/` |

## Retention

`talos-backup` does not prune. Set a lifecycle expiry on the bucket from the
Garage host — 30 days, which at 4 snapshots/day is ~120 objects:

```bash
aws --endpoint-url http://<garage-host>:3900 s3api put-bucket-lifecycle-configuration \
  --bucket etcd --lifecycle-configuration file://lifecycle.json
```

If the installed Garage version does not support lifecycle rules, add a small
prune CronJob rather than letting the bucket grow unbounded.

## Offsite prerequisites — a restore is impossible without these

None of these may live only on the cluster:

- **`clusters/staging/age.agekey`** — gitignored. Decrypts both
  `talsecret.sops.yaml` and every `.enc.yaml`. **Lose this and the cluster
  cannot be rebuilt**, snapshots or not.
- **The age backup private key** (`etcd-backup-age.key`) — decrypts the
  snapshots themselves. Never committed, not even SOPS-encrypted: doing so
  would make it depend on the key above, so one loss would take out both.
- **Git repo access** — holds `talsecret.sops.yaml`, the Talos PKI.

Store all three in a password manager or offline medium.

## Operations

Trigger a backup on demand:

```bash
kubectl -n etcd-backup create job --from=cronjob/etcd-backup manual-test-1
kubectl -n etcd-backup logs job/manual-test-1
```

List what is in the bucket:

```bash
aws --endpoint-url http://<garage-host>:3900 s3 ls s3://etcd/staging/
```

Verify a snapshot is a valid etcd database (do this periodically):

```bash
age -d -i etcd-backup-age.key -o db.snapshot <downloaded-object>
etcdutl snapshot status db.snapshot -w table   # revision + total keys must be sane
```

Rotate the Garage key: mint a new scoped key, update the SOPS secret
(`sops -e -i`), commit, then revoke the old key.

## Recovery

### Case 1 — one control plane lost (2 of 3 healthy)

**Do not restore from a snapshot.** etcd still has quorum; restoring would
discard live state. Reset the bad node and let it rejoin:

```bash
talosctl -n <bad-node-ip> reset --graceful=false --reboot --system-labels-to-wipe=EPHEMERAL
```

It rejoins etcd automatically once it comes back up.

### Case 2 — quorum lost (2 or 3 control planes gone)

This is the only situation calling for a snapshot restore. Work through the
steps in order; do not run step 5 on more than one node.

**1. Retrieve and decrypt the newest snapshot**

```bash
aws --endpoint-url http://<garage-host>:3900 s3 ls s3://etcd/staging/
aws --endpoint-url http://<garage-host>:3900 s3 cp s3://etcd/staging/<newest> .
age -d -i etcd-backup-age.key -o db.snapshot <newest>
```

If compression was enabled, decompress with `zstd -d` after decrypting.

**2. Rebuild node configs from the same `talsecret`** (identical PKI, so your
existing `talosconfig` and certs keep working):

```bash
cd bootstraping
SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
```

**Never regenerate `talsecret.sops.yaml`** — new PKI means a dead cluster.

**3. Wipe the ephemeral partition on all three control planes**

```bash
talosctl -n 192.168.1.101 reset --graceful=false --reboot --system-labels-to-wipe=EPHEMERAL
talosctl -n 192.168.1.102 reset --graceful=false --reboot --system-labels-to-wipe=EPHEMERAL
talosctl -n 192.168.1.103 reset --graceful=false --reboot --system-labels-to-wipe=EPHEMERAL
```

**4. Wait until etcd reports `Preparing` on the node you will recover on**

```bash
talosctl -n 192.168.1.101 service etcd
```

**5. Recover — on one node only**

```bash
talosctl -n 192.168.1.101 bootstrap --recover-from=./db.snapshot
```

`bootstrap` verifies the snapshot hash. Only add `--recover-skip-hash-check` if
the snapshot was copied raw out of `/var/lib/etcd/member/snap/db` rather than
produced by `talosctl etcd snapshot`.

**6. Let the other two nodes rejoin**

Nodes `.102` and `.103` join etcd automatically once the control-plane endpoint
is up. **Do not run `bootstrap` on them.**

**7. Verify**

```bash
talosctl -n 192.168.1.101 health --wait-timeout 10m
kubectl get nodes
flux get kustomizations
flux get helmreleases -A
```

Then check Longhorn volumes reattach, remembering that their *data* was never in
etcd — only the PV/PVC objects were.

### Manual snapshot (before a risky change)

The pattern already used in `07-talos-ha-expansion.md` and
`08-cilium-cni-ingress-migration.md`:

```bash
talosctl -n 192.168.1.101 etcd snapshot bootstraping/etcd-pre-<change>.snapshot
```

If etcd is already unhealthy and the API will not serve a snapshot, copy the
database directly (then restore with `--recover-skip-hash-check`):

```bash
talosctl -n 192.168.1.101 cp /var/lib/etcd/member/snap/db .
```

## Restore drill — proof it works (run this, don't trust the design)

A backup you have never restored is a hypothesis. This section turns it into
evidence. Three tiers, cheapest first; **Tier 1 is the one to run on a schedule**
— it is a real restore, off to the side, that cannot touch the live cluster.

> **Prerequisite.** The system must already be deployed and have produced at
> least one real snapshot. Until the SOPS secret is filled
> (`infrastructure/services/staging/etcd-backup/etcd-backup-s3.enc.yaml`) and the
> `kubernetesTalosAPIAccess` feature is applied to all three nodes, the bucket is
> empty and there is nothing to drill against. Tools needed on your workstation:
> `aws`, `age`, `zstd`, and `docker` (or a local `etcd`/`etcdutl`/`etcdctl`
> 3.5.x).

Set the endpoint once for the commands below:

```bash
GARAGE=http://<garage-host>:3900     # CUSTOM_S3_ENDPOINT from the SOPS secret
```

### Fetch and decrypt the newest snapshot

`talos-backup` names objects `Homelab_staging-<RFC3339>.snap.zst.age` — it takes
the snapshot, compresses with zstd, then age-encrypts, so you **decrypt first,
then decompress**. RFC3339 timestamps sort chronologically, so the last line is
the newest:

```bash
OBJ=$(aws --endpoint-url "$GARAGE" s3 ls s3://etcd/staging/ | sort | tail -n1 | awk '{print $NF}')
aws --endpoint-url "$GARAGE" s3 cp "s3://etcd/staging/$OBJ" .

age -d -i etcd-backup-age.key -o snapshot.zst "$OBJ"   # object ends .zst.age
zstd -d snapshot.zst -o db.snap
# If ENABLE_COMPRESSION was false (object ends .snap.age):
#   age -d -i etcd-backup-age.key -o db.snap "$OBJ"   # and skip zstd
```

### Tier 0 — integrity

```bash
etcdutl snapshot status db.snap -w table
```

A non-zero **revision** and a sane **total-keys** count prove the file is a
structurally valid etcd database. Necessary, not sufficient — it does not prove
the *contents* are your cluster.

### Tier 1 — restore it and read the real cluster state (safe, repeatable)

Rebuild an actual etcd member from the snapshot and query it. Everything runs in
a throwaway container; the live cluster is never contacted.

```bash
docker run --rm -d --name etcd-drill \
  -v "$PWD:/work" -w /work --entrypoint sh \
  gcr.io/etcd-development/etcd:v3.5.17 -c '
    etcdutl snapshot restore db.snap --data-dir /drill \
      --name drill --initial-cluster drill=http://localhost:2380 \
      --initial-advertise-peer-urls http://localhost:2380 &&
    exec etcd --name drill --data-dir /drill \
      --initial-cluster drill=http://localhost:2380 \
      --initial-advertise-peer-urls http://localhost:2380 \
      --listen-peer-urls http://localhost:2380 \
      --listen-client-urls http://0.0.0.0:2379 \
      --advertise-client-urls http://localhost:2379 \
      --force-new-cluster'

# How many Kubernetes objects are really in there?
docker exec etcd-drill etcdctl get /registry --prefix --keys-only | grep -c .

# Spot-check objects you know exist:
docker exec etcd-drill etcdctl get /registry/namespaces --prefix --keys-only
docker exec etcd-drill etcdctl get /registry/secrets/etcd-backup --prefix --keys-only

docker rm -f etcd-drill && rm -rf db.snap snapshot.zst "$OBJ"
```

Seeing thousands of `/registry/...` keys — your namespaces, your Secrets, the
`etcd-backup` objects this system itself created — is the proof: the snapshot is
a live, restorable copy of the whole control plane, not just a well-formed file.
(Talos does not encrypt etcd at rest, so the keys list in plaintext; the *values*
are Kubernetes-encoded protobuf. The key list is the evidence.) Match the etcd
image to the cluster's etcd 3.5.x line — any recent 3.5.x restores a 3.5.x
snapshot.

### Tier 2 — full cluster rehearsal (the real "the system failed" test)

Tier 1 proves the data. Only a full restore proves the *procedure*. Two ways:

- **Ephemeral cluster (recommended).** Provision three throwaway Talos nodes
  (VMs) from the **same `talsecret.sops.yaml`** — the snapshot's ServiceAccount
  tokens and etcd member certs only validate against the original PKI, so a fresh
  `talsecret` would fail (adjust node IPs/VIP in a copy of `talconfig.yaml`). Then
  run the **Case 2** restore flow — retrieve and decrypt the snapshot,
  `bootstrap --recover-from` on one node, let the others rejoin, verify — against
  those nodes, point a kubeconfig at their VIP, and confirm
  `kubectl get ns,secrets -A` matches production counts. Tear the VMs down after.
- **In-place on staging — destructive.** The ultimate proof, because it is not a
  simulation. It wipes the real control plane; only in a maintenance window, and
  only because this is a learning cluster you can afford to lose. Follow **Case 2**
  exactly.

> **Warning — in-place drill.** `talosctl reset --system-labels-to-wipe=EPHEMERAL`
> on all three nodes destroys the running control plane. If the snapshot, the age
> private key, or `clusters/staging/age.agekey` is bad or missing, the cluster is
> gone for good. Confirm Tier 1 passed on the *current* snapshot **first**, and
> confirm you hold all three offsite prerequisites, before wiping anything.

### The data tier — etcd alone is not a full recovery

An etcd restore brings back the CNPG `Cluster` CRs and their Secrets, but **not
the Postgres data** — that lives on Longhorn PVs and in the CNPG object store, not
in etcd. A complete DR proof therefore also restores each database from its backup
with `bootstrap.recovery` (the drill in `03-backups.md`).

That CNPG object store is **Cloudflare R2 today, not Garage** — there is no
CNPG-to-Garage configuration anywhere in the repo (`grep -ri garage` finds only
this etcd-backup stack). Moving CNPG to Garage would be a separate, deliberate
change (repoint each `objectstore.yaml` endpoint + credentials), not an
assumption to fold into this drill.

### What a pass looks like — capture it

Record these each drill (date, snapshot object name, and the numbers) as the
evidence the system works:

| Tier | Evidence of success |
|---|---|
| 0 | `snapshot status` shows non-zero revision + total keys |
| 1 | `/registry` key count in the thousands; named objects you recognize appear |
| 2 | restored cluster: `kubectl get ns,nodes,secrets -A` ≈ production; app pods Running; `flux get kustomizations` all Ready |

## A backup that cannot restore is worthless

`03-backups.md` states this principle for the CNPG backups and it applies here
just as much. Snapshot-status verification (above) is the minimum gate. A full
restore drill against a throwaway VM cluster is the real test and should be
scheduled periodically.
