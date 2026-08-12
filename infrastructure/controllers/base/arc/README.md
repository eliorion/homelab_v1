# arc

The operator half of the self-hosted GitHub Actions runner stack:
`gha-runner-scale-set-controller` (actions-runner-controller, ARC). It installs
the ARC CRDs and the controller Deployment into the `arc-systems` namespace, and
creates `arc-runners`, the namespace where the ephemeral runner pods land. The
controller does not itself register anything with GitHub — it watches
`AutoscalingRunnerSet` resources and turns queued jobs into one-shot runner pods.
The runner pools themselves (`self-hosted-arc` and `self-hosted-arc-xl`, both for
`Eliorion/asp`) are separate `gha-runner-scale-set` HelmReleases living in
`infrastructure/services/staging/arc-runner-set/`, and they consume the CRDs and
the `HelmRepository` declared here. The whole CI stack, runners plus the Nexus
dependency cache they pull through, is described in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Base: `namespace.yaml`, `repository.yaml`, `release.yaml`. |
| `namespace.yaml` | Two namespaces. `arc-systems` holds the controller and the per-scale-set listener pods. `arc-runners` holds the ephemeral runner pods and carries `pod-security.kubernetes.io/enforce: privileged`. |
| `repository.yaml` | `HelmRepository/arc` in `flux-system`, `type: oci`, `oci://ghcr.io/actions/actions-runner-controller-charts`, 24h interval. Shared: the runner-set releases in `infrastructure/services/staging/arc-runner-set/` point at this same source. |
| `release.yaml` | `HelmRelease/arc-controller` in `flux-system`, `targetNamespace: arc-systems`, `releaseName: arc-controller`, chart `gha-runner-scale-set-controller` pinned to `0.14.2`, reconcile interval 30m / chart interval 12h, `install.createNamespace: true`, manager `securityContext` hardening, requests 500m/256Mi and a 512Mi memory limit. |

Flux applies this directory through its **own** Kustomization, not through the
environment overlay. `clusters/staging/infrastructure.yaml` declares
`infra-arc-controller` with `path: ./infrastructure/controllers/base/arc`,
`prune: true`, `wait: true`, and a health check on the Deployment
`arc-controller-gha-rs-controller`. The `infrastructure-services` Kustomization
then lists `infra-arc-controller` in its `dependsOn`, because `arc-runner-set`
needs the ARC CRDs to exist before its own resources can be applied.

Runtime flow, in one line: a listener pod in `arc-systems` long-polls GitHub, the
controller reacts to a queued job by creating an `EphemeralRunner`, and the
resulting pod (runner container plus a privileged dind sidecar) runs exactly one
job in `arc-runners` and is then deleted.

### Overlays

There is no staging or production overlay for this component.
`infrastructure/controllers/staging/kustomization.yaml` lists only `cnpg/` and
`tailscale-operator/`, and the production tree lists only `cnpg/`; neither
references `arc/`. The base is applied verbatim by `infra-arc-controller`, which
is declared only for staging. The CI stack as a whole is staging-only.

## Why it is like this

**`releaseName: arc-controller` is pinned.** With the release name fixed, the
chart names the controller Deployment predictably
`arc-controller-gha-rs-controller`, which is the exact name the
`infra-arc-controller` Flux health check waits on. A different release name
renames the Deployment and the health check never resolves.

**The chart version is pinned and moves in lockstep with the runner-set chart.**
`gha-runner-scale-set-controller` here and `gha-runner-scale-set` in
`infrastructure/services/staging/arc-runner-set/release.yaml` and
`release-xl.yaml` are all `0.14.2`. Renovate bumps them; they must be merged
together. Beyond version skew, the runner-set releases define their dind pod
template by hand against the `0.14.x` shape, so a chart bump also means
re-checking that template against upstream.

**The manager `securityContext` is set from values.** The chart ships
`securityContext: {}`, which leaves the manager container able to escalate
privilege — a Radar cluster-audit `privilegeEscalation` danger finding. The
values drop escalation and all capabilities and set `seccompProfile:
RuntimeDefault`. It is deliberately kept minimal: no `runAsNonRoot`, no
`readOnlyRootFilesystem`, so the controller's runtime assumptions are unchanged.
The change was verified with `helm template` to confirm the settings land on the
manager container without wiping the chart's own hardening.

**`arc-runners` enforces the `privileged` Pod Security Standard.** Runner pods
carry a privileged dind sidecar, because the runner-set releases use a manual
dind pod template rather than the chart's `containerMode: dind` — that is the
only way to pass `--insecure-registry` for the HTTP-only Nexus docker connectors
on ports 5000/5001/5002. On the old k3s box nothing enforced a Pod Security
Standard and this worked implicitly. Talos enforces `baseline` cluster-wide, so
after the migration (see
[07-talos-ha-expansion.md](../../../../documentations/07-talos-ha-expansion.md))
the controller and listener stayed healthy while every `EphemeralRunner` went
`Failed` with:

```
Failed to create the pod: pods "self-hosted-arc-...-runner-..." is forbidden:
violates PodSecurity "baseline:latest": privileged (container "dind" must not
set securityContext.privileged=true)
```

`arc-systems` is not labelled: the controller and listener pods pass `baseline`
on their own.

**The controller gets its own Flux Kustomization.** It provides CRDs that
resources in a different Flux unit (`infrastructure-services`) consume. Flux
applies a Kustomization atomically, so the CRD provider has to be a separate,
`wait: true` unit that consumers depend on.

## Traps

- **The two ARC chart versions must match.** `gha-runner-scale-set-controller`
  `0.14.2` here and `gha-runner-scale-set` `0.14.2` in
  `infrastructure/services/staging/arc-runner-set/release.yaml` +
  `release-xl.yaml`. Renovate bumps them separately — align them in the same
  merge.
- **Do not change `releaseName: arc-controller`.** The Flux health check on
  `infra-arc-controller` targets the Deployment `arc-controller-gha-rs-controller`,
  which is derived from that release name.
- **Do not remove `pod-security.kubernetes.io/enforce: privileged` from
  `arc-runners`.** Runner pods stop being created and every `EphemeralRunner`
  fails with the `violates PodSecurity "baseline:latest"` error above.
- **`HelmRepository/arc` is shared.** Both runner-set HelmReleases reference
  `sourceRef: {kind: HelmRepository, name: arc, namespace: flux-system}`.
  Renaming or deleting it breaks both runner pools, not just the controller.
- **Anything that declares an ARC custom resource must `dependsOn:
  infra-arc-controller`.** That is why `infrastructure-services` lists it; drop
  the dependency and the runner-set Kustomization races the CRDs.

## Operating it

Render check before commit, then the usual Flux status:

```sh
kubectl kustomize infrastructure/controllers/base/arc
flux get kustomizations            # infra-arc-controller Ready
flux get helmreleases -A           # arc-controller, arc-runner-set-asp Ready
```

Where to look when it breaks:

```sh
kubectl -n arc-systems get pods    # controller Running, one listener per scale set
kubectl -n arc-runners get pods,autoscalingrunnerset
```

After fixing a Pod Security or template problem, clear the stuck runners so the
controller recreates them clean:

```sh
kubectl -n arc-runners delete ephemeralrunner --all
```

Deep detail — registration, scaling, the dind template, Nexus proxy ports,
sizing and the full troubleshooting list — is in
[04-ci-runners-cache.md](../../../../documentations/04-ci-runners-cache.md).
