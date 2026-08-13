# scraper

`scraper` is the cluster's central scraping platform: a backend, an admin UI, request-driven
engine pools and one FlareSolverr per pool, all in their own `scraper` namespace against their
own CNPG cluster `scraper-db`. It is API-only — a client's ingest pods POST to `/v1/scrape` and
read the results back, and the API is the only contract between a project and this service.
`fbref` is its only client today; `asp` ships with `ingest.enabled: false`. The platform itself
stores no scraped data. As with the other app wrappers, this directory holds a single
`HelmRelease` pointing at a chart in the private `asp` repository (`k8s/charts/scraper`); the
values here are environment overrides only.

## How it is wired

Files in this directory:

| File | What it does |
|---|---|
| `kustomization.yaml` | sets `namespace: scraper` and lists `release.yaml` |
| `release.yaml` | `HelmRelease` `scraper`, `targetNamespace: scraper` |

Note that `release.yaml` declares `metadata.namespace: flux-system`, but the kustomization's
`namespace: scraper` overrides it: the rendered HelmRelease lives in the **`scraper`** namespace
(`kubectl kustomize apps/staging/scraper` confirms this). That is why
`chart.spec.sourceRef.namespace: flux-system` is spelled out — without it the release would look
for the GitRepository in its own namespace and never find it.

`release.yaml` settings: `interval: 1m`, `timeout: 10m`, chart `k8s/charts/scraper` from
GitRepository `scraper` in `flux-system` with `chart.spec.interval: 1m` and
`reconcileStrategy: Revision`, `install.createNamespace: true`, `install.remediation.retries: 3`,
`upgrade.remediation` `retries: 3` / `strategy: rollback` / `remediateLastFailure: true`,
`rollback.cleanupOnFail: true`, `test.enable: true` with `ignoreFailures: false`, and
`driftDetection.mode: enabled`.

Values set here:

| Value | Setting |
|---|---|
| `global.imagePullSecrets` | `ghcr-pull-secret` — the private `ghcr.io/eliorion/scraper-*` images |
| `solver.enabled` | `true` |
| `solver.proxyEgressPorts` | `[8888]` |
| `engine.pools` | `direct` (`residential: true`), `tailscale` (`residential: true`, `http://tailscale-proxy-00.tailscale.svc.cluster.local:8888`), `c` (`http://tailscale-proxy-scrape-c.tailscale.svc.cluster.local:8888`) |
| `engine.proxyEgressPorts` | `[8888]` |
| `adminUi.service.annotations` | `tailscale.com/expose: "true"`, `tailscale.com/hostname: scraper-admin-ui` |

Flux applies this through the `apps` Kustomization in
[`../../../clusters/staging/apps.yaml`](../../../clusters/staging/apps.yaml) (`path: ./apps/staging`,
`prune: true`, SOPS decryption, `dependsOn: db-migrations`); `apps/staging/kustomization.yaml`
lists `scraper/` explicitly.

The chart is not in this repository. GitRepository `scraper`
([`../../../clusters/staging/sources.yaml`](../../../clusters/staging/sources.yaml)) points at
`ssh://git@github.com/eliorion/asp`, branch `main`, read-only `asp-deploy-key` Secret,
`interval: 1m0s`, with an `ignore` block scoped to `/k8s/charts/scraper/`.

What this component depends on, and who owns it:

- KEDA — Flux Kustomization `infra-keda`, `path: ./infrastructure/controllers/base/keda`
  ([`../../../clusters/staging/infrastructure.yaml`](../../../clusters/staging/infrastructure.yaml)).
- The Tailscale egress proxies — `tailscale-proxy-00` (tailnet IP `100.100.98.5`) and
  `tailscale-proxy-scrape-c` (`100.92.142.13`), declared in
  `infrastructure/controllers/staging/tailscale-operator/egress-proxies.yaml`. The same
  operator publishes the admin UI on the tailnet.
- `ghcr-pull-secret` — mirrored into `scraper` by the central reflector source,
  [`../../../infrastructure/controllers/staging/reflector/README.md`](../../../infrastructure/controllers/staging/reflector/README.md).
- `scraper-db` — [`../../base/databases/scraper/README.md`](../../base/databases/scraper/README.md).

The admin UI is reached on the tailnet at `https://scraper-admin-ui.<your-tailnet>.ts.net`.

### Overlays

There is no `apps/base/scraper/` and no production overlay: this staging directory is the whole
component.

## Why it is like this

**Values here are environment overrides, never image tags.** The chart's `values.yaml` holds the
image tags and CI bumps them per release. `Chart.yaml`'s version is a human changelog signal
only, which is why the release upgrades on every new git revision of the chart-path-scoped
GitRepository (`reconcileStrategy: Revision`) instead of on a version bump.

**`timeout: 10m`.** The engine pools gate readiness on a Camoufox warm-up (`initialDelay 90s`)
and add `minReadySeconds 30`; a shorter Helm timeout would turn every slow warm-up into a failed
upgrade and a rollback.

**Failure handling.** `test.enable: true` runs the chart's own test hooks — a curl of the
backend's `/v1/health` and of the admin UI — after every install and upgrade, and
`ignoreFailures: false` makes a failing hook fail the release, which is what feeds the
`strategy: rollback` remediation.

