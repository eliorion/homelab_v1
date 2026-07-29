# CI: Self-hosted GitHub runners (ARC) + Nexus dependency cache

Staging-only. Two components:

- **ARC** (actions-runner-controller, `gha-runner-scale-set` mode) — ephemeral
  GitHub Actions runners for `Eliorion/asp`, scaling 0→5 pods on demand.
- **Nexus Repository OSS 3** — in-cluster PyPI proxy + Docker registries so
  dependencies and images are cached locally between CI runs. Deployed with
  the `stevehipwell/nexus3` Helm chart (StatefulSet), which provisions all
  repos declaratively via its config Job — no manual Nexus setup.

## Nexus repositories

| Repo | Type | Port | Use |
|---|---|---|---|
| `pypi-proxy` | pypi proxy | 8081 (path) | pip cache |
| `docker-hub` | docker proxy → registry-1.docker.io | 5000 | Docker Hub pull-through |
| `ghcr` | docker proxy → ghcr.io | 5001 | GHCR pull-through |
| `docker-cache` | docker hosted | 5002 | buildx `:buildcache` push/pull |

Docker connector ports are plain **HTTP** (no TLS yet) — see the dind
section below for the `--insecure-registry` consequence. Each `httpPort`
must be unique across repos; a port collision makes the config Job fail
with `status code 400` and the connector never opens (`connection refused`
on pulls).

In-cluster pulls use cluster DNS, e.g.:

```
nexus.nexus.svc.cluster.local:5001/gitleaks/gitleaks:v8.30.1
```

A separate `nexus-lb` LoadBalancer Service
(`infrastructure/services/base/nexus/services.yaml`) exposes 8081 +
5000-5002 on the node IP for workstation debugging.

## How it works, end to end

```
GitHub (Eliorion/asp)                      k3s cluster
─────────────────────                      ───────────────────────────────────
workflow queued                            arc-systems namespace
  runs-on: self-hosted-arc  ◄── long poll ── listener pod (one per scale set)
        │                                       │ "1 job queued"
        │                                       ▼
        │                                  gha-runner-scale-set-controller
        │                                       │ creates EphemeralRunner
        │                                       ▼
        │                                  arc-runners namespace
        └── job runs on ──────────────►    runner pod (ephemeral, 1 job max)
                                            ├─ runner container (run.sh)
                                            └─ dind sidecar (dockerd)
                                                 │ docker pull/push
                                                 ▼
                                           nexus namespace
                                           nexus-0 (StatefulSet)
                                            ├─ :8081 UI + pypi-proxy
                                            ├─ :5000 docker-hub proxy
                                            ├─ :5001 ghcr proxy
                                            └─ :5002 docker-cache (hosted)
                                                 │ cache miss
                                                 ▼
                                           registry-1.docker.io / ghcr.io / pypi.org
```

1. **Registration** — the `gha-runner-scale-set` Helm release registers a
   scale set named `self-hosted-arc` with GitHub, authenticating with the
   `arc-github-pat` Secret. GitHub shows it under the repo's
   Settings > Actions > Runners.
2. **Scaling** — the listener pod long-polls GitHub. When a workflow with
   `runs-on: self-hosted-arc` queues a job, the controller creates an
   ephemeral runner pod (`minRunners: 0`, `maxRunners: 5`). One pod = one
   job; the pod is deleted after the job ends, so every job starts clean.
3. **Docker** — each runner pod carries its own dockerd as a native sidecar
   (manual dind template). Workflow `docker` commands hit that daemon via
   the shared unix socket (`DOCKER_HOST=unix:///var/run/docker.sock`).
4. **Caching** — image pulls go through the Nexus proxies instead of
   upstream: first pull fills the cache, repeat pulls are LAN-fast and
   don't burn Docker Hub rate limits. Buildx pushes layer cache to the
   hosted `docker-cache` repo (`:buildcache` tag, overwritten each build).
   pip resolves via `pypi-proxy` the same way.
5. **Cleanup** — the `purge-stale` policy deletes anything not downloaded
   in 14 days, across all repos.

## Layout

