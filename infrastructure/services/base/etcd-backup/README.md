# etcd-backup

etcd holds the entire Kubernetes control plane — every object and every Secret —
so losing quorum without a snapshot means an unrecoverable cluster. This
component runs `talos-backup` as a CronJob every 6 hours: it asks Talos for an
etcd snapshot over the machined API
(`/machine.MachineService/EtcdSnapshot`), encrypts it with `age`, and uploads it
to the bucket `homelab-staging-etcd-backup` on the
**off-cluster** Garage host. The full disaster-recovery procedure, the restore
drill and the offsite prerequisites live in
[`../../../../documentations/09-etcd-backup-dr.md`](../../../../documentations/09-etcd-backup-dr.md).

What this covers: all Kubernetes API objects, cluster membership and
control-plane config. What it does **not** cover: Longhorn volume *data* (a
restore brings back PV/PVC objects, not their contents), the Talos machine PKI
(`bootstraping/talsecret.sops.yaml`) and Postgres PITR (CNPG → R2/Garage, see
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md)).

## How it is wired

Base — `infrastructure/services/base/etcd-backup/`:

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the four objects below. |
| `namespace.yaml` | Namespace `etcd-backup`. The name is not free: it is the one namespace `bootstraping/talconfig.yaml` lets Talos issue API credentials into. |
| `talos-serviceaccount.yaml` | `talos.dev/v1alpha1` `ServiceAccount` `etcd-backup-talos-secrets` with `roles: [os:etcd:backup]`. Talos watches this CR and materialises a Secret of the same name holding a short-lived, auto-rotated client cert. |
| `cronjob.yaml` | The `CronJob etcd-backup` itself. |
| `prune-cronjob.yaml` | `CronJob etcd-backup-prune`, daily at 04:30 — expires objects past the retention window. See Retention below. |

`cronjob.yaml`, block by block:

- `schedule: "0 */6 * * *"`, `concurrencyPolicy: Forbid`,
  `successfulJobsHistoryLimit: 3` / `failedJobsHistoryLimit: 3`,
  `backoffLimit: 2`, `restartPolicy: OnFailure`.
- `image: ghcr.io/siderolabs/talos-backup:v0.1.0-beta.3`,
  `command: [/talos-backup]`, `workingDir: /tmp`. The `# renovate:` annotation
  above the image is present but inert: `renovate.json` scopes the kubernetes
  manager to `/apps/.+/db-migrations/.+\.yaml$/`, so this file is out of scope
  and the pin is bumped by hand — which is what it should be, since the two
  ConfigMap workarounds below are tied to beta.3.
- `envFrom` the Secret `etcd-backup-s3` (Garage credentials) and the ConfigMap
  `etcd-backup-config` (endpoint, bucket, age recipient) — both supplied by the
  overlay, and both referenced by name, so renaming either object breaks the job.
- `resources`: requests 50m / 128Mi, limit 512Mi.
- `securityContext`: `runAsUser`/`runAsGroup` 1000, `runAsNonRoot`,
  `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, all
  capabilities dropped, `seccompProfile: RuntimeDefault`.
- Three volumes, all needed because the root filesystem is read-only: `tmp`
  (emptyDir, where the snapshot is written before upload), `talos` (emptyDir,
  `/.talos`), and `talos-secrets` — the Secret `etcd-backup-talos-secrets`
  mounted at `/var/run/secrets/talos.dev`, the path the Talos client library
  auto-discovers.

Three things this component depends on but does not own:

- `bootstraping/talconfig.yaml` — `machine.features.kubernetesTalosAPIAccess`
  with `allowedRoles: [os:etcd:backup]` and
  `allowedKubernetesNamespaces: [etcd-backup]`. Without it the ServiceAccount CR
  never produces a Secret.
- `infrastructure/services/{base,staging}/garage-gateway/` — the in-cluster
  HAProxy gateway `garage-s3.garage-gw.svc.cluster.local:3900` that fronts the
  three Garage nodes over Tailscale.
- `monitoring/configs/staging/etcd-backup-alerts/` — the `PrometheusRule`
  described under "Operating it".

### Overlays

`infrastructure/services/staging/etcd-backup/` is the only overlay. It sets
`namespace: etcd-backup` and pulls in `../../base/etcd-backup` plus:

- `configmap.yaml` — the ConfigMap `etcd-backup-config`:

  | Key | Value |
  |---|---|
  | `AWS_REGION` | `garage` |
  | `BUCKET` | `homelab-staging-etcd-backup` |
  | `S3_PREFIX` | `staging` |
  | `CLUSTER_NAME` | `Homelab_staging` |
  | `CUSTOM_S3_ENDPOINT` | `http://garage-s3.garage-gw.svc.cluster.local:3900` |
  | `USE_PATH_STYLE` | `"false"` (inverted check — see Traps) |
  | `ENABLE_COMPRESSION` | `"true"` |
  | `AGE_RECIPIENT_PUBLIC_KEY` / `AGE_X25519_PUBLIC_KEY` | the same age **public** key, set twice on purpose — see Traps |

