# Tailscale operator — admin UI access + cluster egress

Two jobs, both private to the tailnet (gated by tailnet identity, reachable
off-LAN, **never internet-exposed** — no Cloudflare hostname, no public ingress):

1. **Ingress** — publish the **asp** + **fbref** admin UIs and the **Longhorn**
   storage UI onto the tailnet as devices `asp-admin-ui` / `fbref-admin-ui` /
   `longhorn`.
2. **Egress** — let cluster workloads reach a tailnet device (the residential
   proxy `rsp-asp`) through a local Service `tailscale-proxy-00`.

## Why Tailscale (not a LoadBalancer / ingress)

The admin UIs front a **no-auth control surface** (asp orchestrator has no auth;
fbref BFF queries the DB directly; Longhorn's UI has no auth either and can
delete volumes). A LAN LoadBalancer (`192.168.1.50:<port>`) would let anyone on
the home network drive them; a public ingress is worse. Tailscale authenticates
by tailnet identity and never touches the internet.

## Files here

| File | Role |
|---|---|
| `namespace.yaml` | the `tailscale` ns — **labelled `pod-security…=privileged`** (Talos PSA, see Troubleshooting) |
| `repository.yaml` / `release.yaml` | HelmRepository + HelmRelease (`tailscale-operator`, pinned, Renovate-bumped) |
| `operator-oauth.enc.yaml` | SOPS-encrypted OAuth **client** creds |
| `egress-proxies.yaml` | `tailscale-proxy-00` egress Service → `rsp-asp` (`100.100.98.5:8888`) |

The `tailscale.com/expose` annotations on the admin-ui Services live in
`apps/staging/{asp,fbref}/release.yaml`. They require the chart template
`adminUi.service.annotations` (in the asp repo `k8s/charts/{asp,fbref}` — shipped
on `main`); the deployed HelmRelease must be on a chart revision that has it.

The **Longhorn** UI is exposed the same way, but its annotations live in the
Longhorn HelmRelease itself — `infrastructure/controllers/base/longhorn/release.yaml`
(`values.service.ui.annotations`) — which the upstream chart renders onto the
`longhorn-frontend` Service. No app-repo chart change needed.

## One-time setup (manual — Flux can't do these for you)

### 1. ACL tags  (admin console → Access Controls)

The operator authenticates as a tagged device **and** tags every proxy it creates
`tag:k8s`. Define both; the operator must own `tag:k8s`:
```jsonc
"tagOwners": {
  "tag:k8s-operator": ["autogroup:admin"],
  "tag:k8s":          ["tag:k8s-operator"]
}
```
Your own user/devices must be allowed to reach `tag:k8s` (default allow-all does).

### 2. OAuth **client** — NOT an auth key

Settings → **OAuth clients** → Generate. Do **not** use an *Auth key*: the
operator runs an OAuth2 client-credentials exchange; an auth key yields
`401 API token invalid` and the pod CrashLoops.
- Scopes: **Devices Core = write** AND **Auth Keys = write**.
- Tag: `tag:k8s-operator`.
- Copy the client **id** (`k…`) + **secret** (`tskey-client-…`).

### 3. SOPS secret
```bash
cd infrastructure/controllers/staging/tailscale-operator
sops operator-oauth.enc.yaml        # set the two keys, save = re-encrypt
#   client_id:     k123Cdef
#   client_secret: tskey-client-k123Cdef-xxxx
```
Keys MUST be `client_id` / `client_secret` (the chart reads those).

### 4. Commit → Flux reconciles
The dir is wired in `../kustomization.yaml`.
`kubectl kustomize infrastructure/controllers/staging` must build, then commit+push.

## Reaching the admin UIs

After Flux reconciles and the Services are annotated, the operator registers one
device per Service. Reach each on **its own Service port over plain HTTP** — the
`expose` annotation is L3, it forwards the Service port; it is **not** HTTPS/443.
The admin UIs listen on `8080`, the Longhorn UI (`longhorn-frontend`) on `80`:
```
http://asp-admin-ui.tail45b0ca.ts.net:8080
http://fbref-admin-ui.tail45b0ca.ts.net:8080
http://longhorn.tail45b0ca.ts.net          # Service port 80
```
(For HTTPS on 443 you would switch to a Tailscale **Ingress** —
`ingressClassName: tailscale` + MagicDNS HTTPS — not configured here.)

## Egress — reach `rsp-asp` from inside the cluster  (`egress-proxies.yaml`)

