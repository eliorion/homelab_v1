# arc-runner-set

The runner half of the self-hosted GitHub Actions stack: three
`gha-runner-scale-set` HelmReleases that register three runner pools with GitHub
for the `Eliorion/asp` repository. Each pool is an `AutoscalingRunnerSet`
consumed by the ARC controller, which turns a queued job into a one-shot
ephemeral pod in the `arc-runners` namespace and deletes it when the job ends.
`self-hosted-arc` is the default pool for ordinary jobs; `self-hosted-arc-e2e` runs
the e2e lane on the dev platform, two at a time, with no dind. A third pool,
`self-hosted-arc-xl` (bigger runners for the k3d e2e leg), was deleted on 2026-09-16 — see
"The XL pool is gone" below. The operator half
(CRDs, controller Deployment, the `arc-systems` / `arc-runners` namespaces and
the shared `HelmRepository/arc`) lives in
[`infrastructure/controllers/base/arc/`](../../../controllers/base/arc/README.md).
The whole CI stack, runners plus the Nexus dependency cache they pull through,
is described in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `release.yaml`, `release-e2e.yaml`, `github-pat.enc.yaml`. |
| `release.yaml` | `HelmRelease/arc-runner-set-asp` in `flux-system`, `targetNamespace: arc-runners`, chart `gha-runner-scale-set` pinned to `0.14.2`, reconcile interval 30m / chart interval 12h. Registers the scale set `self-hosted-arc`, `minRunners: 5` / `maxRunners: 25`, with a hand-written dind pod template. |
| `release-e2e.yaml` | `HelmRelease/arc-runner-set-asp-e2e`, same chart, namespace and secret. Registers `self-hosted-arc-e2e`, `minRunners: 0` / `maxRunners: 2` — the e2e lane's concurrency, sized to the platform quota. Runner container only (no dind, non-root, no privilege escalation): the job drives the in-cluster Dagger engine and reads Secret `dev-platform/vc-e2e-runner` (Role in `infrastructure/services/dev/dev-platform/runner-access.yaml`). |
| `release-dagger.yaml` | `HelmRelease/arc-runner-set-asp-dagger`, same chart, `targetNamespace: arc-dagger`. Registers `self-hosted-arc-dagger`, `minRunners: 6` / `maxRunners: 20` — the **lean pool**: runner container only, non-root, seccomp `RuntimeDefault`, in a namespace that enforces PSA `restricted`. Every asp job that only drives the remote Dagger engine or reads git runs here (asp variable `CI_RUNNER_DAGGER`). |
| `network.yaml` | CiliumNetworkPolicy `runner-boundary` in `arc-runners` and in `arc-dagger`: deny-only fences around the runners (below). |
| `github-pat.enc.yaml` | SOPS-encrypted Secret `arc-github-pat` (classic PAT with `repo` scope on `Eliorion/asp`). Every release points at it through `githubConfigSecret`. Never commit it decrypted. |
| `github-pat-reflection.yaml` | Plaintext patch adding reflector annotations to `arc-github-pat`, so reflector mirrors it into `arc-dagger` (the chart reads the secret from its own namespace). The `ghcr-pull-secret-namespaces.yaml` pattern: a metadata patch, no sops edit. |

The default release carries this pod template shape:

- `init-dind-externals` — an init container that copies `/home/runner/externals`
  into a shared `dind-externals` emptyDir, because the dind container expects
  them there.
- `dind` — `docker:dind` running `dockerd` as a **native sidecar**
  (`restartPolicy: Always` on an entry in `initContainers`), `privileged: true`,
  `DOCKER_GROUP_GID=123` and a `docker info` startup probe (2s period, 24
  failures). It carried six `--insecure-registry` flags for the Nexus connectors
  until 2026-09-16; see below.
- `runner` — `ghcr.io/actions/actions-runner:latest` running
  `/home/runner/run.sh` with `DOCKER_HOST=unix:///var/run/docker.sock` and
  `RUNNER_WAIT_FOR_DOCKER_IN_SECONDS=120`.
