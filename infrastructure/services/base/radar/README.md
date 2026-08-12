# radar

Radar is an agentless Kubernetes dashboard for this cluster: one web UI that
reads the API server directly, plus an MCP endpoint an agent can query. It runs
as a Flux `HelmRelease` (chart `radar` from the `skyhook` Helm repository) in its
own `radar` namespace, its RBAC is read-only apart from one deliberate
exception, and it is published on the tailnet and nowhere else. It is a viewer,
not a control plane — the cluster is still changed only by committing YAML and
letting Flux reconcile.

## How it is wired

Base — `infrastructure/services/base/radar/`:

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the three objects below, in order: namespace, repository, release. |
| `namespace.yaml` | Namespace `radar`. |
| `repository.yaml` | `HelmRepository` `skyhook` in `flux-system`, `https://skyhook-io.github.io/helm-charts`, 24h interval. |
| `release.yaml` | The `HelmRelease` — chart `radar` `1.8.6`, one replica, tailnet-exposed Service, MCP on, read-only RBAC plus `portForward`. |

What `release.yaml` sets:

- `metadata.namespace: flux-system` with `targetNamespace: radar` and
  `releaseName: radar` — the HelmRelease object lives with the other Flux
  objects, the workload lands in `radar`.
- `interval: 30m` for the release, `chart.spec.interval: 12h` for the chart
  pull.
- `install.createNamespace: true`, even though `namespace.yaml` already creates
  the namespace.
- `chart.spec.version: "1.8.6"` — pinned, and Renovate keeps the pin current.
- `fullnameOverride: radar`, `replicaCount: 1`.
- `service`: `ClusterIP` on port `9280`, carrying
  `tailscale.com/expose: "true"` and `tailscale.com/hostname: radar`.
- `mcp.enabled: true` — the `/mcp` endpoint is served on the same port and
  therefore rides the same tailnet device.
- `rbac`: `create: true`, `helm: false`, `podExec: false`, `secrets: false`,
  `portForward: true`.
- `resources`: requests 50m / 128Mi, limits 1 CPU / 512Mi.

### Overlays

`infrastructure/services/staging/radar/kustomization.yaml` is the only overlay
and it does exactly one thing: pull in `../../base/radar`. There is nothing
environment-specific and no encrypted material, so there is no patch and no
`production/` overlay. The component is reconciled because
`infrastructure/services/staging/kustomization.yaml` lists `radar/`; see
[`../../README.md`](../../README.md).

## Why it is like this

**Published on the tailnet, over the `tailscale.com/expose` annotation.** Radar
is an admin UI with no authentication of its own, so the only thing standing in
front of it is tailnet device identity — the same pattern the Longhorn, asp and
fbref admin UIs use. It is never on the LAN LoadBalancer pool and never on a
public hostname. `expose` is an L3 forward that preserves the Service port, so
the UI answers as plain HTTP on `9280` rather than HTTPS on 443. That is the
cheaper of the two tailnet publication mechanisms this repo uses and it is
chosen deliberately per workload; the trade-off between `expose` and a Tailscale
`Ingress` is written up in
[`../../../../documentations/14-design-decisions.md`](../../../../documentations/14-design-decisions.md)
("Two different tailnet publication mechanisms, chosen per workload") and the
authentication plane it depends on is described in
[`../../../controllers/staging/tailscale-operator/README.md`](../../../controllers/staging/tailscale-operator/README.md).

**Read-only RBAC: view everything, mutate nothing.** `helm`, `podExec` and
`secrets` are all `false`. Mutating the cluster from a dashboard would fight the
GitOps rule that nothing is changed by hand, and Secret reads are the one thing
tailnet identity alone should not buy.

**`portForward: true` is the exception, and it is not optional.** Radar reaches
Cilium Hubble Relay by port-forwarding to the relay pod
(`kube-system/hubble-relay:4245`) — that port-forward is the transport for the
traffic/flows view. With `rbac.portForward: false` the traffic view stayed empty
and `kubectl auth can-i create pods/portforward -n kube-system` answered `no`.
The grant is cluster-wide `create` on `pods/portforward`; the thing that keeps
that acceptable is that reaching Radar at all requires being on the tailnet.
Hubble itself (`hubble.enabled`, `relay.enabled`, `ui.enabled`) is configured in
`../../../controllers/base/cilium/release.yaml`, described in
[`../../../../documentations/08-cilium-cni-ingress-migration.md`](../../../../documentations/08-cilium-cni-ingress-migration.md).

**MCP left enabled.** It costs nothing extra: it is served on `9280` alongside
the UI, so it inherits the same tailnet boundary and needs no second Service,
annotation or hostname.

## Traps

- **Do not set `rbac.portForward: false`.** The traffic/flows view goes silently
  empty — the UI still loads, only the flows are missing, and the underlying
  error is a `pods/portforward` denial in `kube-system`, not anything Radar
  reports.
- **Do not turn `rbac.helm`, `rbac.podExec` or `rbac.secrets` on.** They are off
  by intent, not by accident; this dashboard has no login of its own.
- **Do not add a Tailscale `Ingress` alongside the `tailscale.com/expose`
  annotation.** Both at once registers two tailnet devices contending for the
  hostname `radar` and the loser is silently suffixed.
- **`tailscale.com/hostname: radar` is the tailnet device name**, so it is the
  URL. Changing it changes every bookmark and every MCP client configuration.
- **The URL is plain HTTP on the Service port**, not 443. `expose` does not
  terminate TLS; there is no MagicDNS certificate on this path.
- **Chart version `1.8.6` is pinned** and bumped by Renovate. Do not float it.
- **`repository.yaml` and `release.yaml` must agree**: the release's
  `sourceRef` names `skyhook` in `flux-system`, which is exactly what
  `repository.yaml` creates.

## Operating it

Reach the UI at `http://radar.<your-tailnet>.ts.net` (plain HTTP, port `9280`),
from a device on the tailnet. The MCP endpoint is `/mcp` on the same host and
port.

```bash
kubectl kustomize infrastructure/services/staging   # render check before commit
flux get helmreleases -n flux-system radar
kubectl -n radar get pods,svc
```

If the UI loads but the traffic view is empty, the cause is the port-forward
grant or Hubble Relay itself. The Radar pod's own logs name the relay it is
trying to reach:

```bash
kubectl -n radar logs deploy/radar
kubectl -n kube-system get pods,svc | grep hubble-relay
kubectl auth can-i create pods/portforward -n kube-system \
  --as=system:serviceaccount:radar:<radar-serviceaccount>
```

If the hostname does not resolve on the tailnet, the Tailscale operator is the
place to look — the device is registered by the operator from the Service
annotations, not by anything in this directory.