| Component | Path | Flux Kustomization |
|---|---|---|
| ARC controller | `infrastructure/controllers/base/arc/` | `infra-arc-controller` |
| Runner scale set (asp) | `infrastructure/services/staging/arc-runner-set/` | `infrastructure-services` (SOPS) |
| Nexus | `infrastructure/services/base/nexus/` + `staging/nexus/` | `infrastructure-services` (SOPS) |

The two ARC Helm charts (`gha-runner-scale-set-controller` and
`gha-runner-scale-set`) must stay on the **same version** — Renovate bumps
both, keep them aligned when merging.

## Blob store maintenance (compaction) — and the JDK-25 / Groovy constraint

Nexus cleanup policies (and every Docker push) only **soft-delete** blobs; the
bytes stay on disk until a `blobstore.compact` task physically frees them. There
was no such task, so the `default` blob store grew unbounded and filled the PVC
to **99%** — ~270GB of dead direct-path Docker-upload blobs
(`deletedReason=Docker upload cleaned up`, written by every BuildKit push to
`docker-cache`). Running compaction reclaimed it to **20%** (67G/344G). A daily
Longhorn `filesystem-trim` (04:00) then returns the freed blocks to the volume.

**Why this is a CronJob and not the chart's `config.tasks`:** Nexus 3.92 runs on
**JDK 25** (every 3.92.2 image tag — plain, `-alpine`, `-ubi` — does; there is no
`-java17` variant). The stevehipwell chart provisions tasks **and** cleanup
policies through the deprecated Groovy scripting API, whose bundled compiler
can't read JDK 25 class files:

```
Unsupported class file major version 69   (HTTP 500 from /service/rest/v1/script/...)
```

So `config.tasks` / `config.cleanup` silently fail to apply on this JVM, and
pinning `image.tag` can't help (all 3.92.2 tags are JDK 25; downgrading Nexus is
unsafe — DB migrations are one-way). Existing cleanup policies still work because
they were provisioned before the JDK bump; **do not expect edits to
`config.cleanup` to take effect** until Nexus ships a Groovy that supports the
running JVM.

