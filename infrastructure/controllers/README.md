# infrastructure/controllers

The operator tier: the controllers that have to exist before any workload can be
declared — the CNI, the certificate issuer, the storage provisioner, the Postgres
operator, the runner controller, the autoscaler, the Keycloak operator, the secret
mirror and the Tailscale operator. Each one is a component directory with its own
README. This file documents only the tier itself: which directory Flux points at,
which components are aggregated by a kustomization here and which ones deliberately
are not.

The repository-wide picture is in
[`../../documentations/01-architecture.md`](../../documentations/01-architecture.md);
the reasoning behind the individual choices is in
[`../../documentations/14-design-decisions.md`](../../documentations/14-design-decisions.md).

## How it is wired

Nothing in this tree runs because it is here. It runs because a Kustomization in
`clusters/<env>/infrastructure.yaml` names its path. Most components are named
directly, one per Flux Kustomization, and only two go through the aggregate
`staging/kustomization.yaml`.

### Files at this level

| Path | What it does |
|---|---|
| `base/` | The environment-independent component manifests: `arc/`, `cert-manager/`, `cilium/` (+ `cilium/config/`), `cnpg/` (+ `cnpg/plugin/`), `keda/`, `keycloak-operator/`, `longhorn/`, `reflector/`, `rook-ceph/`. **There is no `base/kustomization.yaml`** and there should not be one. |
| `staging/kustomization.yaml` | The aggregate Flux reconciles as `infrastructure-controllers`. Three resources: `cnpg/`, `tailscale-operator/` and `rook-ceph-cluster/`. |
| `staging/cnpg/kustomization.yaml` | Thin overlay, one resource: `../../base/cnpg/` (the operator only — `base/cnpg/kustomization.yaml` does not include `plugin/`). |
| `staging/tailscale-operator/` | Staging-only component, no base counterpart. Reconciled through the aggregate above. |
| `staging/rook-ceph-cluster/` | The `CephCluster`, pool and StorageClass. Separate from `base/rook-ceph/` (the operator) because it names this cluster's PCI/USB device paths. Its HelmRelease is **suspended**; the burn-in passed, so what remains is deleting the `hdd-burnin` namespace and flipping it. |
| `staging/reflector/` | Lives under `staging/` but is **not** listed in `staging/kustomization.yaml`. It has its own Flux Kustomization, `infra-reflector`, pointing straight at `./infrastructure/controllers/staging/reflector`. |
| `production/kustomization.yaml` | The production aggregate. One resource: `cnpg/`. |
| `production/cnpg/kustomization.yaml` | Thin overlay, one resource: `../../base/cnpg/`. |

### Which Flux Kustomization owns which path (staging)

From `clusters/staging/infrastructure.yaml`:

| Flux Kustomization | `path` | Notable settings |
|---|---|---|
| `infra-certmanager` | `base/cert-manager` | `interval: 1h`, `wait: true`, two Deployment health checks |
| `infra-cnpg-plugin` | `base/cnpg/plugin` | `dependsOn: infra-certmanager`, `wait: true`, `timeout: 10m` |
| `infra-arc-controller` | `base/arc` | `wait: true`, health check on `arc-controller-gha-rs-controller` |
| `infra-longhorn` | `base/longhorn` | `wait: true`, `timeout: 15m` (first install pulls all Longhorn images on a cold node) |
| `infra-rook-ceph` | `base/rook-ceph` | `wait: true`, `timeout: 15m`, health check on the `rook-ceph-operator` HelmRelease |
| `infra-cilium` | `base/cilium` | `wait: true`, `timeout: 10m` (cold agent/operator/hubble image pull) |
| `infra-cilium-config` | `base/cilium/config` | `dependsOn: infra-cilium` — needs the CRDs the chart installs |
| `infra-keda` | `base/keda` | `wait: true`, `timeout: 10m` |
| `infra-keycloak-operator` | `base/keycloak-operator` | `wait: true`, health check on `keycloak-operator` in `identity` |
| `infra-reflector` | `staging/reflector` | `wait: true`, sops `decryption`, health check on the `reflector` Deployment |
| `infrastructure-controllers` | `staging` | `interval: 1m0s`, `dependsOn: infra-cnpg-plugin`, sops `decryption`, **no `wait: true`** |

`infrastructure-services` depends on `infrastructure-controllers`, `infra-arc-controller`
and `infra-keycloak-operator`; `databases` and `lab` depend on `infra-reflector`.

### Overlays

`staging/` is the only overlay a live cluster reconciles. It carries the two components
that do not need their own gate (`cnpg`, `tailscale-operator`) plus `reflector/`, which
sits in the directory but is wired separately.