- `etcd-backup-s3.enc.yaml` — SOPS-encrypted Secret `etcd-backup-s3` holding
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for the Garage bucket. Encrypted
  manifests live only in overlays; `.sops.yaml` matches paths under `staging/`
  and `production/`.

There is no production overlay.

## Why it is like this

**Every 6 hours.** That is a worst-case RPO of 6h of control-plane state. The
schedule is offset from the 03:00 CNPG backups so the two do not contend for
upstream bandwidth.

**`kubernetesTalosAPIAccess`, not a mounted `talosconfig`.** Talos issues
short-lived, auto-rotated client certs as a Secret, scoped to the single API
method `/machine.MachineService/EtcdSnapshot`. A leaked backup credential cannot
read machine config, fetch other secrets or reboot a node. The alternative —
generating a long-lived `talosconfig` and committing it as a SOPS secret — is a
static credential with no rotation.

**The upload goes through the in-cluster gateway.** `talos-backup` is an
in-cluster pod, so `CUSTOM_S3_ENDPOINT` points at the HAProxy gateway Service,
which load-balances and TCP-health-checks across three Garage nodes reached over
Tailscale (the Talos nodes are not on the tailnet — the operator's userspace
proxy pods are). A **restore runs off-cluster** and therefore goes **direct** to
a Garage node's tailnet IP; the gateway is in-cluster only.

**The snapshot is encrypted before it leaves the cluster.** It contains every
Kubernetes Secret in plaintext, so `age` encryption is not optional. The age
**private** key is deliberately stored outside the cluster and outside Git — not
even SOPS-encrypted, because that would make it depend on
`clusters/staging/age.agekey` and one loss would take out both.

**`ENABLE_COMPRESSION: "true"` is set and has no effect on the pinned beta.3.**
Objects are named `Homelab_staging-<RFC3339>.snap.age` under `staging/` — no
`.zst` — and each is exactly the size of the raw snapshot. So a restore
**decrypts only**; there is nothing to decompress. This is a third quirk of the
beta.3 pin, alongside the two below. Fixing it would divide every size figure
here by the zstd ratio, but it changes the object *name* and therefore the
restore commands, so it is tracked separately.

**Garage has no object lock or versioning**, unlike the R2 buckets used for
CNPG. Anyone holding the write key can delete every snapshot. What limits that:
the Garage key is scoped to the `homelab-staging-etcd-backup` bucket only, and
the age private key lives off-cluster. Replicating snapshots to R2 for full
3-2-1 is a deliberate future step.

### Retention: a CronJob in git, not a bucket lifecycle rule

`talos-backup` does not prune, and until 2026-08-12 nothing else did either —
the bucket had grown unbounded since the day it was created. Measured by listing
`s3://homelab-staging-etcd-backup/staging`:

| | |
|---|---|
| Objects | 65, spanning 16.2 days |
| Total stored | 9.45 GiB |
| Per object | 148.8 MiB (64 of the 65 byte-identical) |
| Growth | 4 runs/day → 602 MiB/day → **17.6 GiB/month**, forever |

That measurement is what unblocked the decision; the job logs only ever reported
the 156 MB pre-upload snapshot, so the stored size was unknown.

`prune-cronjob.yaml` runs daily at 04:30 and keeps **30 days ≈ 120 objects ≈
17.6 GiB** steady state. 30d over 7d (4.11 GiB) because the etcd restore drill
has never been run end to end and the age key is offline — until a restore is
*proven*, history is the cheapest insurance available. 30d over 90d (52.88 GiB)
because a month-old snapshot restores a cluster Flux would immediately reconcile
away.

This deliberately takes what doc 09 called the fallback. A lifecycle rule applied
with `aws s3api put-bucket-lifecycle-configuration` lives in no repository, and a
retention policy nobody can review in a diff is how a bucket silently stops
keeping what everyone assumed it kept.

**It deletes backups, so it is guarded four ways**, each exercised against a
65-object fixture before it shipped:

