# cilium

Cilium is the cluster's CNI. It replaces the Talos default (Flannel + kube-proxy) with an
eBPF datapath running in kube-proxy replacement mode, and it also supplies the two things
this bare-metal cluster had no other source for: external IPs for `type: LoadBalancer`
Services (LB-IPAM + L2/ARP announcement) and L7 ingress (Gateway API). Talos installs no
CNI at all (`cniConfig.name: none` in `bootstraping/talconfig.yaml`) — the chart in this
directory is the datapath. Chart version `1.19.4`, pinned and bumped by Renovate.

Deep detail, the live migration runbook and the 2026-06-12 incident write-up live in
[../../../../documentations/08-cilium-cni-ingress-migration.md](../../../../documentations/08-cilium-cni-ingress-migration.md).
The decisions behind it are summarised in
[../../../../documentations/14-design-decisions.md](../../../../documentations/14-design-decisions.md)
(section 2, "Networking and exposure").

## How it is wired

| File | What it is |
|---|---|
| `kustomization.yaml` | Bundles `repository.yaml` + `release.yaml`. There is deliberately no `namespace.yaml`: Cilium targets the pre-existing `kube-system`, which is why `install.createNamespace` is `false`. |
| `repository.yaml` | `HelmRepository` `cilium` in `flux-system`, `https://helm.cilium.io`, 24h interval. |
| `release.yaml` | The `HelmRelease` — chart `cilium` `1.19.4`, `targetNamespace: kube-system`. All datapath, LB-IPAM, Gateway API and Hubble settings are `spec.values` here. |
| `config/kustomization.yaml` | Bundles the two CR files below. Rendered by a **separate** Flux Kustomization so it can be ordered after the chart. |
| `config/pool.yaml` | `CiliumLoadBalancerIPPool` `lan-pool` (`192.168.1.110`–`192.168.1.130`) and `CiliumL2AnnouncementPolicy` `lan-l2` that ARP-announces those IPs on the LAN. |
| `config/gateway.yaml` | `Gateway` `cilium-gw` (GatewayClass `cilium`, HTTP listener on `:80`, routes allowed `from: All`) and the `HTTPRoute` `nexus` in namespace `nexus` pointing `nexus.staging.lan` at `nexus-lb:8081`. |

Two Flux Kustomizations in `clusters/staging/infrastructure.yaml` consume this directory:

- `infra-cilium` → `./infrastructure/controllers/base/cilium`, `wait: true`, health-checked
  on the `cilium` HelmRelease, `timeout: 10m` because a first install on a cold node has to
  pull the agent, operator and Hubble images.
- `infra-cilium-config` → `./infrastructure/controllers/base/cilium/config`, with
  `dependsOn: infra-cilium` so the CRDs the chart installs (`CiliumLoadBalancerIPPool`,
  `CiliumL2AnnouncementPolicy`) exist before the CRs are applied.

Two things this component depends on but does **not** own, both at the Talos layer in
`bootstraping/talconfig.yaml`:

- `cluster.proxy.disabled: true` and `machine.features.kubePrism.port: 7445` — KubePrism is
  the host-network local apiserver load balancer the agents talk to once kube-proxy is gone.
- `cluster.extraManifests` fetching the gateway-api **v1.4.1** CRDs (`standard-install.yaml`
  plus the experimental `tlsroutes.yaml`). Cilium 1.19 requires v1.4.1; the older v1.2 set
  is wrong.

### Overlays

There are none. `infrastructure/controllers/staging/kustomization.yaml` and
`infrastructure/controllers/production/kustomization.yaml` do not reference cilium — the
Flux Kustomizations point straight at `base/cilium` and `base/cilium/config`. Any future
per-environment difference (a different LB pool range, a different Gateway hostname) would
need an overlay created first.

## Why it is like this

**Why Cilium at all.** The cluster was migrated off k3s, and k3s' ServiceLB (Klipper) went
with it. `nexus-lb` — a `type: LoadBalancer` Service — sat `<pending>` forever with no
external IP, and there was no L7 path at all after Traefik was retired. Cilium supplies the
datapath, LB-IPAM and a `GatewayClass` from a single chart, and eBPF service load balancing
removes kube-proxy at the same time. Staying on Flannel + kube-proxy was rejected.

