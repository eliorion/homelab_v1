# tailscale-operator

The Tailscale Kubernetes operator, installed by Flux into the `tailscale`
namespace. It does three jobs. **Ingress**: it publishes selected in-cluster
Services as tailnet devices, so admin UIs are reachable off-LAN without ever
being on the internet. **Egress**: it runs proxy pods that are tailnet members
and fronts them with plain in-cluster Services, so a workload that is not on the
tailnet can dial a tailnet device by a local name. **API server proxy**: it
serves the Kubernetes API on the tailnet, so `kubectl` works when the API VIP
`192.168.1.100:6443` is unreachable. Everything it publishes is gated by tailnet
identity — no Cloudflare hostname, no public ingress, no LAN LoadBalancer.

## How it is wired

| File | Role |
|---|---|
| `kustomization.yaml` | resource list; `operator-oauth.enc.yaml` is decrypted by the `infrastructure-controllers` Flux Kustomization (`decryption.provider: sops`) |
| `namespace.yaml` | the `tailscale` namespace, labelled `pod-security.kubernetes.io/{enforce,warn,audit}: privileged` |
| `repository.yaml` | `HelmRepository` `tailscale` in `flux-system` → `https://pkgs.tailscale.com/helmcharts`, interval 24h |
| `release.yaml` | `HelmRelease` `tailscale-operator` in `flux-system`, `targetNamespace: tailscale`, chart pinned to `1.98.4`, `values.oauth: {}` and `values.apiServerProxyConfig` |
| `operator-oauth.enc.yaml` | SOPS-encrypted Secret holding the OAuth **client** credentials (`client_id`, `client_secret`) |
| `egress-proxies.yaml` | five `ExternalName` Services, one per tailnet exit the cluster needs to reach |

### Overlays

There is no `base/` and no production copy: the component exists only in the
staging overlay and is wired in `../kustomization.yaml`. The production overlay
(`infrastructure/controllers/production/kustomization.yaml`) lists `cnpg/` only.
The operator itself is namespace-agnostic — it watches the whole cluster, so the
Services and Ingresses it publishes live in the namespaces of the workloads they
belong to, not here.

### What the operator publishes (annotations live in other components)

Two mechanisms, chosen per workload. `tailscale.com/expose` is an L3 forward
that preserves the Service port — plain HTTP on that port, not 443. A Tailscale
`Ingress` (`ingressClassName: tailscale`) terminates HTTPS on 443 with a MagicDNS
certificate.

`tailscale.com/expose` + `tailscale.com/hostname`:

| Device | Declared in | Service port |
|---|---|---|
| `asp-admin-ui` | `apps/staging/asp/release.yaml` (`adminUi.service.annotations`) | 8080 |
| `fbref-admin-ui` | `apps/staging/fbref/release.yaml` (`adminUi.service.annotations`) | 8080 |
| `scraper-admin-ui` | `apps/staging/scraper/release.yaml` (`adminUi.service.annotations`) | set by the chart (`k8s/charts/scraper`), not in `release.yaml` |
| `radar` | `infrastructure/services/base/radar/release.yaml` (`service.annotations`) | 9280 |
| `azuracast-stream` | `apps/base/azuracast/service-stream-tailscale.yaml` | 8000 |

The `adminUi.service.annotations` values need that template to exist in the
chart (asp repo `k8s/charts/{asp,fbref}`, shipped on `main`); the deployed
HelmRelease must be on a chart revision that has it. `radar` and
`azuracast-stream` need no chart change: their Service objects are in this repo
or already pass annotations through, so nothing but the annotation moves.

Tailscale `Ingress` (HTTPS on 443, no port in the URL):