- Three emptyDirs: `work` (`/home/runner/_work`), `dind-sock` (`/var/run`, the
  shared docker socket) and `dind-externals`.

Sizing as the manifests currently declare it:

| Pool | Runners | runner container | dind sidecar |
|---|---|---|---|
| `self-hosted-arc` | min 5 / max 25 | req 500Mi, limit 4Gi | req 500Mi, limit 6Gi, no CPU limit |
| `self-hosted-arc-e2e` | min 0 / max 2 | req 100m CPU + 512Mi, limit 2Gi | none |
| `self-hosted-arc-dagger` | min 6 / max 20 | req 100m CPU + 384Mi, limit 2Gi | none |

Flux applies this directory as part of the `infrastructure-services`
Kustomization (`clusters/staging/infrastructure.yaml`, `path:
./infrastructure/services/staging`, `prune: true`, SOPS decryption via the
`sops-age` secret). That Kustomization `dependsOn` `infra-arc-controller`,
because these releases declare ARC custom resources and need the CRDs to exist
first.

### Overlays

There is no `base/` for this component: it exists only
under `infrastructure/services/staging/`, listed as `arc-runner-set/` in
`infrastructure/services/staging/kustomization.yaml`. The CI stack as a whole is
staging-only. The three releases in this directory are the pool split —
default and e2e — not two environments.

## Why it is like this

**The dind sidecar is hand-written instead of `containerMode: dind`.** The
chart's `containerMode: dind` injects a fixed sidecar that accepts no extra
`dockerd` flags. The Nexus Docker connectors were plain HTTP, so `dockerd`
refused them unless every host:port form was whitelisted with
`--insecure-registry`. The template here reproduces what `containerMode: dind`
would have injected — the externals init container, native sidecar semantics,
the socket and externals volumes, the runner's `DOCKER_HOST`.

**The six flags were removed on 2026-09-16.** CI pulls now go to Harbor over a
publicly trusted certificate, which needs no whitelist, so the only reason this
template existed is gone. Switching to `containerMode: dind` is therefore
possible and is *not* done here: it is a separate change, and the hand-written
template still buys the per-container memory limits and the startup probe. If it
is taken, re-read
[14-design-decisions.md](../../../../documentations/14-design-decisions.md)
("A hand written dind template instead of the chart's `containerMode: dind`")
first.

Caching stays opt-in per workflow line either way: `dockerd` is given no
`--registry-mirror`, and it **cannot** usefully be given one here — Docker's
mirror support is Docker-Hub-only and accepts no path, so a Harbor proxy-cache
project cannot be a transparent mirror for it. Measured 2026-09-16 with
`--registry-mirror=https://registry.eliorion.fr/v2/dockerhub-proxy`: `dockerd`
requested `/v2/dockerhub-proxy/v2/library/busybox/manifests/1.37`, got a 404 and
silently pulled from Docker Hub instead. Pull by full name
(`registry.eliorion.fr/dockerhub-proxy/library/busybox:1.37`) or not at all —
that is what the `DOCKERHUB_MIRROR` / `GHCR_MIRROR` variables in the `asp` repo
now hold.

**Only the default pool keeps runners warm.** It holds 5 for fast PR feedback, roughly
15Gi permanently resident on a 3-node cluster with about 50Gi total. The e2e pool starts
from zero: its lane runs minutes-long jobs on the dev platform, so one pod start is
cheaper than two idle runners.

**Memory is capped, CPU is not.** Each dind sidecar has a memory limit so a
runaway build cannot consume a whole node and OOM-evict a co-located e2e pod —
6Gi is already generous for the single-service image builds the default pool
runs. There is deliberately no CPU limit on either pool: CPU is compressible
and these builds are short, so an uncapped sidecar keeps PR feedback and the
parallel docker builds fast. All three nodes are control planes with no kubelet
`system-reserved`, so if etcd shows latency under heavy e2e, the answer is to
reserve CPU at the kubelet level rather than to cap the build here.