**Why it is a Flux HelmRelease and not a Talos `inlineManifest`.** It keeps the CNI on the
same GitOps substrate as everything else: reviewable values and Renovate-driven upgrades.
The `inlineManifest` alternative embeds a Hubble CA in a roughly 2300-line committed blob —
key material in git — and was rejected for that. The cost is that a full cold start (all
three nodes down, Cilium never applied) needs one manual `cilium install` before Flux can
recover anything. It does not bite on a single node rebuild: the rebuilt node joins
NotReady, the Cilium DaemonSet tolerates NotReady, schedules onto it and installs the CNI.

**Why `ipam.mode: kubernetes`.** It reuses the per-node podCIDR Talos already allocates out
of `10.244.0.0/16`; the service CIDR `10.96.0.0/12` is likewise unchanged.

**Why `kubeProxyReplacement: true` with `k8sServiceHost: localhost` / `k8sServicePort: 7445`.**
Talos sets `cluster.proxy.disabled`, so there is no kube-proxy to program service VIPs.
KubePrism on `localhost:7445` is host-network and therefore always reachable, which gives
each agent an API path that does not itself depend on the service datapath it is
programming. An early revision of `release.yaml` was missing these two values — see Traps.

**Why the explicit `securityContext.capabilities`.** Talos requires the `ciliumAgent` and
`cleanCiliumState` capability lists to be spelled out (Sidero's documented Talos install).

**Why `cgroup.autoMount.enabled: false` with `hostRoot: /sys/fs/cgroup`.** Talos manages
cgroup mounts itself; letting the chart mount them fights the OS.

**Why `bpf.masquerade: false`.** "Without kube-proxy" is true of service load balancing, not
of masquerading. Talos runs `machine.features.hostDNS.forwardKubeDNSToHost: true`, and eBPF
masquerade breaks CoreDNS in that combination. Masquerading therefore still runs on
iptables. To turn eBPF masquerade on later, `forwardKubeDNSToHost` has to be set to `false`
first.

**Why `routingMode: tunnel` / `tunnelProtocol: vxlan`.** All three nodes sit on one L2
segment, so tunnel mode buys nothing in reachability — but it was the safe default during a
migration that was already degrading the datapath cluster-wide. The post-cutover
optimisation is documented and has *not* been applied:

```yaml
routingMode: native
autoDirectNodeRoutes: true
ipv4NativeRoutingCIDR: 10.244.0.0/16
```

**Why Gateway API instead of an ingress controller.** `gatewayAPI.enabled: true` gives L7
ingress with no second controller to own. Traefik was retired with k3s; ingress-nginx was
never present. Honest status: the migration is unfinished — one Gateway with a single
plaintext listener on port 80, one HTTPRoute, and its hostname does not resolve on the LAN
yet. A few objects elsewhere in the repository still name `ingressClassName: traefik`, a
controller this cluster no longer runs.

**Why the nexus HTTPRoute only carries 8081.** The Nexus docker connector ports 5000–5002
are L4/TCP and stay on the `nexus-lb` LoadBalancer Service directly; in-cluster CI keeps
addressing them as `nexus.nexus.svc.cluster.local:500x`. Only the UI/API on 8081 is worth an
L7 route.

**Why `hubble.tls.auto.method: cronJob`.** It is not the chart default. The cronJob method
generates the Hubble certificates in-cluster, so a Flux reconcile does not rotate them and
no key material has to land in git.

**Why `operator.replicas: 2`, `rollOutPods` and `rollOutCiliumPods`.** Two operator replicas
survive the loss of one of the three control planes, and the rollout flags make chart value
changes actually restart the pods that read them.

**Why `k8sClientRateLimit: {qps: 25, burst: 50}`.** `l2announcements` is lease-heavy — every
announced IP is a Lease renewed continuously — and the default client rate limit throttles
the agent against the apiserver.

**Why the LB pool is `192.168.1.110`–`192.168.1.130`.** It has to avoid the Talos API VIP
`192.168.1.100` (announced by Talos' own ARP) and the node addresses
`192.168.1.101`–`192.168.1.103`, and it has to sit outside the router's DHCP range.

## Traps

- **`k8sServiceHost: localhost` / `k8sServicePort: 7445` must match
  `machine.features.kubePrism.port` in `bootstraping/talconfig.yaml`.** Without them,
  removing kube-proxy strands Cilium with no API path: service VIPs never get programmed,
  CoreDNS at `10.96.0.10:53` returns `connection refused`, cluster DNS dies, every Flux
  controller `CrashLoopBackOff`s and source-controller can no longer fetch git — a self-heal
  deadlock where the fix is in a repository Flux cannot read. This happened on 2026-06-12.
- **Do not enable `bpf.masquerade`** while `machine.features.hostDNS.forwardKubeDNSToHost`
  is `true`. It breaks CoreDNS.
- **The gateway-api CRDs must exist before the chart is installed.** `gatewayAPI.enabled:
  true` makes the chart create a `cilium` GatewayClass, which needs the CRDs Talos ships via
  `extraManifests`. Apply the Talos config first; if the manifests are already pushed,
  `flux suspend kustomization infra-cilium infra-cilium-config` until the CRDs are up.
- **The version must be gateway-api v1.4.1** — the version Cilium 1.19 requires.
- **Apply order is load-bearing** at the Flux layer too: `infra-cilium-config` `dependsOn`
  `infra-cilium` because the CRs need CRDs the chart installs. Do not merge the two
  Kustomizations.
- **The two CRs in `config/pool.yaml` are on different apiVersions.**
  `CiliumLoadBalancerIPPool` is `cilium.io/v2` in Cilium 1.19 (it was `v2alpha1` before);
  `CiliumL2AnnouncementPolicy` is still `cilium.io/v2alpha1`.
- **The LB pool and the Talos VIP must not collide.** Both announce over ARP. Keep the pool
  clear of `192.168.1.100`–`192.168.1.103` and outside the DHCP range.
- **The L2 policy interface selector `^en.*`** has to keep matching the physical NIC names
  (`enp*`/`eno*`) used by the Talos `deviceSelector`. Rename or narrow it and the IPs stop
  being announced.
- **`hostnames: [nexus.staging.lan]` in `config/gateway.yaml` is a placeholder.** Set a real
  hostname and point LAN DNS at the Gateway's IP before relying on the L7 path.
- **`hubble.tls.auto.method` must stay `cronJob`.** The chart default regenerates the
  certificates on every Flux reconcile.
- **`cni.exclusive: true` is the chart default and is left on.** The first Cilium agent to
  start on a node seizes `/etc/cni/net.d` there and evicts any other CNI conf. There is no
  "node X on the old CNI, node Y on Cilium" middle state — the DaemonSet rollout decides.
- **`install.createNamespace: false`** — `kube-system` already exists; there is no
  `namespace.yaml` in this directory on purpose.
- **PodSecurity**: `kube-system` is exempt from `enforce: baseline` via the apiServer
  config, so Cilium installs cleanly. A namespace used for `cilium connectivity test` has to
  be labelled `pod-security.kubernetes.io/enforce=privileged` by hand.
- **Never regenerate `talsecret`** when re-rendering Talos config for this component's
  prerequisites. New PKI means a dead cluster.

## Operating it

Render check and Flux state:

```bash
kubectl kustomize infrastructure/controllers/base/cilium
kubectl kustomize infrastructure/controllers/base/cilium/config
flux get kustomizations
flux get helmreleases -A
flux reconcile kustomization infra-cilium --with-source
flux reconcile kustomization infra-cilium-config --with-source
```

Datapath health:

```bash
cilium status                                   # KubeProxyReplacement: True, all green
kubectl -n kube-system rollout status ds/cilium --timeout=5m
kubectl -n kube-system get cm cilium-config \
  -o jsonpath='{.data.k8s-service-host}:{.data.k8s-service-port}{"\n"}'   # localhost:7445
```

Exposure:

```bash
kubectl -n nexus get svc nexus-lb                        # EXTERNAL-IP out of lan-pool
kubectl -n kube-system get gateway cilium-gw             # PROGRAMMED=True, ADDRESS set
curl -H 'Host: nexus.staging.lan' http://<gateway-ip>/
```

Live values at the time of writing: `nexus-lb` = `192.168.1.110`, `cilium-gw` =
`192.168.1.111`.

**When it breaks and Flux is down with it.** The recovery lever is that KubePrism and the
control plane are host-network, so `talosctl` and `kubectl` through the VIP `192.168.1.100`
keep working even with the pod network dead. The emergency override that unblocked
2026-06-12 was patching the live ConfigMap directly, ahead of Flux:

```bash
kubectl -n kube-system patch cm cilium-config --type merge \
  -p '{"data":{"k8s-service-host":"localhost","k8s-service-port":"7445"}}'
kubectl -n kube-system rollout restart ds/cilium
```

Flux later re-applied the identical value from git, so this causes no drift. Full recovery
order, rollback procedure and the migration runbook are in
[../../../../documentations/08-cilium-cni-ingress-migration.md](../../../../documentations/08-cilium-cni-ingress-migration.md)
(sections 5, 8 and 10).