| Device | Declared in |
|---|---|
| `keycloak-admin` | `infrastructure/services/base/keycloak/app/ingress-tailscale.yaml` |
| `ai-gateway` | `infrastructure/services/base/ai-gateway/ingress-tailscale.yaml` |
| `pgadmin` | `infrastructure/services/staging/databases/dbtools/pgadmin-ingress-tailscale.yaml` |
| `nao` | `infrastructure/services/staging/databases/dbtools/nao-ingress-tailscale.yaml` |
| `n8n` | `apps/base/n8n/ingress-tailscale.yaml` |
| `seaweedfs-s3` | `infrastructure/controllers/staging/seaweedfs-cluster/ingress-tailscale.yaml` |
| `seaweedfs-admin` | `infrastructure/controllers/staging/seaweedfs-cluster/ingress-tailscale-admin.yaml` — no password; the tailnet is the only gate |
| `linstor-gui` | `infrastructure/controllers/staging/linstor-cluster/ingress-tailscale.yaml` — use `/ui/#!/`; the bare root 303s to an absolute `http://…:80/` the proxy does not serve. Also serves the unauthenticated `/v1` REST API |
| `grafana` | `monitoring/controllers/base/kube-prometheus-stack/release.yaml` (`grafana.ingress`) — the only chart-rendered one; the chart owns the object, so there is no `ingress-tailscale.yaml` to find |

### Egress Services (`egress-proxies.yaml`)

Each entry is an `ExternalName` Service naming its target either by tailnet IP
(`tailscale.com/tailnet-ip`, which is what all five entries here use) or by
MagicDNS name (`tailscale.com/tailnet-fqdn`). The operator creates a proxy pod
(`ts-<service-name>-…`, the only tailnet member in the path) and overwrites
`externalName` with that proxy's DNS name. The TCP port is preserved end to end,
and any namespace can consume the local name.

| Service | Tailnet IP | Port | Consumer |
|---|---|---|---|
| `tailscale-proxy-00` | `100.100.98.5` | 8888 (HTTP proxy) | scraper pool `tailscale` — `apps/staging/scraper/release.yaml`, `engine.pools[].url` |
| `tailscale-proxy-scrape-c` | `100.92.142.13` | 8888 (HTTP proxy) | scraper pool `c`, same file |
| `garage-node-a` | `100.122.58.119` | 3900 (Garage S3 API) | HAProxy gateway, `infrastructure/services/staging/garage-gateway` |
| `garage-node-b` | `100.122.210.124` | 3900 + 8888 | same gateway, **and** scraper pool `b` |
| `garage-node-c` | `100.92.142.13` | 3900 | same gateway |

The scraper path:

```
workload  →  tailscale-proxy-00.tailscale.svc.cluster.local:8888   (plain ClusterIP svc)
               →  operator egress proxy pod  ts-tailscale-proxy-00  (the only tailnet member)
                    →  rsp-asp.tail45b0ca.ts.net  ==  100.100.98.5:8888   (residential exit)
```

The Garage path is not consumed directly: the in-cluster HAProxy gateway
load-balances and health-checks across `garage-node-{a,b,c}` and exposes one
endpoint, `garage-s3.garage-gw.svc.cluster.local:3900`, to etcd-backup and the
CNPG barman sidecars. See
[../../../../documentations/12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md)
and [../../../../documentations/09-etcd-backup-dr.md](../../../../documentations/09-etcd-backup-dr.md).

## Why it is like this

### Tailscale rather than a LoadBalancer or a public ingress

The admin UIs front a no-auth control surface: the asp orchestrator has no auth,
the fbref BFF queries the database directly, the LINSTOR GUI has none and can
delete a storage pool, and the SeaweedFS admin UI has none and can delete a
bucket. A LAN LoadBalancer (`192.168.1.50:<port>`) would let anyone on the home
network drive them; a public ingress is worse. Tailscale authenticates by tailnet
identity and never touches the internet. The cost is stated in
[../../../../documentations/14-design-decisions.md](../../../../documentations/14-design-decisions.md):
this is a single, unbacked authentication plane in front of surfaces with no
authorization behind them, there is no second factor, and none of the ACL
configuration can be expressed in Flux.

### Two publication mechanisms

A password-authenticated console whose session cookie belongs on a secure origin
gets the `Ingress` (HTTPS, MagicDNS certificate). A byte stream or a plain UI
where the Service port must be preserved gets the `tailscale.com/expose`
annotation. `ai-gateway` additionally carries API credentials in request headers,
which is why it is on the HTTPS path. For three of the `Ingress` devices the
address is load-bearing beyond reachability, so the device name cannot be
changed alone.
`keycloak-admin` is one value in three places: `spec.hostname.admin` in
`infrastructure/services/base/keycloak/app/keycloak.yaml`, the `master` realm's
`frontendUrl` in `infrastructure/services/base/keycloak/realm/realm-master.yaml`
— the URL that realm then advertises as its OIDC issuer — and the device name
itself; a mismatch kills the console with
`Timeout when waiting for 3rd party check iframe message.` `n8n` needs
`N8N_HOST` and `WEBHOOK_URL` (`apps/staging/n8n/configmap.yaml`) to be that same
tailnet host. `nao` is reachable on two hosts, so `BETTER_AUTH_TRUSTED_ORIGINS`
(`infrastructure/services/staging/databases/dbtools/nao-env-patch.yaml`) must
list `https://nao.tail45b0ca.ts.net` next to the public origin — its
`BETTER_AUTH_URL` is the public address — or every login on the tailnet path is
refused with 403 `INVALID_ORIGIN`.