**The XL pool is gone (2026-09-16).** It existed for one job: the k3d e2e leg, whose whole
stack ran inside a dind sidecar big enough to hold a cluster, one pod per node. asp moved
that gate to the dev-platform vcluster (`self-hosted-arc-e2e`, no dind at all), leaving the
k3d path as a manual `e2e-tests.yaml` dispatch, which now lands on the default pool. Two
warm XL runners for a workflow nobody triggers was the whole cost. If a break-glass k3d run
ever OOMs the default pool's 6Gi dind, the answer is a bigger dind there or this file back
from git history — not a permanently resident pool.

**Both pools export Dagger telemetry to the in-cluster collector, not to Dagger
Cloud.** The runner container carries `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`
and one endpoint per signal on `alloy-receiver.monitoring.svc.cluster.local:4318`
(see [`monitoring/controllers/base/alloy`](../../../../monitoring/controllers/base/alloy/README.md)).
The `dagger` CLI is the exporter: it pulls the engine's spans, step logs and
metrics over the session and forwards them, so only the runner pod needs to reach
the collector and the engine StatefulSet carries no `OTEL_*` variable. Traces land
in Tempo, step stdout/stderr in Loki (`service_name="dagger-engine"`, correlated by
`trace_id`), CLI metrics in Prometheus. The `dagger-ci` Grafana dashboard reads all
three — [`monitoring/configs/staging/dagger-ci`](../../../../monitoring/configs/staging/dagger-ci/README.md).
Setting it on the runner rather than in each workflow of the `asp` repository
covers every job without touching that repository; a job on a GitHub-hosted
fallback runner simply exports nothing.

**The two pools share one PAT secret.** `arc-github-pat` lives in `arc-runners`
and both releases reference it; there is one credential for the one repository
they both serve.

**Both chart versions are pinned and move together.** `gha-runner-scale-set`
here and `gha-runner-scale-set-controller` in
`infrastructure/controllers/base/arc/release.yaml` are all `0.14.2`. Renovate
bumps them separately and nothing enforces the rule but a comment and a human.

**Runners spread across nodes, softly** (2026-10-06). Both templates carry a
`topologySpreadConstraints` entry on `kubernetes.io/hostname`, keyed on
`actions.github.com/scale-set-name`. Before it, every runner of both pools sat on
node-1, so a burst of Rust builds (~16 `rustc` each) landed on the node already
carrying the Dagger engine and the scraper workers, and node-1's memory pressure
fed the Talos OOM controller (`../../../controllers/base/linstor/README.md`).
`whenUnsatisfiable: ScheduleAnyway` makes it a scoring preference: when node-2 or
node-3 is full, the runner still schedules wherever it fits rather than leaving a
CI job pending.

**The lean pool (2026-10-08).** A runner in the default pool reserves ~1Gi and may grow to 10Gi
with a privileged dind sidecar, yet nearly every asp job runs only `dagger call` against the
in-cluster engine: the sidecar is memory and privilege spent on nothing. `self-hosted-arc-dagger`
is the e2e pool's shape (no dind, uid 1001, all capabilities dropped) plus seccomp
`RuntimeDefault`, in its own namespace `arc-dagger` labelled PSA `restricted` (enforce, audit,
warn) — `arc-runners` stays `privileged` only for the dind pool. Six warm runners match asp's
matrix `max-parallel: 6`, for ~2.3Gi of requests instead of the default pool's ~5Gi for five.
The engine's exec RoleBinding names its ServiceAccount (`../../base/dagger/rbac.yaml`).
Fork pull requests never land here (asp routes them to `CI_RUNNER`): they get an ephemeral
engine, which needs Docker.

