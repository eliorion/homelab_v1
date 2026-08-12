# keda

The KEDA operator: the event-driven autoscaler that lets workloads in this
cluster scale to zero and back on a queue-like signal instead of on CPU. It runs
in the `keda` namespace and is installed as a Flux `HelmRelease` from the
upstream `kedacore` chart. This directory installs the **operator and its CRDs
only** (`ScaledObject`, `TriggerAuthentication`) — no `ScaledObject` lives here.
The consumers are the asp `scraper` chart's request-driven engine pools and
their FlareSolverr solvers (`apps/staging/scraper`), which KEDA scales 0<->1 per
pool on that pool's pending-request count.

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Base: `namespace.yaml`, `repository.yaml`, `release.yaml`. |
| `namespace.yaml` | The `keda` namespace. |
| `repository.yaml` | `HelmRepository/kedacore` in `flux-system`, `https://kedacore.github.io/charts`, 24h interval. |
| `release.yaml` | `HelmRelease/keda` in `flux-system`, `targetNamespace: keda`, chart `keda` pinned to `2.17.2`, 30m reconcile / 12h chart interval, `install.crds: Create` + `upgrade.crds: CreateReplace`, operator requests 100m/128Mi and limits 500m/512Mi. |

The release also sets `install.createNamespace: true`, so the namespace exists
whether Flux applies `namespace.yaml` first or Helm gets there first.

Flux applies this directory through a dedicated Kustomization, `infra-keda`,
declared in `clusters/staging/infrastructure.yaml`:

- `path: ./infrastructure/controllers/base/keda` — straight at the base, not
  through an environment overlay.
- `interval: 1h`, `retryInterval: 1m`, `timeout: 10m`. The long timeout is for
  the first install, which pulls the KEDA operator and metrics-apiserver images.
- `prune: true`, `wait: true`, health-gated on `Deployment/keda-operator` in the
  `keda` namespace.

It hangs directly off the root `flux-system` Kustomization and depends on
nothing. In the reconcile graph in
[01-architecture.md](../../../../documentations/01-architecture.md) it is one of
the hard gates: `wait: true` plus a health check, so it reports Ready only once
the operator genuinely is.

### Overlays

There is no staging or production overlay for KEDA. Neither
`infrastructure/controllers/staging/kustomization.yaml` nor
`infrastructure/controllers/production/kustomization.yaml` lists `keda/`; the
`infra-keda` Flux Kustomization points at `base/keda` itself. Adding an
environment overlay later means adding a pass-through `kustomization.yaml` and
repointing `path:` — until then, any change here applies to every cluster that
declares `infra-keda`.

## Why it is like this

**KEDA exists for the scraper's request-driven engine pools.** The scraper's
topology is one pool per egress IP: a pod leases lanes bound to its proxy, warms
the anti-bot session behind that IP, and serves that lane's requests. One pool =
one proxy = one IP = one fingerprint, so a pool is capped at a single pod and
throughput is scaled by adding pools, never replicas. That leaves scale-to-zero
as the only lever, and KEDA is what drives it: each pool and its FlareSolverr
solver go 0<->1 on the pool's pending count, so an idle `scraper` namespace is
backend-only.

**The operator gets its own Flux Kustomization.** Flux applies a Kustomization
atomically, so a `ScaledObject` applied in the same unit as its own CRD would
deadlock on `no matches for kind`. A narrow `infra-keda` unit with `wait: true`
and a health check on `keda-operator` registers the CRDs and proves the operator
Ready before anything that uses them is applied.

**The chart's CRDs are Helm-owned.** KEDA ships its CRDs in the chart's `crds/`
directory. `install.crds: Create` lets Helm install them, and
`upgrade.crds: CreateReplace` is what keeps them in step on a chart bump —
without it, Flux leaves the cluster on whatever CRD version the first release
installed.

**Nothing in this directory is environment-specific.** The only values set are
the operator's own resource requests and limits, which is why the base is
applied directly and no overlay was created.

**The chart version is pinned and Renovate bumps it.** Currently `2.17.2`.

## Traps

- **`upgrade.crds: CreateReplace` in `release.yaml` is load-bearing.** Remove it
  and the KEDA CRDs stop tracking the chart on upgrade; new `ScaledObject`
  fields silently do not exist.
- **The `infra-keda` health check names `keda-operator` in namespace `keda`.**
  It must match the Deployment the chart actually creates in `targetNamespace`.
  If either name drifts, the Kustomization never reports Ready.
- **KEDA is a hard requirement of the asp `scraper` chart.** The chart has no
  enable flag and no fixed-replica mode any more — every pool and solver is
  HPA-owned. Remove this directory and the scraper release fails applying its
  `ScaledObject`s rather than quietly running everything unscaled. (When the
  operator was first installed the chart still gated them behind a
  `keda.enabled` value; that gate is gone. See the note in
  `apps/staging/scraper/release.yaml`.)
- **No Kustomization declares `dependsOn: infra-keda`.** The `apps` chain is
  gated on `db-migrations` only, so on a cold bootstrap the scraper release can
  be applied before the KEDA CRDs are registered and will fail until
  `infra-keda` catches up. Add the dependency if that retry loop ever matters.
- **`timeout: 10m` on `infra-keda` is sized for a cold image pull** (operator +
  metrics-apiserver). Lowering it makes a first install on a fresh node look
  like a failure.

## Operating it

Render and reconcile checks:

```sh
kubectl kustomize infrastructure/controllers/base/keda
flux get kustomizations
flux get helmreleases -A
```

The HelmRelease is `keda` in `flux-system`; the workloads it creates are in the
`keda` namespace:

```sh
kubectl -n keda get pods
kubectl -n keda logs deploy/keda-operator
```

What KEDA is driving, and why a pod is or is not up:

```sh
kubectl -n scraper get scaledobject,hpa
kubectl -n scraper describe scaledobject <name>
```

Deep detail on the reconcile graph and the gate pattern:
[01-architecture.md](../../../../documentations/01-architecture.md).
