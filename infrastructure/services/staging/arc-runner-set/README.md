# arc-runner-set

The runner half of the self-hosted GitHub Actions stack: one
`gha-runner-scale-set` HelmRelease that registers the runner pool `self-hosted-arc` with
GitHub for the `Eliorion/asp` repository. The pool is an `AutoscalingRunnerSet`
consumed by the ARC controller, which turns a queued job into a one-shot
ephemeral pod in the `arc-runners` namespace and deletes it when the job ends.
Two pools went away: `self-hosted-arc-xl` (bigger runners for the k3d e2e leg) on
2026-09-16, and `self-hosted-arc-e2e` (the dev-platform e2e lane's pool) on 2026-10-15 — see
"Why it is like this". The operator half
(CRDs, controller Deployment, the `arc-systems` / `arc-runners` namespaces and
the shared `HelmRepository/arc`) lives in
[`infrastructure/controllers/base/arc/`](../../../controllers/base/arc/README.md).
The whole CI stack, runners plus the Nexus dependency cache they pull through,
is described in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `release.yaml`, `github-pat.enc.yaml`. |
| `release.yaml` | `HelmRelease/arc-runner-set-asp` in `flux-system`, `targetNamespace: arc-runners`, chart `gha-runner-scale-set` pinned to `0.14.2`, reconcile interval 30m / chart interval 12h. Registers the scale set `self-hosted-arc`, `minRunners: 5` / `maxRunners: 16`, with a custom pod template that holds the runner container only. |
| `github-pat.enc.yaml` | SOPS-encrypted Secret `arc-github-pat` (classic PAT with `repo` scope on `Eliorion/asp`). The release points at it through `githubConfigSecret`. Never commit it decrypted. |

**There is no Docker daemon in the pod.** A job runs `dagger call`, which connects to the
in-cluster engine over `tcp://dagger.dagger.svc:1234`
([`../../base/dagger`](../../base/dagger/README.md)) and executes everything inside it. The
template is one container:

- `runner` — `ghcr.io/actions/actions-runner` running `/home/runner/run.sh` as uid 1001
  (`runAsNonRoot`, `allowPrivilegeEscalation: false`, all capabilities dropped), one `work`
  emptyDir, and the Dagger telemetry variables below.

Sizing as the manifest declares it:

| Pool | Runners | runner container |
|---|---|---|
| `self-hosted-arc` | min 5 / max 16 | req 256Mi, limit 4Gi, no CPU request or limit |

The request follows the measured working set (Prometheus, 7 days: idle 265–323Mi, p99 peak
441Mi, max 1046Mi), not the limit; the limit is the headroom for one gitleaks scan of the full
history. Five warm runners therefore reserve 1.25Gi, down from 5Gi (500Mi for the runner plus 500Mi
for the dind sidecar, each).

Flux applies this directory as part of the `infrastructure-services`
Kustomization (`clusters/staging/infrastructure.yaml`, `path:
./infrastructure/services/staging`, `prune: true`, SOPS decryption via the
`sops-age` secret). That Kustomization `dependsOn` `infra-arc-controller`,
because this release declares ARC custom resources and need the CRDs to exist
first.

### Overlays

There is no `base/` for this component: it exists only
under `infrastructure/services/staging/`, listed as `arc-runner-set/` in
`infrastructure/services/staging/kustomization.yaml`. The CI stack as a whole is
staging-only.

## Why it is like this

**Dind was removed on 2026-10-15.** The pod carried a privileged `docker:dind` sidecar (and an
init container, three emptyDirs, `RUNNER_WAIT_FOR_DOCKER_IN_SECONDS`) so jobs could `docker
run`. Everything that did has moved: gates run in the Dagger engine, `gitleaks` is a
self-provisioned binary (`ensure-tool.sh`), and the two paths that genuinely need a daemon
— a fork PR's ephemeral engine (a fork must never reach the cluster engine) and the manual
k3d `e2e-tests.yaml` — run on GitHub-hosted `ubuntu-latest`. Removing it dropped the only
privileged container in `arc-runners`, so the namespace's Pod Security label is back to
`baseline` (`infrastructure/controllers/base/arc/namespace.yaml`), and a runner can no longer
be a pivot to the node. The manual dind template and its history (six `--insecure-registry`
flags until 2026-09-16, why `containerMode: dind` was not used) are in git, and
[14-design-decisions.md](../../../../documentations/14-design-decisions.md).

**Only one pool, and it keeps runners warm.** It holds 5 for fast PR feedback. The e2e pool
(`self-hosted-arc-e2e`, `maxRunners: 2`) existed for one reason: runners that never touch a
Docker daemon and read one Secret (`dev-platform/vc-e2e-runner`). The default runner is now
exactly that, so the e2e lane runs on it and the pool, its HelmRelease and its RBAC subject
are gone. The one thing that went with it is the `maxRunners: 2` cap on e2e concurrency: the
`e2e-platform-inplace` concurrency group still serialises the in-place runs, and the
dev-platform's own quota is the backstop for the per-PR runs
(`infrastructure/services/dev/dev-platform/README.md`).

**The XL pool is gone (2026-09-16).** It existed for one job: the k3d e2e leg, whose whole
stack ran inside a dind sidecar big enough to hold a cluster, one pod per node. asp moved
that gate to the dev-platform vcluster, leaving the k3d path as a manual `e2e-tests.yaml`
dispatch (GitHub-hosted since the dind removal).

**The pool exports Dagger telemetry to the in-cluster collector, not to Dagger
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

**Both chart versions are pinned and move together.** `gha-runner-scale-set`
here and `gha-runner-scale-set-controller` in
`infrastructure/controllers/base/arc/release.yaml` are all `0.14.2`. Renovate
bumps them separately and nothing enforces the rule but a comment and a human.

**Runners spread across nodes, softly** (2026-10-06). The template carries a
`topologySpreadConstraints` entry on `kubernetes.io/hostname`, keyed on
`actions.github.com/scale-set-name`. Before it, every runner sat on
node-1, so a burst of Rust builds (~16 `rustc` each) landed on the node already
carrying the Dagger engine and the scraper workers, and node-1's memory pressure
fed the Talos OOM controller (`../../../controllers/base/linstor/README.md`).
`whenUnsatisfiable: ScheduleAnyway` makes it a scoring preference: when node-2 or
node-3 is full, the runner still schedules wherever it fits rather than leaving a
CI job pending.

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
  `release.yaml` here and `gha-runner-scale-set-controller` `0.14.2` in
  `infrastructure/controllers/base/arc/release.yaml`. Align them in the same
  merge, and re-check the custom pod template against upstream on any
  bump past `0.14.x`.
- **`runnerScaleSetName` is the contract with the workflow files.**
  `self-hosted-arc` is what `runs-on:` targets in `Eliorion/asp` (`CI_RUNNER`), and the
  ServiceAccount `self-hosted-arc-gha-rs-no-permission` that the chart derives from it is what
  `../../base/dagger/rbac.yaml` and `../../dev/dev-platform/runner-access.yaml` bind.
  Renaming the scale set silently breaks both.
- **The Cilium policy on the engine selects runner pods by label.**
  `../../base/dagger/networkpolicy.yaml` admits `app.kubernetes.io/part-of:
  gha-runner-scale-set` in `arc-runners` to the engine's plaintext TCP port. Do not put
  anything else that carries that label in this namespace.
- **Workflows pull Harbor by full name.** `registry.eliorion.fr/<project>/<repo>`
  over TLS, from the `DOCKERHUB_MIRROR` / `GHCR_MIRROR` variables in
  `Eliorion/asp`. Any other spelling silently bypasses the cache and goes
  upstream.
- **Nothing in a job can use a Docker daemon.** `docker` is not installed in the runner image
  and there is no socket. A new workflow step that needs one belongs on `ubuntu-latest`;
  a step that only needs a tool should fetch the binary with `.github/scripts/ensure-tool.sh`.
- **The container runs without `sudo`.** `allowPrivilegeEscalation: false` makes setuid
  binaries inert, so `sudo apt-get` fails. Tools go to `~/.local/bin`.
- **`github-pat.enc.yaml` is SOPS ciphertext.** Edit it only through `sops`, and
  never commit it decrypted.
- **The sizing prose has drifted from the manifests.** The sizing notes in
  [04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md)
  quote `maxRunners: 10` for the default pool, and describe pools that no longer
  exist. The values in this directory are authoritative: 5/16, a 256Mi/4Gi runner, no dind.

## Operating it

Render check before commit, then the usual Flux status:

```sh
kubectl kustomize infrastructure/services/staging/arc-runner-set
flux get kustomizations              # infrastructure-services Ready
flux get helmreleases -A             # arc-runner-set-asp Ready
```

Where to look when it breaks:

```sh
kubectl -n arc-systems get pods      # one listener pod per scale set
kubectl -n arc-runners get pods,autoscalingrunnerset
kubectl -n arc-runners get pods -w   # watch a pod spawn for a queued job
```

In GitHub: `Eliorion/asp` > Settings > Actions > Runners should list
`self-hosted-arc` online.

After fixing a Pod Security or template problem, clear the stuck runners so the
controller recreates them clean:

```sh
kubectl -n arc-runners delete ephemeralrunner --all
```

Before raising `maxRunners`, confirm the runner peak stays under its limit
during a real run:

```sh
kubectl top pod -n arc-runners --containers
```

Deep detail — registration and scaling flow, the Nexus proxy repositories and
their ports, workflow snippets for pip and buildx, and the full troubleshooting
list including the `too many open files` inotify fix — is in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).