**Cutover, in order.** (1) Merge; check `arc-runner-set-asp-dagger` registered (a listener in
`arc-systems`, the scale set online under the repo's runners) and `arc-github-pat` was reflected
into `arc-dagger`. (2) Set `CI_RUNNER_DAGGER=self-hosted-arc-dagger` in `Eliorion/asp`; unset,
asp uses `CI_RUNNER` exactly as before. (3) Once a week of PRs ran green on it, shrink the default
pool to what still needs Docker — secrets-scan, pipeline-audit, the release workflows, fork PRs,
the break-glass k3d run: `minRunners: 1`, `maxRunners: 6`.

**The baked runner image.** asp publishes `ghcr.io/eliorion/ci-runner` (workflow
`ci-runner-image.yaml`): this runner plus dagger, kubectl, gh, yq and jq at asp's
`versions.env` pins, each checksum-verified, trivy-gated and cosign-signed. Pin its **digest**
(the workflow's summary prints it) in place of `actions-runner` in any pool; `arc-dagger` already
has the `ghcr-pull-secret` it needs (reflector). A job still runs `ensure-tool.sh`, which now keeps
a CLI on PATH only at the pinned version, so an image older than a pin bump costs one download,
never a stale CLI. Keep the stock image's version in step with `ACTIONS_RUNNER_VERSION` there.

**Deny boundaries around the runners (`network.yaml`).** PR code runs in these pods, the dind
pool's as root in a privileged container. Each runner namespace gets one deny-only
CiliumNetworkPolicy, the dev-platform pattern: `enableDefaultDeny: false`, so nothing that is
not denied changes, and a deny wins over every allow. Denied:

- private ranges outside the cluster — `10/8`, `172.16/12`, `192.168/16`, the tailnet's
  `100.64/10`, link-local. CIDR rules never select pods, nodes or a Service's translated backend
  (Cilium translates the Harbor and Nexus LoadBalancer IPs at the socket), so this takes out the
  router, the NAS and every tailnet admin surface and nothing a job uses. The LB-IPAM pool
  (`192.168.1.110-130`, `../../../controllers/base/cilium/config/pool.yaml`) is excepted all the
  same: those VIPs are the cluster's own LAN-published services, and the except keeps Harbor and
  Nexus reachable on a path socket-LB does not translate (a nested container's netns, a Gateway
  VIP). Move the pool, move the except;
- node host ports: kubelet `10250`, Talos `50000`/`50001`, etcd `2379`/`2380`. Not the whole
  `host`/`remote-node` entities: the API server runs on them, and `kube-pod://` reaches the engine
  through it;
- every namespace but the runners' own, `kube-system` (DNS), `monitoring` (the OTLP receiver),
  `registry` (Harbor) and `nexus`. Each `NotIn` sits beside an `Exists` on the same key: a
  `NotIn` alone also matches identities with no namespace label — `world`, `host`,
  `kube-apiserver` — and only Cilium 1.19's `clustermesh.policyDefaultLocalCluster: true` (an
  implicit local-cluster term those identities lack) keeps it from cutting every job off GitHub
  and the API server. `Exists` makes that independent of the default;
- ingress from the world and from every other namespace.

A job that newly needs an in-cluster service is a one-word change to the `NotIn` list. Find
what a policy dropped with `hubble observe --namespace arc-dagger --verdict DROPPED`.

## Traps

- **`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` must be set explicitly, with the full
  `/v1/logs` path.** Dagger (`dagger/otel-go`) deliberately ignores the base
  `OTEL_EXPORTER_OTLP_ENDPOINT` for logs, and the Go exporter uses the path as
  written. Collapse the three variables into the base endpoint and traces keep
  flowing while every step's output silently disappears. Keep `http/protobuf`:
  Dagger's gRPC log path is unfinished (`FIXME` in source) and gRPC's 4MiB message
  cap is smaller than a large Dagger span batch.
- **Every OTel SDK in a job inherits these variables.** A test suite or tool
  instrumented with OpenTelemetry will also export to the collector. That is
  harmless, but it is where unexpected `service_name` values in Loki and Tempo
  come from. Do not set `OTEL_EXPORTER_OTLP_TRACES_LIVE`: it sends every span
  twice.
- **An unreachable collector can slow or hang the CLI** (dagger/dagger#8605,
  `failed to emit telemetry … deadline exceeded`). `alloy-receiver` is therefore a
  plain Deployment behind a ClusterIP Service; if CI suddenly stalls at the end of
  a `dagger call`, check that pod before the engine.
- **The two ARC chart versions must match.** `gha-runner-scale-set` `0.14.2` in
  both files here and `gha-runner-scale-set-controller` `0.14.2` in
  `infrastructure/controllers/base/arc/release.yaml`. Align them in the same
  merge, and re-check the hand-written dind template against upstream on any
  bump past `0.14.x`.
- **`runnerScaleSetName` is the contract with the workflow files.**
  `self-hosted-arc` and `self-hosted-arc-e2e` are what `runs-on:` targets in
  `Eliorion/asp` (`CI_RUNNER`, `CI_RUNNER_E2E`). The names must stay distinct: a scale set
  name has to be unique.
- **Re-adding a plain-HTTP registry means re-adding `--insecure-registry`.**
  `dockerd` refuses HTTP registries, and the chart's `containerMode: dind`
  accepts no extra flags — that constraint is what the hand-written template was
  built for, and it applies again the moment a workflow points at something
  without TLS.
- **Workflows pull Harbor by full name.** `registry.eliorion.fr/<project>/<repo>`
  over TLS, from the `DOCKERHUB_MIRROR` / `GHCR_MIRROR` variables in
  `Eliorion/asp`. Any other spelling silently bypasses the cache and goes
  upstream.
- **`restartPolicy: Always` on the `dind` initContainer is what makes it a
  native sidecar.** Remove it and `dind` becomes a blocking init container that
  never completes.
- **The privileged dind sidecar needs the namespace label.** `arc-runners`
  carries `pod-security.kubernetes.io/enforce: privileged` in
  `infrastructure/controllers/base/arc/namespace.yaml`. Without it Talos'
  cluster-wide `baseline` enforcement fails every runner pod with
  `violates PodSecurity "baseline:latest": privileged (container "dind" must not
  set securityContext.privileged=true)`.
- **`github-pat.enc.yaml` is SOPS ciphertext.** Edit it only through `sops`, and
  never commit it decrypted. Its reflector annotations live in `github-pat-reflection.yaml`,
  a plaintext patch: a pool in a new namespace needs that namespace added there.
- **`arc-dagger` enforces PSA `restricted`.** A template field it forbids (a privileged or
  root container, a hostPath, a missing seccomp profile) fails every runner pod at admission,
  silently from GitHub's side: jobs just queue. Watch `kubectl -n arc-dagger get ephemeralrunner`.
- **The dind image is pinned by digest** (`docker:<version>-dind@sha256:…`). It runs
  privileged; a floating `docker:dind` pulled a new daemon into every runner pod start. Renovate's
  regex manager bumps tag and digest together.
- **The sizing prose has drifted from the manifests.** The sizing notes in
  [04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md)
  quote `maxRunners: 10` for the default pool, and describe an XL pool that no longer
  exists. The values in this directory are authoritative: default 5/25 with a 1Gi/6Gi dind,
  e2e 0/2 with no dind.

## Operating it

Render check before commit, then the usual Flux status:

```sh
kubectl kustomize infrastructure/services/staging/arc-runner-set
flux get kustomizations              # infrastructure-services Ready
flux get helmreleases -A             # arc-runner-set-asp, arc-runner-set-asp-e2e Ready
```

Where to look when it breaks:

```sh
kubectl -n arc-systems get pods      # one listener pod per scale set
kubectl -n arc-runners get pods,autoscalingrunnerset
kubectl -n arc-runners get pods -w   # watch a pod spawn for a queued job
```

In GitHub: `Eliorion/asp` > Settings > Actions > Runners should list
`self-hosted-arc` and `self-hosted-arc-e2e` online.

After fixing a Pod Security or template problem, clear the stuck runners so the
controller recreates them clean:

```sh
kubectl -n arc-runners delete ephemeralrunner --all
```

Before raising either `maxRunners`, confirm the dind peak stays under its limit
during a real run:

```sh
kubectl top pod -n arc-runners --containers
```

Deep detail — registration and scaling flow, the Nexus proxy repositories and
their ports, workflow snippets for pip and buildx, and the full troubleshooting
list including the `too many open files` inotify fix — is in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).
