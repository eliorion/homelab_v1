# agent-sandbox

The [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox)
controller, v1.0.5. It adds the `Sandbox` resource (`agents.x-k8s.io/v1beta1`): one stateful,
singleton pod with a stable identity, an optional PVC per sandbox, and a `Suspended`
operating mode that deletes the pod and keeps the PVC. With `extensions` on, it also adds
`SandboxTemplate`, `SandboxWarmPool` and `SandboxClaim` (`extensions.agents.x-k8s.io/v1beta1`):
templates, a pool of pre-started sandboxes, and a claim that adopts one from the pool.

The consumer is the agent platform (asp repo, `services/agent-platform/`). Its sandboxes run
on the `gvisor` RuntimeClass (`../gvisor/`). This directory installs the controller and its
CRDs only: no `Sandbox`, template or pool lives here.

## How it is wired

| File | What it does |
|---|---|
| `namespace.yaml` | `agent-sandbox-system`, PodSecurity `restricted`. |
| `repository.yaml` | `GitRepository agent-sandbox` in `flux-system`: the upstream repo at tag `v1.0.5`, scoped to `/helm/`. Upstream publishes no Helm repository and no OCI chart; the chart only exists in-tree. |
| `release.yaml` | `HelmRelease agent-sandbox`, `targetNamespace: agent-sandbox-system`, chart `./helm` from that GitRepository. It sets `image.tag: v1.0.5`, `controller.extensions: true`, `restricted`-compliant security contexts, and requests 20m/64Mi with a 256Mi memory limit. It also sets `install.crds: Create` / `upgrade.crds: CreateReplace` and `retries: 3`. |
| `kustomization.yaml` | The three files above. |

Flux applies it through `infra-agent-sandbox` (`clusters/staging/infrastructure.yaml`):
`wait: true`, with a health check on the HelmRelease.

The same PR added the agent platform's namespaces (`agent-platform`, `agent-sandboxes`, and the
Phase 0 test bed `agent-p0`) to two lists:
- the descheduler's `evictableNamespaces.exclude` (`../descheduler/`);
- the `ghcr-pull-secret` reflection lists (`../../staging/reflector/`).

## Why it is like this

**A GitRepository on a tag, not vendored YAML.** keycloak-operator is vendored because its
release is plain manifests. Here the upstream ships a Helm chart, and the chart is the only
place that exposes the controller's flags (`controller.*`). A GitRepository pinned to the
release tag gives the same immutability as vendoring, without a fetch script.

**The tag is written twice, and the two must move together.** `repository.yaml`'s `ref.tag`
selects the CRDs and the templates. `release.yaml`'s `image.tag` selects the controller
binary. The chart's own `version` (0.1.1) does not track releases, so it cannot be the pin.

**`crds: CreateReplace`.** Helm never upgrades `crds/` on its own, and the upstream README
says to `kubectl apply` them by hand on upgrade. Flux does it instead.

**Extensions on.** The platform keeps one warm pool per sandbox profile, so that claiming a
sandbox does not wait for a cold gVisor start. Without the extensions controller there is no
`SandboxWarmPool`.

**No ServiceMonitor from the chart.** Same rule as kyverno: the `ServiceMonitor` CRD comes
from the monitoring tier, and a chart that renders one fails to install before that tier
exists. The agent platform wires its scrape separately.

## Traps

- **`sandboxd` (the in-sandbox runtime daemon) has no authentication.** It is the platform's
  image's job to run it, and a CiliumNetworkPolicy's job to make sure only the platform can
  reach it. Nothing in this controller protects it.
- **Never put credentials in `SandboxClaim.spec.env`.** The value lands in the Pod spec, where
  anyone with `get pods` can read it.
- **Upgrading from a v1alpha1-era release needs the storage migration first** (anything
  before v0.5, upstream `docs/api-migration-guide.md`). It does not apply to this install,
  which started on v1beta1.
- **Deleting the HelmRelease does not delete the CRDs.** Removing the CRDs deletes every
  `Sandbox` in the cluster, and garbage collection then takes their pods.
