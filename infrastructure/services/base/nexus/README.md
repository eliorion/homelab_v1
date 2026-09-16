# nexus

Nexus Repository OSS 3, deployed with the `stevehipwell/nexus3` Helm chart
(StatefulSet) in the `nexus` namespace. It is the cluster's dependency cache for
the CI **language** formats — PyPI today, maven and nuget if they are ever
needed again. Runner pods pull through it instead of upstream, so repeat CI runs
are LAN-fast. Most repositories, plus the anonymous-access and realm settings,
are provisioned declaratively by the chart's config Job. Three things sit
outside it: blob store compaction, which a CronJob in this directory
provisions; the cleanup policies, which are live state the Job can no longer
reprovision; and the maven/nuget repositories, which were created in the admin
UI and exist only in the Nexus database — the reason a migration copies that
database rather than recreating it.

**The Docker formats left on 2026-09-16.** Image pulls now go through Harbor
([`../harbor/README.md`](../harbor/README.md)), which serves the same two
upstreams with a publicly trusted certificate, so no client needs
`--insecure-registry` any more. What moved, and where each client's mirror
string lives, is in
[`../../../../documentations/04-ci-runners-cache.md`](../../../../documentations/04-ci-runners-cache.md).
The `docker-hub` and `ghcr` proxy repositories are **kept, unused**, as a
one-variable fallback if Harbor ever has to be bypassed; `docker-cache` was
deleted, see below.

Full CI-stack context lives in
[../../../../documentations/04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).

## How it is wired

| File | What it holds |
|---|---|
| `kustomization.yaml` | Lists the five resources below. |
| `namespace.yaml` | The `nexus` Namespace. |
| `repository.yaml` | `HelmRepository` `stevehipwell` in `flux-system`, `https://stevehipwell.github.io/helm-charts/`, 24h interval. |
| `release.yaml` | The `HelmRelease` — chart `nexus3`, pinned at `5.22.0` and kept current by Renovate, plus storage, JVM sizing, resources, node affinity, root password wiring, the extra Service ports and the whole `config` block (realms, cleanup policies, repositories). |
| `services.yaml` | `nexus-lb`, a second `type: LoadBalancer` Service exposing 8081 and 5000-5002 outside the cluster. |
| `compact-task-cronjob.yaml` | `nexus-ensure-compact-task`, a daily CronJob that makes sure the `blobstore.compact` task exists inside Nexus. |
| `eula-cronjob.yaml` | `nexus-ensure-eula`, an hourly CronJob that makes sure the CE EULA is accepted. Hourly rather than daily because a gated Nexus 403s every CI Docker pull. |

### Repositories and ports

| Repo | Type | Port | Use |
|---|---|---|---|
| `pypi-proxy` | pypi proxy → `https://pypi.org` | 8081 (path) | pip/uv cache — the only repo CI still uses (`UV_INDEX_URL`) |
| `docker-hub` | docker proxy → `https://registry-1.docker.io` | 5000 | idle since 2026-09-16; Harbor serves this |
| `ghcr` | docker proxy → `https://ghcr.io` | 5001 | idle since 2026-09-16; Harbor serves this |
| `maven-*`, `nuget-*` | maven2 / nuget | 8081 (path) | created in the UI, live only in the database |

`docker-cache`, the hosted registry behind port 5002, was **deleted on
2026-09-16**. It had served zero successful requests in the three weeks of
retained logs: every `GET /v2/token?account=ci` answered `401`, so BuildKit's
`type=registry` cache never imported or exported a layer. Dagger 1.0 removed
registry cache export entirely (`../dagger/README.md`), so nothing would use it
again either.

In-cluster clients use cluster DNS, e.g.
`nexus.nexus.svc.cluster.local:5001/gitleaks/gitleaks:v8.30.1`. The chart-managed
ClusterIP Service is named `nexus` because of `fullnameOverride: nexus`, which is
what keeps that DNS name stable at `nexus.nexus.svc:8081`.

