# homepage

One page with every admin UI a click away, the cluster's CPU and memory, pod
status next to each UI, the Cloudflare tunnel's health, whether the cluster can
reach each tailnet device it depends on, and which tailnet devices are online.
It runs [Homepage](https://gethomepage.dev) as a plain Deployment in the
`homepage` namespace and is published on the tailnet at
`https://homepage.tail45b0ca.ts.net` and nowhere else.

## How it is wired

Base — `infrastructure/services/base/homepage/`: how Homepage runs.

| File | What it does |
|---|---|
| `kustomization.yaml` | The four objects below, `namespace: homepage`. |
| `namespace.yaml` | Namespace `homepage`, PodSecurity `restricted` on enforce, audit and warn. |
| `rbac.yaml` | ServiceAccount `homepage`, a read-only ClusterRole (`get`/`list` on namespaces, pods, nodes, and `metrics.k8s.io` nodes and pods), and its binding. |
| `deployment.yaml` | One replica of `ghcr.io/gethomepage/homepage`, non-root (UID/GID 1000), all capabilities dropped. Loads env from ConfigMap `homepage-env` and Secret `homepage-secrets`, mounts the five config files from ConfigMap `homepage-config` over an `emptyDir` at `/app/config`. |
| `service.yaml` | ClusterIP `homepage:3000`. No Tailscale annotations. |

Staging — `infrastructure/services/staging/homepage/`: what this cluster's page shows.

| File | What it does |
|---|---|
| `kustomization.yaml` | The base, the Ingress and the Secret, plus two generators: `homepage-config` from `config/*.yaml`, and `homepage-env` carrying `HOMEPAGE_ALLOWED_HOSTS`. |
| `ingress-tailscale.yaml` | `Ingress` with `ingressClassName: tailscale`, `defaultBackend` → `homepage:3000`, `tls.hosts: [homepage]`. HTTPS on 443 with a MagicDNS certificate. |
| `homepage-secrets.enc.yaml` | SOPS Secret: Cloudflare account ID, tunnel ID and API token, and the Tailscale API token, as `HOMEPAGE_VAR_*` env vars. |
| `homepage-secrets.enc.yaml.example` | Its plaintext template. |
| `config/settings.yaml` | Title, theme, and the group order and column layout. |
| `config/services.yaml` | Every tile: link, in-cluster health check, pod status, and the service widgets. |
| `config/widgets.yaml` | The header: cluster and per-node CPU and memory. |
| `config/bookmarks.yaml` | Cloudflare, Tailscale and GitHub dashboard links. |
| `config/kubernetes.yaml` | `mode: cluster` (the ServiceAccount), every discovery source off. |

Wired from `infrastructure/services/staging/kustomization.yaml`, reconciled by
the `infrastructure-services` Flux Kustomization, which already carries the SOPS
`decryption` block. There is no production overlay.

### What the page shows

**Header** — the `kubernetes` info widget: cluster-wide and per-node CPU and
memory from `metrics.k8s.io`. metrics-server is installed by Talos
(`bootstraping/talconfig.yaml`, `extraManifests`), not by Flux.

**Tiles** (`config/services.yaml`) — each carries up to three things:

- `href`: what the browser opens, the tailnet or public URL.
- `siteMonitor`: an HTTP check **made by the pod**, so it names the in-cluster
  Service, never the `ts.net` URL (see Traps).
- `namespace` + `app` or `podSelector`: pod status, CPU and memory, read through
  the ClusterRole.

**Network tiles** — two service widgets:

- *Cloudflare tunnel* — the `cloudflared` widget: tunnel status and origin IP,
  from the Cloudflare API.
- *Tailnet devices* — a `customapi` widget in `dynamic-list` mode over
  `GET https://api.tailscale.com/api/v2/tailnet/-/devices`, one row per device,
  `connectedToControl` remapped to online/offline. It covers the whole tailnet
  with one token and no device IDs, which the built-in `tailscale` widget (one
  device per widget, by ID) cannot.

**Tailnet connections** — one tile per egress Service in
`infrastructure/controllers/staging/tailscale-operator/egress-proxies.yaml`, the
paths the cluster itself dials into the tailnet. These answer a different
question from the device list: not "is the device logged in to Tailscale" but
"can the cluster reach it right now, on the port that matters". Each tile has two
signals, so a failure says which half broke:

- pod status of the operator's egress proxy pod
  (`tailscale.com/parent-resource=<service>,tailscale.com/parent-resource-type=svc`)
  — the cluster side;
- for the three Garage nodes, a `siteMonitor` on
  `http://garage-node-<x>.tailscale.svc.cluster.local:3900` — the same name and
  port the HAProxy gateway health-checks, so it crosses the egress proxy and the
  tailnet to the node. An unauthenticated S3 request returns `403`, which counts
  as up; a node that is off or unreachable is a connection error.

The *Garage gateway* tile checks `garage-s3.garage-gw.svc:3900`, up while at
least one node answers. Per-node backend state beyond that is on HAProxy's
`/stats` page (`../garage-gateway/README.md`).

**Bookmarks** — Cloudflare (tunnels, DNS, R2, API tokens), Tailscale (machines,
ACL, DNS, keys), GitHub (repo, PRs, Actions). The Cloudflare links are built from
`{{HOMEPAGE_VAR_CF_ACCOUNT_ID}}`.

## Why it is like this

### Tailnet only

A page listing every admin hostname, with cluster stats behind a ClusterRole, is
an admin surface, and admin surfaces live on the tailnet and nowhere else
([documentations/14-design-decisions.md](../../../../documentations/14-design-decisions.md)).
That also answers "am I on the tailnet": if the page loads, you are. Homepage's
own login (`HOMEPAGE_AUTH_ENABLED`, new in v2) is left off — the tailnet is the
gate, as it is for every other device the operator publishes.

Rejected: a Cloudflare public hostname behind Access, with browser-side JS
probing a `ts.net` URL to show a connected/disconnected badge. It works, and it
puts a map of the admin surface on the internet.

### Plain manifests, not the Helm chart

The community chart (`jameswynn/homepage`) was the first plan and was dropped:

- Its last release is 2.1.0 from May 2025, shipping app v1.2.0 while Homepage
  is on v2.x; the image tag would be overridden anyway.
- It renders config through Helm's `toYaml`, which sorts keys and loses the
  group order unless every file is passed as an opaque `*String` block.
- Its ClusterRole also grants ingresses, Traefik and Gateway API objects, and
  CRD status, all of which only feed discovery that this page does not use.

Plain manifests keep the config as real YAML files that `kubectl kustomize`
renders, and a config edit changes the `homepage-config` hash, which rolls the
pod. That roll is required, not a side effect: the files are `subPath` mounts,
and a `subPath` mount never sees ConfigMap updates.

The image is bumped by Renovate through the `# renovate:` comment above
`image:` in `deployment.yaml`, read by the regex custom manager in
`renovate.json`. Keep the two lines adjacent.

### Static `services.yaml`, not Ingress discovery

Discovery (`gethomepage.dev/*` annotations) cannot see half the UIs:

- `tailscale.com/expose` devices (radar, the admin UIs of asp, fbref and
  scraper) have a Service and no Ingress.
- The Tailscale Ingresses carry a bare device name, not a hostname, so every one
  would need an explicit `gethomepage.dev/href` anyway.
- Grafana's Ingress is rendered by its chart.

One file beats annotations spread across a dozen components, and it also holds
what is not in Kubernetes at all (the Cloudflare and Tailscale tiles).
`config/kubernetes.yaml` turns `ingress`, `traefik` and `gateway` off
explicitly: `ingress` defaults to on and would log a 403 on every refresh
against this ClusterRole.

### Security context

`restricted` PodSecurity, non-root, no privilege escalation, no capabilities,
`RuntimeDefault` seccomp. `readOnlyRootFilesystem` is **not** set, and was not
tested: Homepage serves `/` as an incrementally regenerated Next.js page
(`getStaticProps`, re-rendered through `/api/revalidate` when config changes),
and Next.js keeps that render cache under `/app/.next`, which holds the build
itself and so cannot take an `emptyDir`. `/app/config` must also be writable
(skeleton copies, `logs/`); the `emptyDir` covers that.

## Traps

- **`HOMEPAGE_ALLOWED_HOSTS` must equal the tailnet hostname**, exactly as the
  proxy sends it: `homepage.tail45b0ca.ts.net`, no port. Rename the device in
  `ingress-tailscale.yaml` without changing the literal in `kustomization.yaml`
  and every request returns `400 Host validation failed`. After a rename, check
  `kubectl -n homepage get ingress homepage` shows the new name without a `-1`
  suffix — a leftover device holding the name makes MagicDNS suffix the newcomer,
  and the suffixed Host then fails the same check. The device was renamed from
  `home` on 2026-09-14.
- **The probes send `Host: localhost:3000`.** The host check covers
  `/api/healthcheck` too, and a kubelet probe's default Host is the pod IP, which
  is not in the list. `localhost:3000` is always allowed.
- **`siteMonitor` must name an in-cluster URL.** The pod is not a tailnet member
  (only the operator's proxy pods are), so a `siteMonitor` on a `*.ts.net` URL
  never resolves and the tile shows down forever while `href` works fine. To
  check a tailnet device, go through its egress Service in the `tailscale`
  namespace, as the Tailnet connections tiles do.
- **The two scraper exit tiles have no `siteMonitor`, on purpose.**
  `tailscale-proxy-00` and `tailscale-proxy-scrape-c` are HTTP forward proxies on
  8888; a direct request (not proxy-form) gets `500`, which Homepage renders as
  down even when the exit works. Only the egress pod is shown. `garage-node-c`
  shares its tailnet IP with `scrape-c`, so a green Garage node c says the
  device is up but not that its proxy is.
- **The Keycloak tile has no `siteMonitor`, on purpose.** Keycloak's
  NetworkPolicy (`keycloak.yaml`, `networkPolicy`) admits plain HTTP on 8080
  only from the `tailscale` namespace and HTTPS on 8443 only from `cloudflare`
  and `identity`; the rest is TLS signed by a private CA that Homepage does not
  trust. Pod status still works — it goes through the API server, not the pod.
- **Pod selectors are copied, not derived.** Every one was checked against the
  live cluster on 2026-09-14; a chart upgrade that renames labels breaks the tile
  silently. Radar, LINSTOR and SeaweedFS use `podSelector: ""`, which counts every
  pod in the namespace (a `Succeeded` Job pod counts as healthy) — for the two
  storage tiers that is the point. A tile reading "not found" means its selector
  matches nothing: check with `kubectl -n <ns> get pods --show-labels`.
- **Mounting a new config file needs two edits**: the generator list in the
  staging `kustomization.yaml`, and a `subPath` mount in `deployment.yaml`. A file
  only in the ConfigMap is ignored; Homepage copies its skeleton instead.
- **The Tailscale API token expires** after at most 90 days. When it does, the
  Tailnet devices tile shows an API error and nothing else breaks — the Tailnet
  connections tiles use no token. The widget cannot use an OAuth client — it
  sends one static bearer token.
- **The Secret ships with two `REPLACE_ME` tokens.** Until they are filled, the
  Cloudflare tunnel and Tailnet devices tiles show an API error; the rest of the
  page works.

## Operating it

### Filling the Secret

1. Cloudflare → My Profile → API Tokens → Create Token → Custom: permission
   **Account › Cloudflare Tunnel › Read**, scoped to the one account.
2. Tailscale admin → Settings → Keys → **Generate access token**. Set the expiry
   and put the date in a calendar.
3. Edit the values in place (account and tunnel IDs are already filled):

   ```bash
   SOPS_AGE_KEY_FILE=clusters/staging/age.agekey \
     sops infrastructure/services/staging/homepage/homepage-secrets.enc.yaml
   ```

4. Commit, push. A Secret change does not roll the pod — `envFrom` is read at
   start — so after Flux applies it:

   ```bash
   kubectl -n homepage rollout restart deploy/homepage
   ```

### Adding a tile

Add an entry to `config/services.yaml` under its group. Use the in-cluster
Service for `siteMonitor`, and give pod status with `namespace` plus `app`
(matches `app.kubernetes.io/name=<app>`) or `podSelector` for any other label.
Render-check and push; the ConfigMap hash rolls the pod.

### Verifying

```bash
kubectl kustomize infrastructure/services/staging/homepage
kubectl -n homepage get pods,ingress
kubectl -n homepage logs deploy/homepage --tail=50   # widget and host-check errors land here
```

Then open `https://homepage.tail45b0ca.ts.net`.
