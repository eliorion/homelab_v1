# homepage

One page with every admin UI a click away, the cluster's CPU and memory, pod
status next to each UI, the public applications checked end to end, and whether
each Garage node's S3 API is reachable from the cluster. It runs [Homepage](https://gethomepage.dev) as a plain Deployment in the
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
| `homepage-secrets.enc.yaml` | SOPS Secret: the Cloudflare account ID as `HOMEPAGE_VAR_CF_ACCOUNT_ID`, used by the bookmarks. No API tokens. |
| `homepage-secrets.enc.yaml.example` | Its plaintext template. |
| `config/settings.yaml` | Title, theme, and the group order and column layout. |
| `config/services.yaml` | Every tile: link, health check, pod status, and the Grafana tile's alert counts. |
| `config/widgets.yaml` | The header: cluster and per-node CPU and memory. |
| `config/bookmarks.yaml` | Cloudflare, Tailscale and GitHub dashboard links. |
| `config/kubernetes.yaml` | `mode: cluster` (the ServiceAccount), every discovery source off. |

Wired from `infrastructure/services/staging/kustomization.yaml`, reconciled by
the `infrastructure-services` Flux Kustomization, which already carries the SOPS
`decryption` block.

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

**Public apps** — the applications behind the Cloudflare tunnel (AzuraCast,
Nextcloud, nao, the fbref MCP, Keycloak's realm endpoints). Each `siteMonitor`
is the **public** URL, so a green tile means DNS, the Cloudflare edge, the tunnel
and the pod all worked. The tunnel itself has no tile.

**Garage S3** — one tile per Garage node plus the gateway, each showing `UP` or
`DOWN` (`statusStyle: basic`) for one question: does that node's S3 API answer
the cluster right now?

| Tile | `siteMonitor` | Path |
|---|---|---|
| Node a S3 | `http://garage-node-a.tailscale.svc.cluster.local:3900` | egress proxy → tailnet → `100.122.58.119:3900` (home site) |
| Node b S3 | `http://garage-node-b.tailscale.svc.cluster.local:3900` | … → `100.122.210.124:3900` (off site) |
| Node c S3 | `http://garage-node-c.tailscale.svc.cluster.local:3900` | … → `100.92.142.13:3900` (off site) |
| Gateway S3 | `http://garage-s3.garage-gw.svc.cluster.local:3900` | HAProxy, round-robin over the three above |

The node URLs are the egress Services from
`infrastructure/controllers/staging/tailscale-operator/egress-proxies.yaml`, the
same names and port the HAProxy gateway health-checks. The request is unsigned,
and Garage answers it with `403` and the body `AccessDenied: Garage does not
support anonymous access yet` — Homepage counts `≤ 403` as up, so `UP` means
Garage's S3 API itself replied, not merely that a port was open. A node that is
off, off the tailnet, or not listening gives a connection error, shown `DOWN`.
The gateway is `UP` while at least one node answers; HAProxy's `/stats` page has
the per-backend view (`../garage-gateway/README.md`).

**Bookmarks** — Cloudflare (tunnels, DNS, R2, API tokens), Tailscale (machines,
ACL, DNS, keys), GitHub (repo, PRs, Actions). The Cloudflare links are built from
`{{HOMEPAGE_VAR_CF_ACCOUNT_ID}}`.

### Removed on purpose

The page shows whether **services** are available, not infrastructure
inventories:

- the Cloudflare tunnel tile (`cloudflared` widget, tunnel status and origin IP
  from the Cloudflare API) — the public apps' end-to-end checks already fail if
  the tunnel does;
- the tailnet device list (`customapi` over the Tailscale devices API) — "is a
  device logged in to Tailscale" is not "is its service reachable";
- the scraper exit tiles (`tailscale-proxy-00`, `tailscale-proxy-scrape-c`) —
  see Traps; the only honest signal was egress pod status, which does not answer
  whether the exit works.

Both API tokens went with them, so the Secret holds no credential.

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
what is not a Kubernetes object at all (the public URLs, the Garage nodes).
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
  namespace, as the Garage S3 tiles do.
- **Garage `UP` is reachability, not usability.** The check is unsigned, so it
  proves the S3 API answers — not that the credentials, the bucket, or the
  region are right. Doc 12's postmortem is exactly that case: everything healthy
  until `HeadBucket`. Backup health lives in the CNPG and etcd-backup alerts.
- **Do not add a `siteMonitor` for the scraper exits.** `tailscale-proxy-00` and
  `tailscale-proxy-scrape-c` are HTTP forward proxies on 8888; a direct request
  (not proxy-form) gets `500`, which Homepage renders as down even when the exit
  works. `garage-node-c` shares its tailnet IP with `scrape-c`, so Node c S3
  `UP` says nothing about that proxy.
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
- **A Secret change does not roll the pod.** `envFrom` is read at start; after
  editing `homepage-secrets.enc.yaml` and letting Flux apply it, run
  `kubectl -n homepage rollout restart deploy/homepage`.

## Operating it

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
