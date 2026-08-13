# infrastructure/services

The platform-workload tier: the things the cluster runs for itself rather than
for an application. Operators live one directory over in
`infrastructure/controllers/`; this tier is what those operators and the plain
Kubernetes API are used to run — Nexus, Keycloak, Renovate, the ARC runner
scale sets, Cloudflare tunnels, the Garage gateway, etcd backup, the AI gateway,
the Radar dashboard, and the CNPG databases that belong to them.

Each component owns a directory with its own README. Start there; this file only
covers the tier root.

## How it is wired

The tier follows the repo-wide `base/` plus overlay pattern:
`base/<component>/` holds what does not change between environments, and
`staging/<component>/` (or `production/<component>/`) holds the differences plus
anything encrypted. Encrypted files never live in `base/`, so a base
kustomization is always safe to render without an age key.

| Path | What it does |
|---|---|
| `base/<component>/` | The shared manifests for one component. There is **no** kustomization at `base/` itself — nothing aggregates the components, so `base/` is never a Flux path. |
| `staging/kustomization.yaml` | The tier root that Flux actually reconciles. It lists the component directories, one line each. |
| `staging/<component>/kustomization.yaml` | Pulls in `../../base/<component>` and adds the overlay's own resources and patches. |
| `production/kustomization.yaml` | The same entry point for a production cluster that does not exist. See "Overlays". |

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
`cloudflare/`, `arc-runner-set/`, `nexus/`, `etcd-backup/`, `garage-gateway/`,
`radar/` and `ai-gateway/`. Note that `arc-runner-set/` exists only under
`staging/` — it has no `base/` half, so its manifests live entirely in the
overlay.

`production/` exists and is wired but no production cluster is deployed; the
tree still encodes a shared bucket layout that staging deliberately moved away
from. Treat it as scaffolding rather than as a second environment — see the
note at the end of
[`../../documentations/01-architecture.md`](../../documentations/01-architecture.md)
and the open-work section of
[`../../documentations/14-design-decisions.md`](../../documentations/14-design-decisions.md).

## Traps

- **A component under `base/` does nothing until the overlay root lists it.**
  There is no aggregating kustomization in `base/`, so adding a directory there
  and forgetting the one line in `staging/kustomization.yaml` produces no error
  anywhere: the manifests are simply never applied.
- **Removing a line from `staging/kustomization.yaml` deletes the workload.**
  The `infrastructure-services` Kustomization runs with `prune: true`, so
  dropping a component from the list is not "stop managing it", it is "delete
  it from the cluster".
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