The compact **task itself is plain Java** and runs fine on JDK 25 — only its
*provisioning* had to route around Groovy. `compact-task-cronjob.yaml` ensures
the task exists via **ExtDirect** (the UI's API, JDK-independent), idempotently,
daily at 02:00 — so it survives a PVC wipe. The task then self-schedules its own
nightly compaction (03:00) via the Nexus scheduler.

```bash
# Trigger a compaction immediately (don't wait for 03:00):
PW=$(kubectl -n nexus get secret nexus-root-password -o jsonpath='{.data.password}' | base64 -d)
ID=$(kubectl -n nexus exec nexus-0 -c nexus3 -- env NP="$PW" sh -c \
  'curl -s -u admin:$NP http://localhost:8081/service/rest/v1/tasks' \
  | jq -r '.items[]|select(.type=="blobstore.compact")|.id')
kubectl -n nexus exec nexus-0 -c nexus3 -- env NP="$PW" sh -c \
  "curl -s -X POST -u admin:\$NP http://localhost:8081/service/rest/v1/tasks/$ID/run"
```

## One-time setup

### 1. GitHub PAT for runner registration

Create a PAT (classic) with `repo` scope on `Eliorion/asp`, then:

```bash
# Edit infrastructure/services/staging/arc-runner-set/github-pat.enc.yaml
# Replace REPLACE_ME with the PAT, then encrypt before committing:
sops --encrypt --in-place infrastructure/services/staging/arc-runner-set/github-pat.enc.yaml
```

Never commit the file unencrypted.

### 2. Nexus root password

The chart's config Job needs the admin password as a Secret; it sets the
password and provisions the `pypi-proxy` repo + anonymous read access
automatically:

```bash
# Edit infrastructure/services/staging/nexus/nexus-root-password.enc.yaml
# Replace REPLACE_ME with a strong password, then encrypt before committing:
sops --encrypt --in-place infrastructure/services/staging/nexus/nexus-root-password.enc.yaml
```

No manual UI/REST setup — repositories live in
`infrastructure/services/base/nexus/release.yaml` under `values.config.repos`.

## Using the runners from `Eliorion/asp` workflows

Target the scale set with `runs-on: self-hosted-arc`.

For the heavy k3d end-to-end leg, target the dedicated XL pool with
`runs-on: self-hosted-arc-xl` (wired via the `CI_RUNNER_XL` repo variable;
`e2e-tests.yaml` uses `vars.CI_RUNNER_XL || vars.CI_RUNNER`, so it falls back to
the default pool until the var is set). The XL pool
(`arc-runner-set/release-xl.yaml`) gives each runner a bigger dind sidecar
(4Gi req / 10Gi limit, no CPU limit) for the in-dind k3d cluster, `minRunners: 1`
/ `maxRunners: 3`, and a hard one-XL-pod-per-node `podAntiAffinity` so two or
three concurrent e2e runs never share a node. **Set `CI_RUNNER_XL` only AFTER
the XL scale set registers healthy** (`kubectl -n arc-systems get pods` shows
its `arc-runner-set-asp-xl-...-listener`) — setting it before the listener is up
would strand e2e jobs with no runner.

### Python (pip via Nexus proxy)

```yaml
jobs:
  build:
    runs-on: self-hosted-arc
    env:
      PIP_INDEX_URL: http://nexus.nexus.svc:8081/repository/pypi-proxy/simple
      PIP_TRUSTED_HOST: nexus.nexus.svc
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt   # first run warms the cache
```

### Flutter (pub via actions/cache)

Nexus OSS cannot proxy pub.dev (no Dart format). Use GitHub's cache action —
it works on self-hosted runners:

```yaml
      - uses: actions/cache@v4
        with:
          path: ~/.pub-cache
          key: pub-${{ hashFiles('**/pubspec.lock') }}
```

### Container builds

Runner pods run docker-in-docker, so `docker build`/`docker push` work
inside jobs. The chart's `containerMode: dind` is **not** used: it injects a
fixed dind sidecar that accepts no extra dockerd flags. Instead
`arc-runner-set/release.yaml` defines the pod template manually (ARC docs
pattern) so the dind container can pass
`--insecure-registry=nexus.nexus.svc[.cluster.local]:5000|5001|5002` —
required because the Nexus docker connectors are HTTP-only.

Consequences:

- Workflows must reference the registry with one of the whitelisted
  host:port forms (short `nexus.nexus.svc` or FQDN).
- Chart upgrades past `0.14.x` will not auto-update the dind wiring —
  re-check the template against upstream when bumping.

## Verification

```bash
flux get kustomizations            # infra-arc-controller, infrastructure-services Ready
flux get helmreleases -A           # nexus, arc-runner-set-asp Ready
kubectl -n arc-systems get pods    # controller Running
kubectl -n arc-runners get pods,autoscalingrunnerset
kubectl -n nexus get pods,pvc      # nexus-0 Running / Bound, config job Completed

# GitHub: asp repo > Settings > Actions > Runners > "self-hosted-arc" online
# Push a workflow with runs-on: self-hosted-arc and watch a runner pod spawn:
kubectl -n arc-runners get pods -w

# Test the pip proxy from inside the cluster:
kubectl run pip-test --rm -it --image=python:3.12 -- \
  pip install --index-url http://nexus.nexus.svc:8081/repository/pypi-proxy/simple \
  --trusted-host nexus.nexus.svc requests
```

## Sizing notes (3-node, ~50Gi total)

- Nexus: 1–2g JVM heap, 2.5Gi memory limit, 80Gi PVC. Raise
  `install4jAddVmParams` and the limit together if it OOMs.
- Default pool (`self-hosted-arc`, `release.yaml`): `minRunners: 5` /
  `maxRunners: 10`; runner 2Gi req / 4Gi limit, dind 2Gi req / 6Gi limit and
  **no CPU limit** (keeps PR builds fast). Max capped from 15 to 10 to leave RAM for XL.
- XL pool (`self-hosted-arc-xl`, `release-xl.yaml`): `minRunners: 1` /
  `maxRunners: 3`; dind 4Gi req / 10Gi limit, **no CPU limit** (compressible —
  keeps builds fast), one pod per node (`podAntiAffinity`). All 3 nodes are
  control planes with no kubelet `system-reserved`, so if etcd shows latency
  under heavy e2e, reserve CPU at the kubelet level rather than capping the
  build. At `maxRunners: 3`, a node-down window leaves the 3rd concurrent e2e
  Pending (queued, self-heals) — the deliberate safe failure mode.
- Bump either `maxRunners` when nodes gain headroom; watch `kubectl top pod
  -n arc-runners --containers` during an e2e run to confirm dind peak < limits.

## Troubleshooting

### Nexus HelmRelease: `cannot patch "nexus" with kind StatefulSet ... Forbidden`

`volumeClaimTemplates` (PVC size) is immutable on StatefulSets, so changing
`persistence.size` blocks every subsequent Helm upgrade.

**On Longhorn (current storage) — non-destructive.** Longhorn supports online
volume expansion, so the PVC can already be at the target size; only the STS's
immutable `volumeClaimTemplates` is stale. Recreate the STS without touching the
pod or PVC:

```bash
kubectl -n nexus delete sts nexus --cascade=orphan   # keeps nexus-0 + PVC running
flux reconcile helmrelease nexus -n flux-system --force
```

Gotcha: a plain `flux reconcile` (no `--force`) does **not** recreate the STS.
helm-controller compares its release storage (which still lists the STS) against
the desired values (unchanged) and logs `release in-sync with desired state`,
skipping the re-apply — so the orphaned STS is never recreated. `--force` forces
the Helm upgrade; with no live STS it CREATEs a fresh one at the new size (a
create, not a forbidden update), then adopts the existing `nexus-0` pod.

**On `local-path` (legacy single-node) — destructive.** That storage class did
not support expansion, so the only fix wiped Nexus data (proxy caches and
buildcache are rebuildable; repos and root password are re-applied by the config
Job):

```bash
kubectl -n nexus delete sts nexus
kubectl -n nexus delete pvc data-nexus-0
flux suspend helmrelease nexus -n flux-system   # reset exhausted retries
flux resume helmrelease nexus -n flux-system
```

### Runner logs: `to create fsnotify watcher: too many open files`

Node inotify limits exhausted (kernel default `max_user_instances=128` is
too low for k3s + ARC + dind). On the node:

```bash
echo 'fs.inotify.max_user_instances=8192
fs.inotify.max_user_watches=1048576' | sudo tee /etc/sysctl.d/99-inotify.conf
sudo sysctl --system
```

Persists across reboots via `systemd-sysctl`; running pods pick it up
immediately.

### Runner pods never spawn: `violates PodSecurity "baseline:latest": privileged`

After the move to Talos (doc 07), the listener and controller stayed
healthy — the listener saw queued jobs and scaled the `EphemeralRunnerSet`,
but every `EphemeralRunner` went `Failed` with:

```
Failed to create the pod: pods "self-hosted-arc-...-runner-..." is forbidden:
violates PodSecurity "baseline:latest": privileged (container "dind" must not
set securityContext.privileged=true)
```

Talos enforces the `baseline` Pod Security Standard cluster-wide by default;
k3s enforced nothing, so the privileged dind sidecar (required for the
manual dind template, above) used to be allowed implicitly. Fix: label the
`arc-runners` namespace to allow privileged pods, in
`infrastructure/controllers/base/arc/namespace.yaml`:

```yaml
metadata:
  name: arc-runners
  labels:
    pod-security.kubernetes.io/enforce: privileged
```

`arc-systems` does not need it — the controller and listener pass
`baseline`. After Flux reconciles, clear the stuck runners so the
controller recreates them clean:

```bash
kubectl -n arc-runners delete ephemeralrunner --all
```

### CI pull fails: `dial tcp ...:500x: connect: connection refused`

Nexus only opens a docker connector port once the repo's config applied
successfully. Check the config Job logs for a repo error (e.g. the port
collision above):

```bash
kubectl -n nexus logs job/nexus-config-<n>
```
