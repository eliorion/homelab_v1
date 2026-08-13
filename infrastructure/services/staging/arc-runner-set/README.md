# arc-runner-set

The runner half of the self-hosted GitHub Actions stack: two
`gha-runner-scale-set` HelmReleases that register two runner pools with GitHub
for the `Eliorion/asp` repository. Each pool is an `AutoscalingRunnerSet`
consumed by the ARC controller, which turns a queued job into a one-shot
ephemeral pod in the `arc-runners` namespace and deletes it when the job ends.
`self-hosted-arc` is the default pool for ordinary jobs; `self-hosted-arc-xl` is
a smaller pool of bigger runners for the k3d end-to-end leg. The operator half
(CRDs, controller Deployment, the `arc-systems` / `arc-runners` namespaces and
the shared `HelmRepository/arc`) lives in
[`infrastructure/controllers/base/arc/`](../../../controllers/base/arc/README.md).
The whole CI stack, runners plus the Nexus dependency cache they pull through,
is described in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `release.yaml`, `release-xl.yaml`, `github-pat.enc.yaml`. |
| `release.yaml` | `HelmRelease/arc-runner-set-asp` in `flux-system`, `targetNamespace: arc-runners`, chart `gha-runner-scale-set` pinned to `0.14.2`, reconcile interval 30m / chart interval 12h. Registers the scale set `self-hosted-arc`, `minRunners: 5` / `maxRunners: 25`, with a hand-written dind pod template. |
| `release-xl.yaml` | `HelmRelease/arc-runner-set-asp-xl`, same chart and version, same namespace and secret. Registers `self-hosted-arc-xl`, `minRunners: 2` / `maxRunners: 4`, same dind template plus a `runner-tier: xl` pod label and a hard one-pod-per-node `podAntiAffinity`. |
| `github-pat.enc.yaml` | SOPS-encrypted Secret `arc-github-pat` (classic PAT with `repo` scope on `Eliorion/asp`). Both releases point at it through `githubConfigSecret`. Never commit it decrypted. |

Both releases carry the same pod template shape:

- `init-dind-externals` — an init container that copies `/home/runner/externals`
  into a shared `dind-externals` emptyDir, because the dind container expects
  them there.
- `dind` — `docker:dind` running `dockerd` as a **native sidecar**
  (`restartPolicy: Always` on an entry in `initContainers`), `privileged: true`,
  `DOCKER_GROUP_GID=123`, a `docker info` startup probe (2s period, 24 failures)
  and six `--insecure-registry` flags for the Nexus connectors.
- `runner` — `ghcr.io/actions/actions-runner:latest` running
  `/home/runner/run.sh` with `DOCKER_HOST=unix:///var/run/docker.sock` and
  `RUNNER_WAIT_FOR_DOCKER_IN_SECONDS=120`.
- Three emptyDirs: `work` (`/home/runner/_work`), `dind-sock` (`/var/run`, the
  shared docker socket) and `dind-externals`.

Sizing as the manifests currently declare it:

| Pool | Runners | runner container | dind sidecar |
|---|---|---|---|
| `self-hosted-arc` | min 5 / max 25 | req 2Gi, limit 4Gi | req 1Gi, limit 6Gi, no CPU limit |
| `self-hosted-arc-xl` | min 2 / max 4 | req 500m CPU + 512Mi, limit 1Gi | req 2Gi, limit 8Gi, no CPU limit |

Flux applies this directory as part of the `infrastructure-services`
Kustomization (`clusters/staging/infrastructure.yaml`, `path:
./infrastructure/services/staging`, `prune: true`, SOPS decryption via the
`sops-age` secret). That Kustomization `dependsOn` `infra-arc-controller`,
because these releases declare ARC custom resources and need the CRDs to exist
first.

### Overlays

There is no `base/` and no production overlay for this component: it exists only
under `infrastructure/services/staging/`, listed as `arc-runner-set/` in
`infrastructure/services/staging/kustomization.yaml`. The CI stack as a whole is
staging-only. The two releases in this directory are the environment split —
default pool and XL pool — not two environments.

## Why it is like this

**The dind sidecar is hand-written instead of `containerMode: dind`.** The
chart's `containerMode: dind` injects a fixed sidecar that accepts no extra
`dockerd` flags. The Nexus Docker connectors are plain HTTP (no TLS yet), so
`dockerd` refuses them unless every host:port form is whitelisted with
`--insecure-registry`. The template here reproduces what `containerMode: dind`
would have injected — the externals init container, native sidecar semantics,
the socket and externals volumes, the runner's `DOCKER_HOST` — and adds the six
flags covering both the short service name and the FQDN on ports 5000, 5001 and
5002. The cost is that the template is maintained by hand and a chart bump past
`0.14.x` will not update the wiring. Because only `--insecure-registry` is set
and never `--registry-mirror`, caching is opt-in per workflow line: an image
reference that omits the Nexus prefix silently bypasses the cache. See the
design record in
[14-design-decisions.md](../../../../documentations/14-design-decisions.md)
("A hand written dind template instead of the chart's `containerMode: dind`").

**Neither pool scales to zero.** The default pool keeps 5 warm runners for fast
PR feedback and the XL pool keeps 2. That warm minimum is permanently resident
memory on a 3-node cluster with roughly 50Gi total, shared between the two
pools — the default pool's five alone reserve roughly 15Gi of it.

