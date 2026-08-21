# nexus

Nexus Repository OSS 3, deployed with the `stevehipwell/nexus3` Helm chart
(StatefulSet) in the `nexus` namespace. It is the cluster's dependency cache for
CI: a PyPI proxy, two Docker pull-through proxies (Docker Hub and GHCR) and one
hosted Docker registry that holds the BuildKit layer cache. Runner pods pull
through it instead of upstream, so repeat CI runs are LAN-fast and do not burn
Docker Hub rate limits. All repositories, plus the anonymous-access and realm
settings, are provisioned declaratively by the chart's config Job — there is no
manual Nexus setup. Two things sit outside it: blob store compaction, which a
CronJob in this directory provisions, and the cleanup policies, which are live
state the Job can no longer reprovision — both for the reason described below.

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

### Repositories and ports

| Repo | Type | Port | Use |
|---|---|---|---|
| `pypi-proxy` | pypi proxy → `https://pypi.org` | 8081 (path) | pip cache |
| `docker-hub` | docker proxy → `https://registry-1.docker.io` | 5000 | Docker Hub pull-through |
| `ghcr` | docker proxy → `https://ghcr.io` | 5001 | GHCR pull-through |
| `docker-cache` | docker hosted | 5002 | buildx `:buildcache` push/pull |

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
CronJob reads the same Secret for its `NEXUS_PW` env var. There is no production
overlay: the CI stack is staging-only. Both are reconciled by the
`infrastructure-services` Flux Kustomization (SOPS-enabled).

## Why it is like this

### Storage: 350Gi on Ceph RBD

The volume is `ceph-block` (350Gi), on the Rook/Ceph HDD pool. It was Longhorn at
one replica until 2026-08-21, and the local-path provisioner on the old k3s box.

Everything in the volume is a cache, which is what made it the first thing moved
to Ceph and why the migration **discarded** it rather than copying: proxied PyPI
and Docker artifacts re-download on the next miss, and the hosted `docker-cache`
is CI output that gets rebuilt. The cost of losing it is a cold cache and slow
first CI runs, not data.

It was also the most expensive volume in the cluster — 350Gi provisioned against
roughly 310Gi actual, the single largest real consumer of Longhorn space, and the
reason routine growth elsewhere (`fbref-db`) had nowhere to go. Moving it is what
frees node-1 for the rest of the Longhorn → Ceph migration.

Redundancy is now a property of the pool, not the volume: `ceph-blockpool` runs
`size: 2` on a `failureDomain: osd`, so there is no per-volume replica count to
set or re-assert. That removes the one-replica patch this README used to carry.

**Ceph has no backup target**, exactly as Longhorn had none. Unchanged for a pure
cache. See
[../../../../documentations/14-design-decisions.md](../../../../documentations/14-design-decisions.md)
and [../../../../infrastructure/controllers/base/rook-ceph/README.md](../../../../infrastructure/controllers/base/rook-ceph/README.md).

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
  what the 2026-08-21 move to `ceph-block` had to do, and what previously latched
  the release `Stalled` for two weeks when git said 350Gi and the live template
  still said 250Gi.
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
