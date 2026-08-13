# garage-gateway

`garage-gateway` is an in-cluster HAProxy that gives the whole cluster one
stable S3 endpoint — `http://garage-s3.garage-gw.svc.cluster.local:3900` — for
**Garage**, the off-cluster object storage that holds the backups. Garage runs
on three NixOS nodes joined only by Tailscale (one at the home site, two off
site), so cluster pods cannot reach it directly: they have no route to the
`100.x` tailnet. The gateway proxies TCP to the Tailscale operator's egress
Services, load-balances across the three Garage nodes and health-checks them, so
every consumer — the `etcd-backup` CronJob and the CNPG barman-cloud sidecars
(`fbref-db`, `ai-gateway-db`) — configures a single DNS name and never a tailnet
address. Full storage-side detail lives in
[../../../../documentations/12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md).

## How it is wired

Base (`infrastructure/services/base/garage-gateway/`):

| File | What it holds |
|---|---|
| `namespace.yaml` | Namespace `garage-gw`. |
| `deployment.yaml` | The HAProxy Deployment: image `haproxy:3.0.6-alpine` (Renovate-tracked), 2 replicas, preferred pod anti-affinity on `kubernetes.io/hostname`, non-root uid/gid 99, read-only root filesystem, all capabilities dropped, `RuntimeDefault` seccomp, an `emptyDir` at `/tmp`, and the `garage-haproxy-config` ConfigMap mounted read-only at `/usr/local/etc/haproxy`. Ports `3900` (`s3`) and `8404` (`health`); requests 25m CPU / 64Mi, limit 128Mi. |
| `service.yaml` | ClusterIP Service `garage-s3`, port `3900` → `3900`, selecting `app: garage-gateway`. This is the name every consumer dials. |
| `kustomization.yaml` | Pulls in the three resources above. No config — see the overlay. |

Overlay (`infrastructure/services/staging/garage-gateway/`):

| File | What it holds |
|---|---|
| `haproxy.cfg` | The proxy config itself. `mode tcp` defaults; a `resolvers kube` block pointing at cluster DNS `10.96.0.10:53`; `frontend s3_in` binding `:3900` into `backend garage_s3`, round-robin over `garage-node-{a,b,c}.tailscale.svc.cluster.local:3900` with `check inter 3s fall 3 rise 2 resolvers kube init-addr last,none`; and `frontend health` on `:8404` with `monitor-uri /healthz` plus the stats page on `/stats`. |
| `kustomization.yaml` | Sets `namespace: garage-gw`, includes the base, and turns `haproxy.cfg` into the `garage-haproxy-config` ConfigMap via `configMapGenerator`. |

The component is reconciled by Flux as part of
`infrastructure/services/staging/kustomization.yaml`.

Its one upstream dependency is the Tailscale operator: the backends
`garage-node-a/b/c` are `ExternalName` Services in the `tailscale` namespace,
declared in `../../../controllers/staging/tailscale-operator/egress-proxies.yaml`.
Each one is rewritten by the operator to point at an egress proxy pod that exits
to the matching tailnet device.

### Overlays

Only `staging` exists today. The base is deliberately config-free because the
Garage node set is environment-specific: which tailnet devices exist, and
therefore which backends HAProxy should balance over, is a property of the
environment, not of the component. A second environment would add its own
overlay with its own `haproxy.cfg` under the same generator name
(`garage-haproxy-config`) and reuse the base unchanged.

## Why it is like this

**One endpoint, no raw tailnet addresses.** The Talos nodes are not tailnet
members and neither is HAProxy. The only thing in the cluster that can talk to a
`100.x` address is a Tailscale operator egress proxy pod, so the traffic path is
`consumer → garage-s3 ClusterIP → HAProxy → egress Service → operator proxy pod
→ tailnet → Garage node`. Consumers pointing at a `100.x` address directly would
simply not route.

**L4, not L7.** `mode tcp` means the gateway forwards bytes without parsing or
rewriting HTTP, so S3 request signatures pass through untouched. Garage speaks
plain HTTP on `3900`; there is no TLS termination here — the tailnet is the
transport that authenticates and encrypts the hop.

**Two replicas, spread across nodes.** "At least 2 HAProxy" so the gateway is
not a single point of failure in the backup path; Cilium load-balances the
ClusterIP across both. The anti-affinity is `preferred`, not `required`, so a
replica still schedules on a busy cluster.