| Guard | Value | Prevents |
|---|---|---|
| `set -e` | — | A failed listing falling through into a delete loop with no input |
| `MIN_KEEP` | 28 objects (7d) | Any age logic, or a skewed clock, dropping below a week of history |
| `MAX_DELETE` | 24/run | A wrong `RETENTION_DAYS` emptying the bucket in one pass instead of eroding visibly |
| `DRY_RUN` | `false` | Logs the full plan and deletes nothing when `true` |

**`MIN_KEEP` is the load-bearing one.** Simulated with `RETENTION_DAYS=0` — every
object expired — the job converges to exactly 28 objects over two runs and then
deletes nothing on every run after that. It cannot empty the bucket.

It was safe to ship live rather than in dry-run: the oldest object was 16.2 days
old against a 30-day retention, so the first ~14 days of runs are arithmetically
incapable of deleting anything. They log the plan and exit.

## Traps

- **`USE_PATH_STYLE: "false"` actually enables path-style**, because beta.3's
  check is inverted and Garage needs path-style addressing. The mechanism, and
  the note to flip the value when the image is bumped past beta.3, sit on the
  key itself in `infrastructure/services/staging/etcd-backup/configmap.yaml`.
- **The image pin is a workaround, not just a version.** Nothing bumps it for
  you (see above); bumping it by hand without revisiting the two ConfigMap
  workarounds silently breaks uploads.
- **Both age variables must be set, to the same key** — leave one unset and age
  fails with `malformed recipient`. Why, again on the keys themselves in
  `infrastructure/services/staging/etcd-backup/configmap.yaml`.
- **Never set `DISABLE_ENCRYPTION`.** The snapshot holds every Kubernetes Secret
  in plaintext.
- **The age private key is offline and irreplaceable.** Lose it and every
  snapshot is permanently unrecoverable. So is `clusters/staging/age.agekey`,
  which decrypts `talsecret.sops.yaml` and every `.enc.yaml`.
- **`talos-serviceaccount.yaml` only works if `talconfig.yaml` agrees.** The
  role `os:etcd:backup` must be in `allowedRoles` and the namespace
  `etcd-backup` in `allowedKubernetesNamespaces`; otherwise Talos never
  materialises `etcd-backup-talos-secrets` and the pod has no credential.
- **`/var/run/secrets/talos.dev` is the discovery path.** The Talos client
  library looks there; mounting the Secret anywhere else leaves the client with
  no config.
- **The root filesystem is read-only.** The `tmp` and `talos` emptyDirs are what
  make the snapshot writable; removing either makes the job fail before upload.
- **`envFrom` names are a contract with the overlay** — Secret `etcd-backup-s3`
  and ConfigMap `etcd-backup-config`.
- **Do not restore a snapshot while etcd still has quorum.** With 2 of 3 control
  planes healthy, restoring discards live state; reset the bad node and let it
  rejoin instead (doc 09, Case 1).

## Operating it

Trigger a backup on demand:

```bash
kubectl -n etcd-backup create job --from=cronjob/etcd-backup manual-test-1
kubectl -n etcd-backup logs job/manual-test-1
```

List what is in the bucket (from a tailnet device, direct to a Garage node):

```bash
aws --endpoint-url http://<garage-host>:3900 s3 ls s3://homelab-staging-etcd-backup/staging/
```

Verify a snapshot really is an etcd database:

```bash
age -d -i etcd-backup-age.key -o snapshot.zst <object>   # objects end .snap.zst.age
zstd -d snapshot.zst -o db.snap
etcdutl snapshot status db.snap -w table                 # revision + total keys must be sane
```

The scripted read-only drill (fetch, decrypt, restore into a throwaway etcd,
count `/registry` keys, shred everything on exit) is
`mise run etcd-drill -- --offline-key ~/etcd-backup-age.key`.

Rotate the Garage key: mint a new scoped key, `sops -e -i` the overlay secret,
commit, then revoke the old one.

**Alerting** — `monitoring/configs/staging/etcd-backup-alerts/prometheusrule.yaml`
(routed to Telegram, see
[`../../../../documentations/05-alerting.md`](../../../../documentations/05-alerting.md)):

- `EtcdBackupJobFailed` — `kube_job_status_failed{namespace="etcd-backup"} > 0`
  for 5m.
- `EtcdBackupStale` — no successful CronJob completion in over 9h (one missed 6h
  cycle plus margin). This is the one that catches Garage being unreachable,
  credentials expiring or the CronJob being suspended — all silent otherwise. It
  is absent until the first successful run, so it does not fire on a freshly
  deployed cluster.

Recovery — losing one control plane, losing quorum
(`talosctl bootstrap --recover-from`), and the restore drill are step-by-step in
[`../../../../documentations/09-etcd-backup-dr.md`](../../../../documentations/09-etcd-backup-dr.md).