```
workload  →  tailscale-proxy-00.tailscale.svc.cluster.local:8888   (plain ClusterIP svc)
               →  operator egress proxy pod  ts-tailscale-proxy-00  (the only tailnet member)
                    →  rsp-asp.tail45b0ca.ts.net  ==  100.100.98.5:8888   (residential exit)
```
Nothing in the workload pod is on the tailnet — the egress proxy bridges it. The
asp scraper consumes it via `apps/staging/asp/release.yaml` →
`scraper.proxies[].url = http://tailscale-proxy-00.tailscale.svc.cluster.local:8888`.

Add more exits: copy the block in `egress-proxies.yaml` (`-01`, `-02`, set the
target IP/FQDN) + add one scraper proxy lane per exit.

Verify the path end-to-end:
```bash
kubectl -n tailscale get pods                       # ts-tailscale-proxy-00-… must be 1/1
kubectl -n asp run nettest --rm -it --image=curlimages/curl --restart=Never -- \
  -x http://tailscale-proxy-00.tailscale.svc.cluster.local:8888 https://api.ipify.org
#   → prints rsp-asp's residential IP (not the cluster/home IP)
```

## API server proxy — kubectl off-LAN  (`release.yaml` values)

Reach the k8s API over the tailnet when you're off the home LAN (the VIP
`192.168.1.100:6443` is unreachable). The operator runs an **in-process API
server proxy** in **auth mode**: it impersonates the caller's tailnet identity,
so k8s RBAC (driven by an ACL grant) decides access — no client cert ships to
the client. The proxy is the operator's own tailnet device, `tailscale-operator`.

> **Talos API is NOT covered.** This is k8s only. `talosctl` (apid `:50000`)
> needs the `.200` subnet route or the Talos `siderolabs/tailscale` extension —
> neither is doable without LAN / Talos reach.

GitOps part (done, in `release.yaml`):
```yaml
values:
  apiServerProxyConfig:
    mode: "true"            # auth mode (impersonate tailnet identity)
    allowImpersonation: "true"  # creates the ClusterRole the proxy needs
```

Manual one-time steps (Flux can't do these):

1. **Tailnet HTTPS certs** — admin console → DNS → enable **HTTPS Certificates**
   (MagicDNS). The proxy serves a `ts.net` cert for its hostname.
2. **ACL grant** — map your user → impersonate `system:masters` (built-in
   cluster-admin, no extra RBAC). The proxy device is tagged `tag:k8s-operator`:
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
   Narrower than admin: bind your own ClusterRole and impersonate a custom group
   instead of `system:masters`.
3. **Generate kubeconfig** (on your laptop, after Flux reconciles on `main`):
   ```bash
   tailscale configure kubeconfig tailscale-operator   # exact name: Machines page
   kubectl get nodes
   ```

Precondition: the operator must be healthy (`kubectl -n tailscale get pods`); the
OAuth client + `tag:k8s`/`tag:k8s-operator` ACL from §1–§3 above must already be
in place — the API server proxy reuses them.

## Troubleshooting (failures we actually hit)

| Symptom | Cause | Fix |
|---|---|---|
| operator CrashLoops, log `oauth2: cannot fetch token: 401 … API token invalid` | an **auth key** was used, not an OAuth client | create an OAuth **client** (§2); set `client_id`/`client_secret` |
| operator Running but **no proxy pods**; `ts-…` StatefulSets show `0/1` with **zero pods** (pod NotFound) | **Talos PSA** enforces `baseline`; tailscale proxies need `NET_ADMIN` → admission refuses to create the pod | `namespace.yaml` labels the ns `pod-security…=privileged` (applied) |
| StatefulSet event `… violates PodSecurity "baseline"` | same as above | same |
| proxy pod registers then log `requested tags [tag:k8s] are invalid or not permitted` | `tag:k8s` not defined / not owned by the operator in ACL | add the ACL tags (§1) |
| Service annotated but operator never makes a proxy | deployed chart predates `adminUi.service.annotations` | put the chart with that template on `main` (done) + let the HelmRelease upgrade |
| device shows in Machines but unreachable | your device not permitted to reach `tag:k8s` | ACL grant `your-user → tag:k8s` |

Inspect: `kubectl -n tailscale logs deploy/operator --tail=50`,
`kubectl -n tailscale describe statefulset <ts-…>`,
`kubectl -n tailscale get pods,statefulset`.

## Notes

- admin-ui chart NetworkPolicy is egress-only → operator-proxy ingress already
  allowed; no scraper NetworkPolicy selects the scraper pods, so cluster→`tailscale`
  ns egress is unrestricted (the egress path works without policy changes).
- Chart version is pinned in `release.yaml`; Renovate bumps it.