`production/` mirrors the shape with `cnpg/` alone, and `clusters/production/infrastructure.yaml`
declares only four Kustomizations (`infra-certmanager`, `infra-cnpg-plugin`,
`infrastructure-controllers`, `infrastructure-services`) — no cilium, longhorn, keda, arc,
reflector or keycloak-operator. It is wired but no production cluster is deployed; treat it
as scaffolding rather than as a second environment, as recorded in
[`../../documentations/01-architecture.md`](../../documentations/01-architecture.md#a-note-on-production).

Encrypted files never live in `base/`. That is a convention, not a rendering requirement:
kustomize does not decrypt anything, so a `.enc.yaml` is ordinary YAML and
`kubectl kustomize infrastructure/controllers/staging` succeeds with no age key — the
ciphertext simply passes through, and Flux decrypts at apply time. `tailscale-operator/` is
the one component with no base counterpart at all; its `operator-oauth.enc.yaml` and the whole
directory sit under `staging/`. `reflector/` does have a base counterpart:
`staging/reflector/` lists `../../base/reflector` and adds only the sops-encrypted
`ghcr-pull-secret.enc.yaml`.

## Why it is like this

**No aggregate kustomization at `base/`.** Eight paths under `base/` are named directly by
their own Flux Kustomization — `cert-manager`, `cnpg/plugin`, `arc`, `longhorn`, `cilium`,
`cilium/config`, `keda`, `keycloak-operator` — deliberately separate so that cert-manager can
gate the CNPG plugin, the Cilium chart can gate its IP pool and Gateway objects, and Longhorn
can have its own 15m cold-pull timeout. The two remaining directories are named by no Flux
Kustomization at all: `base/cnpg` is reconciled through `staging/cnpg/` inside the aggregate
`infrastructure-controllers`, and `base/reflector` through `staging/reflector` under
`infra-reflector`. One atomic aggregate is the pattern
[`01-architecture.md`](../../documentations/01-architecture.md) and
[`14-design-decisions.md`](../../documentations/14-design-decisions.md) record as rejected:
Flux applies a Kustomization atomically, so a custom resource sharing a Kustomization with
its own CRD deadlocks on `no matches for kind`. A `base/kustomization.yaml` did once exist —
it listed `renovate/` and `keycloak/`, both of which moved to `infrastructure/services/base/`,
so `kubectl kustomize infrastructure/controllers/base` had failed on a missing directory for
months without anyone noticing, because nothing rendered it and this repo has no CI. It was
deleted rather than repaired. `infrastructure/services/base` has no aggregate either, so the
two tiers are consistent.

**`infrastructure-controllers` has no `wait: true`.** It is a wide fan-out tier. Gating it
on full health would let one sick workload block everything behind it — the same reason
`infrastructure-services`, `apps` and the monitoring pair are also ungated.

**Reflector is a hard gate and therefore not in the aggregate.** The one central
`ghcr-pull-secret` it mirrors into `asp`/`fbref`/`lab` must exist before any of those
namespaces pulls a private image, so `infra-reflector` needs `wait: true` and a health
check, and `databases` and `lab` declare `dependsOn: infra-reflector`. An entry in
`staging/kustomization.yaml` would put the same objects under a second, ungated Flux
Kustomization.

**Two reconcile cadences.** The per-operator Kustomizations use `interval: 1h` because they
only change when a human bumps a chart. `infrastructure-controllers` uses `1m0s`. Both rely
on `retryInterval: 1m` to recover from a transient failure faster than the interval.

**The Tailscale operator is in this tier.** The admin surfaces it publishes — the Longhorn
UI, the asp orchestrator, the fbref BFF — have no authentication of their own, and Tailscale
authenticates by device identity without touching the internet. A LAN LoadBalancer from the
Cilium pool and a Cloudflare public hostname were both rejected. The cost is stated sharply
in [`14-design-decisions.md`](../../documentations/14-design-decisions.md): a single,
unbacked authentication plane in front of surfaces with no authorization behind them.

## Traps

- **Do not add a `kustomization.yaml` to `base/`.** Nothing references it, nothing can, and
  the split into separate Flux Kustomizations is what provides the CRD ordering guarantees.
- **Do not add `reflector/` to `staging/kustomization.yaml`.** It is already owned by the
  `infra-reflector` Flux Kustomization; listing it here applies the same objects from two
  Kustomizations.
- **`- tailscale-operator/` only works because `infrastructure-controllers` sets
  `decryption.provider: sops`.** Without that block Flux applies the manifest verbatim, so
  the Secret's value is the literal `ENC[AES256_GCM,...]` ciphertext string and **nothing
  fails at apply time** — the symptom surfaces later and somewhere unrelated. The same
  applies to any future component added here that ships an `.enc.yaml`.
- **Adding a directory under `staging/` is not enough to deploy it.** It must either be a
  resource of `staging/kustomization.yaml` or get its own Kustomization in
  `clusters/staging/infrastructure.yaml`. Otherwise it is inert YAML.
- **`prune: true` is set on every Kustomization in the graph.** Deleting a line from
  `staging/kustomization.yaml` deletes the corresponding objects from the cluster.
- **`staging/cnpg/` pulls in `../../base/cnpg/`, which excludes `plugin/`.** The barman-cloud
  plugin is reconciled separately by `infra-cnpg-plugin` and must stay that way: an
  `ObjectStore` applied in the same Kustomization as its CRD deadlocks on
  `no matches for kind ObjectStore`.

## Operating it

Render the two aggregates before committing a change here:

```bash
kubectl kustomize infrastructure/controllers/staging
kubectl kustomize infrastructure/controllers/production
```

Then check the graph after Flux has had a cycle:

```bash
flux get kustomizations
flux get helmreleases -A
```

Two prerequisites Flux does not create and will not report as a missing dependency: the
`sops-age` Secret in `flux-system` (without it every Kustomization with a `decryption` block
stays not ready) and the `asp-deploy-key` Secret backing the external GitRepository objects.
See [`../../documentations/00-bootstrap-cluster.md`](../../documentations/00-bootstrap-cluster.md).

### Component READMEs

- [`base/arc/README.md`](base/arc/README.md)
- [`base/cert-manager/README.md`](base/cert-manager/README.md)
- [`base/cilium/README.md`](base/cilium/README.md)
- [`base/cnpg/README.md`](base/cnpg/README.md) and [`base/cnpg/plugin/README.md`](base/cnpg/plugin/README.md)
- [`base/keda/README.md`](base/keda/README.md)
- [`base/keycloak-operator/README.md`](base/keycloak-operator/README.md)
- [`base/longhorn/README.md`](base/longhorn/README.md)
- [`staging/reflector/README.md`](staging/reflector/README.md) (covers `base/reflector/` too)
- [`staging/tailscale-operator/README.md`](staging/tailscale-operator/README.md)