**DNS is re-resolved continuously.** A backend is an `ExternalName` that leads to
an operator proxy pod, and that pod's IP changes whenever it restarts. The
`resolvers kube` block (`hold valid 10s`) makes HAProxy pick the new address up
on its own instead of needing a restart. `init-addr last,none` lets HAProxy start
even when a backend name does not resolve yet, rather than refusing to boot.

**The probes only prove HAProxy is alive.** HAProxy binds the frontend even when
every backend is down, so a TCP connect on `3900` is a true liveness/readiness
signal for the proxy process. Backend health is a separate concern, exposed on
`/stats`. Gating readiness on backend health would buy nothing — both replicas
share the same three backends, so removing one from the Service does not shift
traffic anywhere useful — and it would wedge Flux health checks for the whole
Kustomization whenever the tailnet route is missing.

**`node-b` is configured even though its host is offline.** The backend is
health-checked, so it sits `DOWN` harmlessly and HAProxy marks it `UP` by itself
the moment the host joins the tailnet. Nothing has to be edited or redeployed
when that happens.

**The config is a hashed ConfigMap.** `configMapGenerator` appends a content hash
to the name, so editing `haproxy.cfg` produces a new ConfigMap name and rolls the
Deployment automatically; a mounted ConfigMap updated in place would otherwise
leave HAProxy running the old config. The same mechanism is why `haproxy.cfg` is
the one file here that keeps its comments: they are ConfigMap *content*, so
rewording one changes the hash and redeploys HAProxy for no reason.

## Traps

- **Never dial a `100.x` tailnet address from a cluster workload.** Everything in
  the cluster goes through `garage-s3.garage-gw.svc.cluster.local:3900`. HAProxy
  is not a tailnet member; only the operator egress proxy pods are.
- **The backends must stay the Tailscale operator egress Services.** They are
  defined in `../../../controllers/staging/tailscale-operator/egress-proxies.yaml`
  — renaming or deleting `garage-node-a/b/c` there silently breaks this gateway.
- **`nameserver dns1 10.96.0.10:53` must be the cluster DNS ClusterIP.** If the
  kube-dns Service IP ever changes, HAProxy stops re-resolving backends and
  keeps using stale egress proxy IPs.
- **Do not remove the `node-b` server line** because the host is down. It is
  meant to be there and comes up on its own.
- **Do not gate the k8s probes on backend health.** The TCP-connect probes are
  intentional; see the rationale above.
- **`8404` is not used by the probes.** It is the human-facing health and stats
  port. Do not assume Kubernetes is watching it.
- **The ConfigMap name `garage-haproxy-config` must match** between the
  Deployment's `volumes[].configMap.name` and the overlay's `configMapGenerator`
  name, or kustomize will not rewrite the hashed name into the Deployment and the
  pod will mount nothing.
- **Clients must sign with region `garage`.** Garage uses a non-AWS region name
  and only `HeadBucket` enforces it, so a client with the wrong region looks
  perfectly healthy until it isn't — that is exactly the 2026-08-10 AI gateway
  outage in
  [../../../../documentations/12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md).
  Set both `AWS_REGION` and `AWS_DEFAULT_REGION`.

## Operating it

```bash
kubectl -n garage-gw get pods -o wide          # both replicas, on different nodes
kubectl -n garage-gw logs deploy/garage-gateway
kubectl kustomize infrastructure/services/staging/garage-gateway   # render check
```

Which Garage nodes are actually reachable — the first thing to look at when a
backup fails:

```bash
kubectl -n garage-gw port-forward deploy/garage-gateway 8404:8404
# http://localhost:8404/stats    per-backend UP/DOWN
# http://localhost:8404/healthz  HAProxy itself
```

To tell "Garage is broken" from "this client is misconfigured", run the
throwaway `aws-cli` pod from
[../../../../documentations/12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md)
— it dials this gateway with a real credential and calls `head-bucket`.

Two things this gateway deliberately does not do:

- **Garage administration.** `garage status`, `garage layout show`, bucket and
  key lifecycle all run on a Garage node; the admin API is not exposed through
  the gateway.
- **Restores.** They run off-cluster, straight at a node's tailnet IP, because
  the gateway is in-cluster only. See
  [../../../../documentations/09-etcd-backup-dr.md](../../../../documentations/09-etcd-backup-dr.md)
  for etcd and
  [../../../../documentations/03-backups.md](../../../../documentations/03-backups.md)
  for CNPG.