**Request-driven warm pools are the only topology.** Pods run with `ROLE=server` and are the
target of `POST /v1/scrape`; the static per-(tenant, site) lanes were removed from the chart
entirely. One pool means one egress IP: a pod leases the lanes bound to its proxy, warms the
anti-bot session behind that IP and serves that lane's requests. KEDA scales each pool — and its
solver — between 0 and 1 on that proxy's pending count, capped at one pod because one pool = one
proxy = one IP = one fingerprint. Throughput is scaled by adding pools, never replicas.

**No site is named in these values, by design.** A site exists when the database says so: a
`lanes` row created by `POST /v1/scrape` and configured by its `site_config`. Onboarding a site
is an API call, not a values edit and a commit.

**`residential: true` is the routing key.** The backend assigns a proxy-less request to the
least-pending residential pool, falling back to `direct`. The two residential pools therefore
split the load across two distinct public IPs, one lane each (lanes are unique per
tenant + site + proxy), each with its own AdaptivePacer budget and its own fingerprint. Routing
is by pool *capability*, never by site or project name — the platform owns that trade-off and a
client cannot pick a lane. Adding another residential exit is +1 lane and roughly linear extra
throughput with no client or code change.

The three pools:

- `direct` — the cluster's own egress. This cluster is home-hosted, so that is a residential IP
  (verified distinct from the `tailscale` exit) rather than a datacenter one, hence
  `residential: true`.
- `tailscale` — the residential exit `rsp-asp`, via the `tailscale-proxy-00` egress Service.
  FlareSolverr forwards `PROXY_URL` into the solve, so that hop uses `solver.proxyEgressPorts`.
  Requires the `tailscale-proxy-00` egress pod to be Ready.
- `c` — node C's exit, deliberately **not** tagged residential yet. Because the flag is the
  routing key, an untagged pool receives zero traffic, so declaring it only proves that its
  Deployment, solver and ScaledObjects render and that the pod can reach the proxy. Once
  scraper-backend carries the `pools` table the flag becomes an admin-UI toggle needing no commit
  here, but the entry is still what renders the pod.

**FlareSolverr is on, and there is one per pool.** Cloudflare-protected pages cannot be cleared
server-side by Camoufox, so they are fetched through FlareSolverr. Its sessions live in per-pod
memory and a session's `cf_clearance` is bound to one egress IP, so a single shared instance
cannot serve several proxies. There is no `replicas` knob: each solver is KEDA-scaled 0↔1
alongside its pool. The pool's `PROXY_URL` is forwarded into the solve so FlareSolverr's Chrome
egresses through the proxy — that is what `solver.proxyEgressPorts: [8888]` is for, while
`engine.proxyEgressPorts: [8888]` covers a pool dialling the Tailscale proxy directly from the
engine pod.

**There is no `keda:` block on purpose.** KEDA is a hard requirement of the chart: no enable flag,
no fixed-replica mode. Every pool and solver is HPA-owned, and an idle namespace is backend-only.

## Traps

- **Never set image tags in `release.yaml`.** The chart's `values.yaml` owns them.
- **`upgrade.remediation.retries: 3` is required, not decorative.** helm-controller performs no
  remediation at the default `retries: 0`, so `strategy: rollback` alone is a no-op.
- **`timeout: 10m` must stay above the pools' warm-up budget** (readiness `initialDelay 90s` plus
  `minReadySeconds 30`).
- **Do not tag pool `c` `residential: true` before verifying its exit IP.** Mislabelling a
  datacenter exit as residential puts every site's traffic on an IP that anti-bot vendors already
  distrust. Confirm it is a distinct, non-datacenter IP first (command below) and compare it
  against `tailscale-proxy-00` and the direct egress. `tailscale-proxy-scrape-c` points at the
  same tailnet host as `garage-node-c` (`100.92.142.13`) but expects an HTTP proxy on `8888`, not
  Garage's S3 API on `3900`.
- **Scale by adding pools, never replicas.** One pool is one proxy is one IP is one fingerprint;
  KEDA caps each pool at a single pod, and a second pod would share a fingerprint.
- **Do not add a `keda:` block or expect a fixed-replica fallback.** Without the `infra-keda`
  operator this release fails to apply its ScaledObjects rather than silently running everything
  unscaled.
- **The `tailscale` pool needs the egress pod Ready.** With `tailscale-proxy-00` down, that pool's
  lane cannot reach its exit.
- **`solver.proxyEgressPorts` and `engine.proxyEgressPorts` are two different hops.** The solver
  entry is for FlareSolverr's Chrome egressing via `PROXY_URL`; the engine entry is for a pool
  dialling the proxy itself. Dropping either silently removes one path to the residential exit.
- **The rendered HelmRelease is in the `scraper` namespace, not `flux-system`**, because the
  kustomization's `namespace:` overrides `metadata.namespace`. Keep
  `chart.spec.sourceRef.namespace: flux-system` — removing it breaks the source reference.
- **`driftDetection.mode: enabled` means hand edits do not survive.** Change the chart or these
  values instead.

## Operating it

```sh
kubectl kustomize apps/staging/scraper      # render check before commit
flux get helmreleases -n scraper scraper
flux reconcile helmrelease scraper -n scraper --with-source
kubectl -n scraper get pods,scaledobject
kubectl -n tailscale get pods               # egress proxies for the tailscale/c pools
```

Check what public IP a pool's proxy actually exits from, before tagging it residential:

```sh
kubectl -n scraper run ipcheck --rm -it --restart=Never \
  --image=curlimages/curl:8.11.1 -- curl -s \
  -x http://tailscale-proxy-scrape-c.tailscale.svc.cluster.local:8888 \
  https://ifconfig.me
```