**Memory is capped, CPU is not.** Each dind sidecar has a memory limit so a
runaway build cannot consume a whole node and OOM-evict a co-located e2e pod —
6Gi is already generous for the single-service image builds the default pool
runs. There is deliberately no CPU limit on either pool: CPU is compressible
and these builds are short, so an uncapped sidecar keeps PR feedback and the
parallel docker builds fast. All three nodes are control planes with no kubelet
`system-reserved`, so if etcd shows latency under heavy e2e, the answer is to
reserve CPU at the kubelet level rather than to cap the build here.

**The XL pool is a second scale set rather than bigger defaults.** The k3d
end-to-end stack runs entirely inside the dind container, so that container
carries the memory budget while the runner container stays small — it only
orchestrates. Its dind request is sized to cover the k3d steady state, so the
pod is guaranteed that much and stays eviction-protected under node pressure.
A hard `podAntiAffinity` on the self-owned `runner-tier: xl` label with
`topologyKey: kubernetes.io/hostname` puts at most one XL pod per node, so
concurrent e2e runs never share a node on this cluster. The label is set by the
template itself rather than reusing the chart's auto-generated labels, so the
selector does not depend on chart internals.

**The two pools share one PAT secret.** `arc-github-pat` lives in `arc-runners`
and both releases reference it; there is one credential for the one repository
they both serve.

**Both chart versions are pinned and move together.** `gha-runner-scale-set`
here and `gha-runner-scale-set-controller` in
`infrastructure/controllers/base/arc/release.yaml` are all `0.14.2`. Renovate
bumps them separately and nothing enforces the rule but a comment and a human.

## Traps

- **The two ARC chart versions must match.** `gha-runner-scale-set` `0.14.2` in
  both files here and `gha-runner-scale-set-controller` `0.14.2` in
  `infrastructure/controllers/base/arc/release.yaml`. Align them in the same
  merge, and re-check the hand-written dind template against upstream on any
  bump past `0.14.x`.
- **`runnerScaleSetName` is the contract with the workflow files.**
  `self-hosted-arc` and `self-hosted-arc-xl` are what `runs-on:` targets in
  `Eliorion/asp`. The two names must also stay distinct from each other: a
  scale set name has to be unique.
- **Do not switch to `containerMode: dind`.** It accepts no extra `dockerd`
  flags, so the `--insecure-registry` entries disappear and every pull from
  `nexus.nexus.svc[.cluster.local]:5000|5001|5002` fails against the HTTP-only
  connectors.
- **Workflows must use one of the six whitelisted registry forms.** Only
  `nexus.nexus.svc` and `nexus.nexus.svc.cluster.local` on 5000/5001/5002 are
  passed to `dockerd`. Any other spelling either fails or silently bypasses the
  cache.
- **`restartPolicy: Always` on the `dind` initContainer is what makes it a
  native sidecar.** Remove it and `dind` becomes a blocking init container that
  never completes.
- **The privileged dind sidecar needs the namespace label.** `arc-runners`
  carries `pod-security.kubernetes.io/enforce: privileged` in
  `infrastructure/controllers/base/arc/namespace.yaml`. Without it Talos'
  cluster-wide `baseline` enforcement fails every runner pod with
  `violates PodSecurity "baseline:latest": privileged (container "dind" must not
  set securityContext.privileged=true)`.
- **`runner-tier: xl` appears twice in `release-xl.yaml`.** It is set as a pod
  label and matched by the `podAntiAffinity` `labelSelector`. Change one and the
  spreading rule silently stops applying.
- **XL concurrency is capped by the node count, not by `maxRunners`.** The hard
  one-pod-per-node rule means at most 3 XL pods can schedule on this cluster.
  With `maxRunners: 4` the fourth runner is always Pending until the value is
  lowered or the cluster gains a node. That is queued and self-healing — the
  deliberate safe failure mode — but it is not a bug to chase.
- **Set the `CI_RUNNER_XL` repo variable only after the XL scale set registers
  healthy** (`kubectl -n arc-systems get pods` shows an
  `arc-runner-set-asp-xl-...-listener`). `e2e-tests.yaml` uses
  `vars.CI_RUNNER_XL || vars.CI_RUNNER`, so setting it early strands e2e jobs
  with no runner.
- **`github-pat.enc.yaml` is SOPS ciphertext.** Edit it only through `sops`, and
  never commit it decrypted.
- **The sizing prose has drifted from the manifests.** The sizing notes in
  [04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md)
  quote `maxRunners: 10` for the default pool and `minRunners: 1` /
  `maxRunners: 3` with a 4Gi/10Gi dind for the XL pool. The values in this
  directory are authoritative: 5/25 and 2/4, dind 1Gi/6Gi and 2Gi/8Gi.

## Operating it

Render check before commit, then the usual Flux status:

```sh
kubectl kustomize infrastructure/services/staging/arc-runner-set
flux get kustomizations              # infrastructure-services Ready
flux get helmreleases -A             # arc-runner-set-asp, arc-runner-set-asp-xl Ready
```

Where to look when it breaks:

```sh
kubectl -n arc-systems get pods      # one listener pod per scale set
kubectl -n arc-runners get pods,autoscalingrunnerset
kubectl -n arc-runners get pods -w   # watch a pod spawn for a queued job
```

In GitHub: `Eliorion/asp` > Settings > Actions > Runners should list
`self-hosted-arc` and `self-hosted-arc-xl` online.

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
