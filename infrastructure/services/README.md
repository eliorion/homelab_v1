# infrastructure/services

The platform-workload tier: the things the cluster runs for itself rather than
for an application. Operators live one directory over in
`infrastructure/controllers/`; this tier is what those operators and the plain
Kubernetes API are used to run — Nexus, Keycloak, Renovate, the ARC runner
scale sets, Cloudflare tunnels, the Garage gateway, etcd backup, the AI gateway,
the Radar dashboard, and the CNPG databases that belong to them. It also holds
the `dev` tier (`dev/`): the guardrails for per-PR preview namespaces, reconciled on
its own Flux path.

Each component owns a directory with its own README. Start there; this file only
covers the tier root.

## How it is wired

The tier follows the repo-wide `base/` plus overlay pattern:
`base/<component>/` holds what does not change between environments, and
`staging/<component>/` holds the differences plus
anything encrypted. Encrypted files never live in `base/`, so a base
kustomization is always safe to render without an age key.

| Path | What it does |
|---|---|
| `base/<component>/` | The shared manifests for one component. There is **no** kustomization at `base/` itself — nothing aggregates the components, so `base/` is never a Flux path. |
| `staging/kustomization.yaml` | The tier root that Flux actually reconciles. It lists the component directories, one line each. |
| `staging/<component>/kustomization.yaml` | Pulls in `../../base/<component>` and adds the overlay's own resources and patches. |
| `dev/` | The `dev` tier: quota, network policy, RBAC and Kyverno policies for preview namespaces, plus the preview reaper. Not a component of `staging/`; see "The dev tier". |

Flux reconciles this tier through the Kustomization `infrastructure-services` in
`clusters/staging/infrastructure.yaml`: `path: ./infrastructure/services/staging`,
`interval: 1m0s`, `prune: true`, SOPS decryption with the `sops-age` Secret, and
`dependsOn` `infrastructure-controllers`, `infra-arc-controller` and
`infra-keycloak-operator` — the CNPG, ARC and Keycloak CRDs have to be
registered before the custom resources in this tier are applied. The reconcile
graph as a whole is described in
[`../../documentations/01-architecture.md`](../../documentations/01-architecture.md).

### Overlays

`staging/` is the live environment and the only one deployed. Its
`kustomization.yaml` currently lists `databases/`, `renovate/`, `keycloak/`,
`cloudflare/`, `arc-runner-set/`, `nexus/`, `harbor/`, `dagger/`,
`etcd-backup/`, `garage-gateway/`, `radar/` and `ai-gateway/`. Note that `arc-runner-set/` exists only under
`staging/` — it has no `base/` half, so its manifests live entirely in the
overlay.

There is no `production/` overlay. The unused one, never deployed and still
encoding a shared bucket layout that staging deliberately moved away from, was
deleted on 2026-09-15 — see the open-work section of
[`../../documentations/14-design-decisions.md`](../../documentations/14-design-decisions.md).

### The dev tier

`dev/` is a flat directory with its own `kustomization.yaml`, reconciled by the Flux
Kustomization `dev-platform` in `clusters/staging/dev.yaml` (`interval: 10m`,
`wait: true`, sops, `dependsOn` `infrastructure-services`, `infra-kyverno`,
`infra-cilium-config`, `infra-reflector`). It has no `base/`/overlay split: it exists
for the one cluster that runs previews. The previews themselves are created by the
Dagger pipeline, not by Flux. Everything else is in
[`dev/README.md`](dev/README.md).

`dev/e2e-platform/` is **not** part of that kustomization: its own Flux Kustomization
`e2e-platform` (same file) reconciles the long-lived e2e platform vcluster. See
[`dev/e2e-platform/README.md`](dev/e2e-platform/README.md).

## Traps

- **A component under `base/` does nothing until the overlay root lists it.**
  There is no aggregating kustomization in `base/`, so adding a directory there
  and forgetting the one line in `staging/kustomization.yaml` produces no error
  anywhere: the manifests are simply never applied.
- **Removing a line from `staging/kustomization.yaml` deletes the workload.**
  The `infrastructure-services` Kustomization runs with `prune: true`, so
  dropping a component from the list is not "stop managing it", it is "delete
  it from the cluster".
- **Never list `dev/` in `staging/kustomization.yaml`, nor `e2e-platform/` in
  `dev/kustomization.yaml`.** `dev-platform` and `e2e-platform` already own those objects;
  a second Kustomization would fight their prune.
- **Render before committing.** `kubectl kustomize infrastructure/services/staging`
  is the check that the tier root, every overlay and every base still agree.

## Operating it

```bash
kubectl kustomize infrastructure/services/staging   # render check before commit
flux get kustomizations
flux get helmreleases -A
```

`flux get kustomizations` reporting `infrastructure-services` as not ready is
usually one component failing, not the tier: read its message, then go to that
component's directory and its README.
