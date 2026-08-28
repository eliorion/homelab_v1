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
| `poolctl.maxSolvers` | `2` — chart default is 4; see Traps |
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
- The Tailscale egress proxies — `tailscale-proxy-00` (tailnet IP `100.100.98.5`),
  `tailscale-proxy-scrape-c` (`100.92.142.13`) and, for pool `b`, `garage-node-b`
  (`100.122.210.124`), all declared in
  `infrastructure/controllers/staging/tailscale-operator/egress-proxies.yaml`. The same
  operator publishes the admin UI on the tailnet.
- The Kubernetes API, for `scraper-poolctl` — the chart's reconciler that gives a pool added
  live its own solver. It runs the backend image with `python -m src.poolctl` under a
  namespace-scoped Role (deployments, services, scaledobjects; get/list/create/delete).
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

**A pool is a row, not a values entry.** `engine.pools` above seeds the `pools` table on
install (`ON CONFLICT DO NOTHING`, so the table wins once a row exists); after that, adding an
egress is `POST /v1/pools` or the admin UI, and a worker picks it up on its next lease. The
`residential` flag is a live toggle in that table, not a commit here.

The solver used to be the exception — Helm renders `solver-<pool>` by ranging over
`engine.pools`, so a live pool had no FlareSolverr and its Cloudflare fetches failed DNS on a
`solver-<name>` that did not exist. `scraper-poolctl` closes that: it reconciles the `pools`
table into solver Deployments, Services and ScaledObjects, built from the chart's own rendered
template, so a live pool gets the same per-pool solver a declared one gets. Declare a pool in
`engine.pools` only when it must exist before anything can POST it.

The four pools today (three declared, one added live):

- `direct` — the cluster's own egress, `37.65.67.167`. This cluster is home-hosted, so that is a
  residential IP (verified distinct from the other exits) rather than a datacenter one, hence
  `residential: true`.
- `tailscale` — the residential exit `rsp-asp` (`176.171.110.96`), via the `tailscale-proxy-00`
  egress Service. FlareSolverr forwards `PROXY_URL` into the solve, so that hop uses
  `solver.proxyEgressPorts`. Requires the `tailscale-proxy-00` egress pod to be Ready.
- `c` — node C's exit, `37.65.172.70`, via `tailscale-proxy-scrape-c`. Tagged residential in the
  `pools` table once its exit was confirmed distinct and non-datacenter.
- `b` — node B's exit, `31.39.215.32`, added live and **not** in `engine.pools`. It reuses the
  `garage-node-b` egress Service: the operator's proxy pod forwards every TCP port, so the same
  tailnet device serves Garage's S3 API on `3900` and node B's HTTP proxy on `8888`. That reuse
  is the trap — if node B ever leaves the Garage cluster and that Service is pruned, this pool
  loses its egress with no other warning.

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
- **Do not tag a pool `residential` before verifying its exit IP.** Mislabelling a datacenter
  exit as residential puts every site's traffic on an IP that anti-bot vendors already distrust.
  Confirm it is a distinct, non-datacenter IP first (command below) and compare it against the
  other three. An egress Service proving a host is on the tailnet does not prove it runs a proxy:
  `tailscale-proxy-scrape-c` and `garage-node-c` share `100.92.142.13` but expect an HTTP proxy on
  `8888` and Garage's S3 API on `3900` respectively.
- **Do not promote a live pool into `engine.pools`.** Helm would try to create a
  `solver-<pool>` that `poolctl` already owns, and the upgrade fails on ownership metadata —
  `poolctl` only drops its copy on the pass *after* the new chart pool list lands, which is after
  the upgrade it just broke. There is no reason to either: a live pool is a full pool. To promote
  anyway, delete the poolctl-managed solver first.
- **`poolctl.maxSolvers` is a capacity guard, not a preference.** Each solver requests 2560Mi and
  limits at 6Gi, and `POST /v1/pools` is unauthenticated — the backend's `require_auth` is still a
  no-op scaffold. Raising it raises what a single POST loop can reserve on a three-node cluster
  that already runs three chart solvers.
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
kubectl -n tailscale get pods               # egress proxies for the tailscale/b/c pools
kubectl -n scraper logs deploy/scraper-poolctl --tail=50   # solver_created / solver_cap_reached
```

Adding an egress — no commit, no rollout. Leave `residential` false until its IP is verified:

```sh
kubectl -n scraper exec deploy/scraper-backend -- \
  curl -sX POST http://localhost:8080/v1/pools -H 'content-type: application/json' \
  -d '{"name":"b","url":"http://garage-node-b.tailscale.svc.cluster.local:8888",
       "residential":false}'
```

`poolctl` creates `solver-b` within `poolctl.intervalSeconds`. Confirm before routing to it:

```sh
kubectl -n scraper get deploy,svc,scaledobject -l app.kubernetes.io/managed-by=scraper-poolctl
```

Check what public IP a pool's proxy actually exits from, before tagging it residential. Compare
against the other three — `direct` is `37.65.67.167`, `tailscale` `176.171.110.96`, `c`
`37.65.172.70`, `b` `31.39.215.32` — a repeat means two pools share one fingerprint:

```sh
kubectl -n scraper run ipcheck --rm -it --restart=Never \
  --image=curlimages/curl:8.11.1 -- curl -s \
  -x http://tailscale-proxy-scrape-c.tailscale.svc.cluster.local:8888 \
  https://ifconfig.me
```