### OAuth client, and `oauth: {}`

The operator runs an OAuth2 client-credentials exchange, so it needs an OAuth
**client**, not an auth key. The credentials are pre-created as the SOPS
`operator-oauth` Secret in the `tailscale` namespace; leaving `values.oauth`
empty makes the chart skip templating its own Secret and consume ours instead.
`release.yaml` is plaintext GitOps, so credentials can never live in it.

### Privileged PodSecurity on the namespace

Talos enforces `baseline` PodSecurity cluster-wide. Tailscale proxy pods need
`NET_ADMIN` for kernel networking, which `baseline` forbids, so admission refuses
to create them and the operator's StatefulSets sit at `0/1` with zero pods.
Labelling the namespace `privileged` is what makes the proxies creatable.

### API server proxy in auth mode

`apiServerProxyConfig.mode: "true"` selects auth mode: the in-process proxy
impersonates the caller's tailnet identity and Kubernetes RBAC (driven by an ACL
grant) decides access, so no client certificate ever ships to a laptop.
`allowImpersonation: "true"` creates the ClusterRole the proxy needs to do that.
The proxy is the operator's own tailnet device, named `tailscale-operator`
because that is the chart default — `release.yaml` sets only `values.oauth` and
`values.apiServerProxyConfig`, no `operatorConfig`. The Talos API is not covered
by this: `talosctl` (apid `:50000`) would need the `.200` subnet route or the Talos
`siderolabs/tailscale` extension, neither of which is reachable without LAN or
Talos access.

### Egress Services as a central pool

Keeping all exits here means the consumers point at stable local names instead of
raw `100.x` tailnet addresses, and a new exit is one block copied in
`egress-proxies.yaml` — bump the number (`tailscale-proxy-01`, `-02`, …) and
point it at the new target — plus one lane on the consumer side. For Garage the
same argument is made one level up: the Talos nodes are not tailnet members, only
the operator's proxy pods are, and the HAProxy gateway turns three tailnet devices
into one ClusterIP with health checking so no consumer has to know three
addresses. A restore deliberately does not retrace that path and goes direct to a
node's tailnet IP, because the gateway is in-cluster only.

`garage-node-b` was declared while its host was offline so the gateway would pick
it up the moment it joined. It has since joined, and it now does double duty: the
operator's egress proxy forwards every TCP port to its target, so this one Service
reaches Garage's S3 API on 3900 *and* node B's HTTP proxy on 8888 — which is what
scraper pool `b` dials. That reuse is why there is no `tailscale-proxy-scrape-b`,
and it is also the trap: pruning this Service when node B leaves the Garage
cluster silently removes the scraper pool's egress with it.

### `tailscale-proxy-scrape-c` — the provider half of scraper pool `c`

The scraper HelmRelease has referenced this name since the pool `c` entry landed,
but only the consumer side existed: `engine-pool-c` and `solver-c` rendered and
sat at 0 replicas while the name itself was NXDOMAIN, so the pool could never
have served anything. This Service is the provider half. It targets the same host
as `garage-node-c` (`100.92.142.13`) — that Service proved the host was on the
tailnet, but it targets Garage's S3 API on 3900, whereas pool `c` needs an HTTP
proxy listening on 8888.

Both have since been verified: pool `c` exits on `37.65.172.70` and is flagged
`residential` in the scraper's `pools` table (admin UI → Egress pools → Routing),
which is where that switch lives — the backend adopts chart pools
`ON CONFLICT DO NOTHING`, so the table wins once the row exists. Node B's proxy on
`garage-node-b:8888` was verified the same way (`31.39.215.32`) and is pool `b`,
which has no Service of its own here at all.