`nexus-lb` is a separate Service so the chart-managed ClusterIP stays untouched
for in-cluster traffic. It exists so `docker pull <lb-ip>:5001/...` and the UI
work from a workstation for debugging. Its `http` port targets the chart's named
container port `http`; the three docker ports use numeric targets because the
connector ports are fixed by each repo's `docker.httpPort` in the HelmRelease.
Its selector must match the pod labels the chart stamps (`selectorLabels` in the
chart's `_helpers.tpl`, release name `nexus`).

The Service was originally served by k3s ServiceLB (Klipper) on the node IP, and
port 8081 was chosen because 80/443 were already claimed by the Traefik ServiceLB
hostPorts. On Talos there is no ServiceLB: the external IP now comes from Cilium
LB-IPAM (pool `192.168.1.110-130`, `nexus-lb` = `192.168.1.110`). A Cilium
Gateway `HTTPRoute` for hostname `nexus.staging.lan` → `nexus-lb:8081` gives the
UI an L7 path; it lives outside this directory, in
`infrastructure/controllers/base/cilium/config/gateway.yaml`. The docker connector
ports (5000-5002, TCP) stay on the `nexus-lb` LoadBalancer directly. See
[../../../../documentations/08-cilium-cni-ingress-migration.md](../../../../documentations/08-cilium-cni-ingress-migration.md).

### Overlays

`infrastructure/services/staging/nexus/` is the only overlay. It pulls in
`../../base/nexus` and adds `nexus-root-password.enc.yaml`, the SOPS-encrypted
Secret named `nexus-root-password` with key `password`. The HelmRelease's
`rootPassword.secret` / `rootPassword.key` point at it, and the compaction
CronJob reads the same Secret for its `NEXUS_PW` env var. Both are reconciled by the
`infrastructure-services` Flux Kustomization (SOPS-enabled).

## Why it is like this

### Storage: 30Gi on LINSTOR, one replica

`data-nexus-0` is `ssd-single` (LINSTOR, `placementCount: 1`, node-local), on
node-1's NVMe. It was 350Gi on Ceph RBD, then 150Gi here, and **30Gi since
2026-09-16**, when the Docker formats moved to Harbor: what remains is the PyPI
proxy's blobs and the Nexus database, measured at 6.4 GB in total. One replica,
because the artifacts are re-downloadable; losing the node holding it takes Nexus
down until it returns, and losing the volume costs a cold cache.

The database is the part that is **not** re-downloadable. The maven and nuget
repositories, the cleanup policies, and the accepted EULA live only there, so a
storage migration copies the volume instead of starting empty — the opposite of
the 2026-08-21 Ceph move, which discarded it.

#### Resizing means migrating, and XFS never shrinks

`volumeClaimTemplates` is immutable and the filesystem is XFS, which has no
shrink operation at all. Growing is an edit of `size` plus a PVC patch; shrinking
is a copy. The 150Gi → 30Gi move, in order:

```bash
flux suspend helmrelease nexus -n flux-system          # Flux must not fight the edit
kubectl -n nexus scale statefulset nexus --replicas=0  # H2 is not safe to copy hot
# a maintenance pod pinned to node-1 mounts the old PVC and a new 30Gi one,
# then: cp -a /old/. /new/   (verify with du -sb and a file count on both)
kubectl patch pv <new-pv> -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
kubectl -n nexus delete statefulset nexus              # frees the immutable template
kubectl -n nexus delete pvc data-nexus-0               # old volume, Retain keeps it
# clear the new PV's claimRef, then recreate PVC data-nexus-0 with volumeName: <new-pv>
flux resume helmrelease nexus -n flux-system           # Helm recreates the StatefulSet
```

Keep the old PV `Retain`ed until the rebuilt Nexus has been verified, then delete
it by hand — nothing else reclaims it.

### JVM and resources

`install4jAddVmParams: "-Xms1g -Xmx2g -XX:MaxDirectMemorySize=2048m"` keeps the
heap modest for a homelab. If Nexus OOMs under heavier use, raise `-Xmx` and the
container memory limit together. The HelmRelease `timeout` is 10m because Nexus
boots slowly (2min+) and helm-controller needs room to wait.

### Node affinity

Pod placement prefers `staging-controlplane-1`. The original rationale was
Longhorn data locality — a replica on every node meant node-1 read its copy
locally. **That rationale is dead twice over**: it already predated the
one-replica decision, and on Ceph RBD every read crosses the network to whichever
OSDs hold the PGs, so no node is closer to the data than any other. The rule is
soft (preferred) and now costs nothing either way; it is kept only so the pod has
a stable home across reschedules.

### Anonymous access and realms

`config.anonymous.enabled: true` allows anonymous pulls. The `DockerToken` realm
is enabled alongside `NexusAuthenticatingRealm` because Docker clients
authenticate via token even for anonymous pull. `forceBasicAuth: false` on the
docker repos keeps anonymous pull working — for `docker-cache` this matters
because the e2e `cache-from` path has no login; pushes still need auth.
`writePolicy: allow` on `docker-cache` exists because the `:buildcache` tag is
overwritten on every build.

### Two cleanup policies, keyed on different criteria

`purge-stale` (`lastDownloaded: 1209600`, i.e. 14 days, `ALL_FORMATS`) is applied
to the three proxy-ish repos. Re-pulling base images from upstream is costly, so
the proxies keep a 14-day window.

`docker-cache` gets `purge-buildcache` (`lastBlobUpdated: 345600`, i.e. 4 days,
`docker`) instead. BuildKit in `mode=max` overwrites the `:buildcache` tag every
build; the old manifest goes **untagged** but Nexus keeps it and its unique layer
blobs forever. A never-downloaded dangling manifest can never match a
`lastDownloaded` policy, because it was never pulled by tag. That leak reached
roughly 215GB of orphans. Keying on `lastBlobUpdated` (age since last write)
fixes it: the live `:buildcache` is rewritten every build so it stays fresh and
survives, while each dangling manifest is never rewritten, ages out in 4 days,
gets reaped, and `assetBlob.cleanup` frees its blobs. The cost is that any
manifest in that hosted repo not rewritten inside the window is deleted no matter
how often it is pulled.

### Why compaction is a CronJob and not `config.tasks`

Nexus cleanup policies and every Docker push only **soft-delete** blobs; the bytes
stay on disk until a `blobstore.compact` task physically frees them. There was no
such task, so the `default` blob store grew unbounded and filled the PVC to 99% —
about 270GB of dead direct-path Docker-upload blobs
(`deletedReason=Docker upload cleaned up`, written by every BuildKit push to
`docker-cache`). Running compaction reclaimed it to 20% (67G/344G).

Returning those freed blocks to the *storage layer* is a second, separate step.
On Longhorn a daily `filesystem-trim` RecurringJob (04:00) did it. **Ceph has no
equivalent RecurringJob** — RBD relies on discard being issued against the
filesystem instead. Compaction still frees space inside the volume either way, so
Nexus never runs out; what is lost is the pool-level reclaim, which means
`rbd du` will over-report until something issues a trim. Worth an `fstrim`
CronJob if pool usage becomes tight.

The chart cannot provision the task. Nexus 3.92 runs on JDK 25 — every 3.92.2
image tag does (plain, `-alpine`, `-ubi`); there is no `-java17` variant. The
chart provisions tasks **and** cleanup policies through the deprecated Groovy
scripting API, whose bundled compiler cannot read JDK 25 class files:

```
Unsupported class file major version 69   (HTTP 500 from /service/rest/v1/script/...)
```

So `config.tasks` and `config.cleanup` silently fail to apply on this JVM.
Pinning a different `image.tag` cannot help (all 3.92.2 tags are JDK 25), and
downgrading Nexus is unsafe because the database migrations are one-way.

The compact task itself is plain Java and runs fine on JDK 25 — only its
*provisioning* had to route around Groovy. `compact-task-cronjob.yaml` creates
the task through **ExtDirect**, the UI's own API, which is JDK-independent. It is
idempotent (it exits early if a `blobstore.compact` task named
`Compact blob store - default` already exists), so GitOps owns the task and it
survives a PVC wipe. The task then self-schedules its own nightly run at 03:00
UTC via the Nexus scheduler. The CronJob runs at 02:00 UTC, an hour ahead, so a
task lost to a PVC wipe is recreated in time for that night's compaction. Its
container image `docker.io/alpine/k8s:1.31.2` is the same one the chart uses for
its own config Job (it has `curl`, `jq` and `sh`).

## Traps

- **Cleanup-policy edits silently no-op.** The existing `config.cleanup` policies
  only work because they were provisioned before the JDK bump. Changing them in
  `release.yaml` will not take effect until Nexus ships a Groovy that supports the
  running JVM, so the YAML and the live configuration can diverge with nothing
  detecting it. Same for `config.tasks`.
- **Each `docker.httpPort` must be unique across repos.** A collision makes the
  chart's config Job fail with `status code 400`, the connector never opens, and
  CI sees `connection refused` on pulls with the real error only in the Job's
  logs. This has happened; the duplicate `ghcr` repo colliding on port 5000 had to
  be removed.
- **`storageClassName` and `volumeClaimTemplates` are immutable.** Changing the
  storage class or resizing means deleting the StatefulSet and the PVC. This is
  what the 2026-08-21 move to `ceph-block` had to do, what the 2026-09-16 shrink
  to 30Gi had to do, and what previously latched the release `Stalled` for two
  weeks when git said 350Gi and the live template still said 250Gi. Push the size
  change and delete the StatefulSet in the same window: git and the live template
  disagreeing is exactly the state that stalls the release.
- **The blob store is a single-replica SSD volume.** It runs on `ssd-single`
  (LINSTOR `placementCount: 1`), chosen 2026-08-24: a proxy cache is rebuildable
  from upstream, so paying for a DRBD replica would double the space for nothing.
  Two consequences. The node holding the replica going down takes Nexus down
  until it returns — the volume does not follow the pod. And the `ssd` pool is
  LVM-thin and shared with every CNPG database, so a runaway cache can exhaust
  the pool and break the databases on that node; that risk, not the disk size,
  is why it is 30Gi rather than the old 350Gi: LINSTOR places it on node-1,
  whose pool is only 223 GiB and already carries ~50 GiB of database replicas.
- **It is not on `hdd` on purpose.** A SeaweedFS PVC's quota counts every
  replica, so `hdd` would have given half the requested size, on spindles
  measured at 26–49 MB/s.
- **A recreated PVC comes back with the EULA un-accepted, and every Docker pull
  403s.** Nexus CE keeps acceptance in its database *on the volume*, so it is not
  in git and does not survive a volume recreate. The symptom reads like an auth
  problem — `403 Forbidden` on `/v2/` with no `WWW-Authenticate` header — but the
  body says `You must accept the End User License Agreement`. `nexus-ensure-eula`
  now asserts it hourly; before that CronJob existed, the 2026-08-21 Ceph move
  broke every CI Docker pull until it was accepted by hand.
- **The EULA API is POST, not PUT, and the disclaimer must be byte-exact.** `PUT`
  returns 405. A hand-written disclaimer returns 500 `Invalid EULA disclaimer` —
  the string contains typographic quotes. Round-trip the `GET` body and flip
  `accepted`, which is what the CronJob does.
- **Redundancy is a pool property on Ceph, not a volume one.** There is no
  per-volume replica count to re-assert after a PVC recreate — the old Longhorn
  trap here (a rebuilt PVC silently returning to 3 replicas) no longer applies.
- **The ExtDirect create call needs `timeZoneOffset`.** With
  `schedule: "advanced"` and no explicit `timeZoneOffset`, the create returns 400
  with the message `offsetId`. The cron string in that payload is Quartz format
  (`sec min hour ...`), not the five-field Kubernetes format used by the CronJob's
  own `schedule`.
- **`nexus-lb`'s selector must match the chart's pod labels**
  (`app.kubernetes.io/name: nexus3`, `app.kubernetes.io/instance: nexus`,
  `app.kubernetes.io/component: repository`). A chart bump that changes
  `selectorLabels` silently leaves the Service with no endpoints.
- **`fullnameOverride: nexus`** is what pins the in-cluster DNS name to
  `nexus.nexus.svc`. Every CI reference and the CronJob's `BASE` URL depend on it.
- **Docker connector ports are plain HTTP** (no TLS). Runner dockerd instances
  only reach them because the dind template passes `--insecure-registry` for each
  host and port form; see doc 04.

## Operating it

Render check before commit:

```bash
kubectl kustomize infrastructure/services/staging/nexus
```

Trigger a compaction immediately instead of waiting for 03:00:

```bash
PW=$(kubectl -n nexus get secret nexus-root-password -o jsonpath='{.data.password}' | base64 -d)
ID=$(kubectl -n nexus exec nexus-0 -c nexus3 -- env NP="$PW" sh -c \
  'curl -s -u admin:$NP http://localhost:8081/service/rest/v1/tasks' \
  | jq -r '.items[]|select(.type=="blobstore.compact")|.id')
kubectl -n nexus exec nexus-0 -c nexus3 -- env NP="$PW" sh -c \
  "curl -s -X POST -u admin:\$NP http://localhost:8081/service/rest/v1/tasks/$ID/run"
```

Check what the volume is actually consuming in the Ceph pool:

```bash
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- rbd -p ceph-blockpool du
```

Check external reachability:

```bash
kubectl -n nexus get svc nexus-lb                        # EXTERNAL-IP from the Cilium pool
curl http://<nexus-lb-ip>:8081/                          # UI, L4 path
curl -H 'Host: nexus.staging.lan' http://<gateway-ip>/   # UI via the Cilium Gateway
```

When the CronJob fails, its pod logs say which stage failed:
`ERROR: nexus API not reachable` (30 attempts, 5s apart, against
`/service/rest/v1/status`) or `ERROR: task create failed` (the ExtDirect POST did
not return `result.success`).