## Traps

- The `tailscale` namespace must stay `pod-security.kubernetes.io/enforce:
  privileged`. Under Talos' cluster-wide `baseline`, the proxy StatefulSets show
  `0/1` with no pod at all and the event reads `… violates PodSecurity "baseline"`.
- `values.oauth` must stay `{}`. Filling it makes the chart template its own
  Secret and ignore `operator-oauth`; it also puts credentials in a plaintext,
  committed file.
- The Secret keys must be named exactly `client_id` and `client_secret` — the
  chart reads those names.
- Use an OAuth **client**, never an *auth key*. An auth key yields
  `oauth2: cannot fetch token: 401 … API token invalid` and the pod CrashLoops.
- `apiServerProxyConfig.mode` is the **string** `"true"`, and it means auth mode
  (impersonation), not merely "enabled".
- `externalName: placeholder` in `egress-proxies.yaml` is intentional. The
  operator overwrites it with the egress proxy's Service DNS name; setting a real
  value there is what breaks.
- `tailscale-proxy-scrape-c` and `garage-node-c` share the tailnet IP
  `100.92.142.13` but expect different services on different ports (8888 HTTP
  proxy vs 3900 Garage S3). One working does not imply the other works.
- A pool's `residential` flag is the routing key and lives in the scraper `pools`
  table, not in the chart values — the backend adopts chart pools
  `ON CONFLICT DO NOTHING`, so the table wins once the row exists. Mislabelling a
  datacenter exit as residential puts every site's traffic on an IP anti-bot
  vendors already distrust.
- Declaring an egress Service here is no longer the second half of adding a pool.
  A pool is a row (`POST /v1/pools`), and `scraper-poolctl` now creates its
  FlareSolverr from the chart's own template — so what this file still owns is the
  tailnet path, and only that. See
  [../../../../apps/staging/scraper/README.md](../../../../apps/staging/scraper/README.md).
- Never put both `tailscale.com/expose` and a Tailscale `Ingress` on the same
  workload: that registers two tailnet devices contending for one hostname and
  the loser is silently suffixed. The same happens with a leftover device — a
  stale `nao` from the old `expose` setup makes MagicDNS hand the newcomer `nao-1`,
  and the mismatch loops the login.
- ACL tags are a precondition Flux cannot create: `tag:k8s-operator` and
  `tag:k8s`, with the operator owning `tag:k8s`. Without them a proxy pod
  registers and then logs
  `requested tags [tag:k8s] are invalid or not permitted`.
- Every HTTPS path (Tailscale `Ingress`, API server proxy) needs **HTTPS
  Certificates** enabled by hand in the admin console (DNS → HTTPS Certificates).
- The chart version in `release.yaml` is pinned and bumped by Renovate.
- The Talos API is not on the tailnet. This operator covers Kubernetes only.

## Operating it

### One-time setup (manual — Flux cannot do these)

**1. ACL tags** (admin console → Access Controls). The operator authenticates as
a tagged device and tags every proxy it creates `tag:k8s`:

```jsonc
"tagOwners": {
  "tag:k8s-operator": ["autogroup:admin"],
  "tag:k8s":          ["tag:k8s-operator"]
}
```

Your own user/devices must be allowed to reach `tag:k8s` (the default allow-all
policy does).

**2. OAuth client.** Settings → OAuth clients → Generate. Scopes: Devices Core =
write **and** Auth Keys = write. Tag: `tag:k8s-operator`. Copy the client **id**
(`k…`) and **secret** (`tskey-client-…`).

**3. SOPS secret.**

```bash
cd infrastructure/controllers/staging/tailscale-operator
sops operator-oauth.enc.yaml        # set the two keys, save = re-encrypt
#   client_id:     k123Cdef
#   client_secret: tskey-client-k123Cdef-xxxx
```

**4. Commit.** The directory is wired in `../kustomization.yaml`;
`kubectl kustomize infrastructure/controllers/staging` must build, then commit and
push and let Flux reconcile.

### Reaching the published devices

`expose` devices answer plain HTTP on their own Service port:

```
http://asp-admin-ui.tail45b0ca.ts.net:8080
http://fbref-admin-ui.tail45b0ca.ts.net:8080
```

`Ingress` devices answer HTTPS on 443, no port in the URL:

```
https://keycloak-admin.tail45b0ca.ts.net   # admin console (ns identity)
https://ai-gateway.tail45b0ca.ts.net       # dashboard + LLM API (ns ai-gateway)
https://pgadmin.tail45b0ca.ts.net          # SQL client (ns database)
https://nao.tail45b0ca.ts.net              # analytics agent (ns database)
https://seaweedfs-admin.tail45b0ca.ts.net  # SeaweedFS admin UI (ns seaweedfs)
https://linstor-gui.tail45b0ca.ts.net/ui/#!/   # LINSTOR GUI (ns piraeus-datastore)
```

### kubectl over the tailnet

Precondition: the operator is healthy (`kubectl -n tailscale get pods`) and the
OAuth client plus the `tag:k8s` / `tag:k8s-operator` ACL are in place — the API
server proxy reuses them. Then, once:

1. Enable HTTPS Certificates (admin console → DNS).
2. Add an ACL grant mapping your user to an impersonated group. `system:masters`
   is the built-in cluster-admin and needs no extra RBAC:

   ```jsonc
   "grants": [
     {
       "src": ["autogroup:admin"],          // or "your-user@"
       "dst": ["tag:k8s-operator"],
       "app": {
         "tailscale.com/cap/kubernetes": [
           { "impersonate": { "groups": ["system:masters"] } }
         ]
       }
     }
   ]
   ```

   For something narrower, bind your own ClusterRole and impersonate a custom
   group instead of `system:masters`.
3. Generate the kubeconfig on the client:

   ```bash
   tailscale configure kubeconfig tailscale-operator   # exact name: Machines page
   kubectl get nodes
   ```

### Verifying an egress path

```bash
kubectl -n tailscale get pods                       # ts-tailscale-proxy-00-… must be 1/1
kubectl -n asp run nettest --rm -it --image=curlimages/curl --restart=Never -- \
  -x http://tailscale-proxy-00.tailscale.svc.cluster.local:8888 https://api.ipify.org
#   → prints rsp-asp's residential IP (not the cluster/home IP)
```

Before flagging pool `c` residential, confirm its exit is a distinct,
non-datacenter address:

```bash
kubectl -n scraper run ipcheck --rm -it --restart=Never \
  --image=curlimages/curl:8.11.1 -- curl -s \
  -x http://tailscale-proxy-scrape-c.tailscale.svc.cluster.local:8888 \
  https://ifconfig.me
```

The direct egress is `37.65.67.42` and `tailscale-proxy-00` exits on an IPv6 in
`2001:861::/32`, so a third distinct address is what success looks like.

Garage backend health is visible on `/stats`, port `8404` of a `garage-gateway`
pod, which shows which of `garage-node-{a,b,c}` are up.

### Troubleshooting (failures actually hit)

| Symptom | Cause | Fix |
|---|---|---|
| operator CrashLoops, log `oauth2: cannot fetch token: 401 … API token invalid` | an auth key was used, not an OAuth client | create an OAuth client; set `client_id`/`client_secret` |
| operator Running but no proxy pods; `ts-…` StatefulSets show `0/1` with zero pods (pod NotFound) | Talos PSA enforces `baseline`; proxies need `NET_ADMIN` so admission refuses the pod | `namespace.yaml` labels the namespace `privileged` (applied) |
| StatefulSet event `… violates PodSecurity "baseline"` | same as above | same |
| proxy pod registers, then logs `requested tags [tag:k8s] are invalid or not permitted` | `tag:k8s` not defined or not owned by the operator in the ACL | add the ACL tags |
| Service annotated but the operator never makes a proxy | deployed chart predates `adminUi.service.annotations` | ship the chart with that template and let the HelmRelease upgrade |
| device shows in Machines but is unreachable | your device is not permitted to reach `tag:k8s` | ACL grant `your-user → tag:k8s` |

Inspect with `kubectl -n tailscale logs deploy/operator --tail=50`,
`kubectl -n tailscale describe statefulset <ts-…>`, and
`kubectl -n tailscale get pods,statefulset`.

### Notes

- The admin-ui chart NetworkPolicy is egress-only, so operator-proxy ingress is
  already allowed; no NetworkPolicy selects the scraper pods, so cluster →
  `tailscale` namespace egress is unrestricted and the egress path works without
  policy changes.
