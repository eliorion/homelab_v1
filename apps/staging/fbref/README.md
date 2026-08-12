# fbref

`fbref` is the football-data application: an ingest process that drives a breadth-first crawl of
fbref.com and transfermarkt.com, an admin UI, and `fbref-mcp`, a read-only MCP server over the
resulting database. Like `asp`, this directory holds no application manifests — a single
`HelmRelease` points at the `k8s/charts/fbref` chart in the private `asp` repository, and the
values here are environment overrides only. fbref runs in its own `fbref` namespace against its
own CNPG cluster `fbref-db`, and it is the first and currently only client of the central
scraper platform. `fbref-mcp` is the one publicly reachable surface in this stack.

## How it is wired

Files in this directory:

| File | What it does |
|---|---|
| `kustomization.yaml` | lists `release.yaml`. It sets no `namespace:` — the release targets `fbref` itself |
| `release.yaml` | `HelmRelease` `fbref` in `flux-system`, `targetNamespace: fbref` |

`release.yaml` settings: `interval: 30m`, chart `k8s/charts/fbref` from GitRepository `fbref`
with `chart.spec.interval: 12h` and `reconcileStrategy: Revision`,
`install.createNamespace: true`, `install.remediation.retries: 3`, `upgrade.remediation`
`retries: 3` / `strategy: rollback`, and `test.enable: true`.

Values set here:

| Value | Setting |
|---|---|
| `global.imagePullSecrets` | `ghcr-pull-secret` — the private GHCR image |
| `adminUi.service.annotations` | `tailscale.com/expose: "true"`, `tailscale.com/hostname: fbref-admin-ui` |
| `engine.sites` | `"fbref,transfermarkt"` |
| `engine.maxInFlightOverrides.transfermarkt` | `10` |
| `mcp.auth.enabled` | `true` |
| `mcp.auth.issuerUrl` | `https://staging-keycloak.eliorion.fr/realms/mcp` |
| `mcp.auth.resourceUrl` | `https://fbref-mcp.eliorion.fr/mcp` |
| `mcp.auth.requiredScopes` | `mcp:tools` |
| `mcp.allowedHosts` | `fbref-mcp.eliorion.fr`, `fbref-mcp:8080`, `fbref-mcp.fbref.svc.cluster.local:8080`, `localhost:*` |
| `mcp.originAllowlist` | `https://claude.ai`, `https://chatgpt.com` |

Flux applies this through the `apps` Kustomization in
[`../../../clusters/staging/apps.yaml`](../../../clusters/staging/apps.yaml) (`path: ./apps/staging`,
`prune: true`, SOPS decryption, `dependsOn: db-migrations`); `apps/staging/kustomization.yaml`
lists `fbref/` explicitly.

The chart lives in the private `asp` repository. GitRepository `fbref` is declared in
[`../../../clusters/staging/sources.yaml`](../../../clusters/staging/sources.yaml) — note that
there is no `clusters/staging/fbref-source.yaml`, all four app sources share that one file. It
points at `ssh://git@github.com/Eliorion/asp`, branch `main`, read-only `asp-deploy-key` Secret,
`interval: 1m0s`, with an `ignore` block narrowed to `/k8s/charts/fbref/`.

Everything else fbref depends on is owned elsewhere:

- The `fbref` namespace, the CNPG cluster `fbref-db` and the `fbref-mcp-ro` credential Secret —
  [`../../base/databases/fbref/README.md`](../../base/databases/fbref/README.md).
- `ghcr-pull-secret` — mirrored into `fbref` by the central reflector source,
  [`../../../infrastructure/controllers/staging/reflector/README.md`](../../../infrastructure/controllers/staging/reflector/README.md).
- The public route for `fbref-mcp.eliorion.fr` — a Cloudflare Tunnel route configured in the
  vendor dashboard, not an Ingress object:
  [`../../../infrastructure/services/staging/cloudflare/README.md`](../../../infrastructure/services/staging/cloudflare/README.md).
- The `mcp` Keycloak realm, its `mcp:tools` scope and the audience mapper —
  [`../../../documentations/02-keycloak.md`](../../../documentations/02-keycloak.md) and
  `infrastructure/services/base/keycloak/realm/realm-mcp.yaml`.
- The scraping itself — [`../scraper/README.md`](../scraper/README.md).

The admin UI is reached on the tailnet at `https://fbref-admin-ui.<your-tailnet>.ts.net`.

### Overlays

There is no `apps/base/fbref/` and no production overlay: this staging directory is the whole
component.

## Why it is like this

**Values here are environment overrides, never image tags.** `images.fbref.tag` lives in the
chart's `values.yaml` and CI bumps it on every fbref release; combined with
`reconcileStrategy: Revision`, a release rolls out with zero manual steps and no commit in this
repository.

**`install.createNamespace: true` on a namespace someone else owns.** The `fbref` namespace is
created by the databases tier, which runs first in the `databases` → `db-migrations` → `apps`
chain. `createNamespace` is harmless belt-and-braces in case the app tier ever races ahead.

**Failure handling.** `upgrade.remediation` `retries: 3` / `strategy: rollback` means a failed
upgrade — pods never Ready, or a failing helm test — reverts to the last released revision
instead of sticking half-deployed. `test.enable: true` runs the chart's own test hooks (a psql
probe of `url_queue`, and a POST to `http://fbref-mcp:8080/mcp`) after every install and
upgrade; a failure marks the release failed, which is what feeds that rollback remediation.

**Scraping moved out of this chart.** The in-chart scraper lanes and FlareSolverr are retired
(chart defaults `scraper.enabled: false` and `flaresolverr.enabled: false`). The central scraper
service (`apps/staging/scraper`) now scrapes fbref through its own FlareSolverr, routed via the
Tailscale egress proxy to the `rsp-asp` residential exit — that is the scraper release's `solver`
block plus `engine.pools[tailscale]`. `fbref-ingest` drives the BFS: it claims from `url_queue`,
POSTs to `/v1/scrape`, writes the results and enqueues the discovered links. It sends only `url`
and `kind`; the scraper platform assigns the residential egress pool. Hence there is no proxy
configuration here — the chart defaults (`ingest.enabled: true`) suffice.

**transfermarkt is a second source on the same process.** The chart default for `engine.sites` is
`"fbref"` alone. transfermarkt already has its own `site_config`/grammar row, antibot pin and
egress floor on the scraper platform, and a 200-request live verify through the pinned
`camoufox_replay` lane showed zero `antibot_escalated` events (the transfermarkt-onboarding study
in the asp repository, phases 0 and 1). Setting `sites: "fbref,transfermarkt"` is that study's
phase 5 switch. The first crawl is deliberately small: `comp_codes` is seeded to `["GB1"]` only
and every `crawl_*` flag stays off except the confederation-index seed.

**`maxInFlightOverrides.transfermarkt: 10` is small on purpose.** A newly onboarded source shares
the same two residential pools every other site on the scraper platform draws from. Widen it
once phase 5's throughput and error-rate checks are clear.

**The MCP server is the one public surface, so it is authenticated.** It is reached at
`https://fbref-mcp.eliorion.fr/mcp` through the Cloudflare tunnel — there is no Ingress object —
because hosted AI providers must be able to call it: claude.ai on the web and ChatGPT connectors
call from the provider's cloud, where a `kubectl port-forward` is invisible. Without
`mcp.auth.enabled: true` that route would publish an unauthenticated reader of the whole fbref
database. Authentication is a Keycloak realm (`mcp`) on the self-hosted Keycloak; this server
only verifies tokens, it never issues them.

**`resourceUrl` exists because Keycloak 26 has no RFC 8707.** The audience cannot be requested per
resource, so it is stamped by a mapper on the `mcp:tools` **default** client scope
(`infrastructure/services/base/keycloak/realm/realm-mcp.yaml`). `resourceUrl` is this server's
identity and the `aud` every token must carry, which is what stops a token minted for another
client in the same realm being replayed here.

**`allowedHosts` and `originAllowlist` are DNS-rebinding protection.** The in-cluster host entries
are not optional (see Traps). A missing `Origin` header is always allowed, which is what keeps
CLI clients working while still fencing browser origins to the two hosted connectors.

## Traps

- **Never set image tags in `release.yaml`.** The chart's `values.yaml` owns them and CI bumps
  them.
- **`mcp.auth.issuerUrl` is compared to the token's `iss` by exact string.** A trailing slash
  breaks every token.
- **`mcp.auth.resourceUrl` must match the `aud` stamped by the audience mapper** on the `mcp:tools`
  default client scope in `infrastructure/services/base/keycloak/realm/realm-mcp.yaml`. If the two
  drift apart, every token is rejected. Keeping `mcp:tools` a *default* scope is part of the same
  contract — see [`../../../documentations/02-keycloak.md`](../../../documentations/02-keycloak.md).
- **`issuerUrl` and `resourceUrl` must both be set when `mcp.auth.enabled: true`.** The server
  exits non-zero otherwise, so a half-configured switch cannot ship — but do not read that as
  permission to disable auth: the tunnel route is public.
- **`allowedHosts` must keep its in-cluster entries.** `Host` is matched exactly and the chart's
  helm test hook POSTs to `http://fbref-mcp:8080/mcp`. Listing only the public hostname turns
  every helm test — and therefore every Flux upgrade — into an HTTP 421.
- **`allowedHosts` and `originAllowlist` must be set together.** The server refuses to start with
  only one of them.
- **A missing `Origin` header is always allowed.** `originAllowlist` fences browsers, not
  scripts; it is not the access control — the Keycloak token is.
- **`engine.sites` is one process driving both sources.** Adding a site here without its
  `site_config`/grammar row and antibot pin on the scraper platform starts crawling a source the
  platform cannot pace.
- **Do not raise `maxInFlightOverrides.transfermarkt` casually.** The two residential pools are
  shared with every other site; extra in-flight work for one source comes out of the others.
- **`reconcileStrategy: Revision` plus the GitRepository `ignore` block are a pair.** Widen the
  `ignore` allowlist beyond `/k8s/charts/fbref/` and every unrelated commit to the `asp`
  repository re-reconciles this release.

## Operating it

```sh
kubectl kustomize apps/staging/fbref        # render check before commit
flux get helmreleases -n flux-system fbref
flux reconcile helmrelease fbref -n flux-system --with-source
kubectl -n fbref get pods
```

Check the public MCP surface (401 without a token is the expected answer):

```sh
curl -si https://fbref-mcp.eliorion.fr/mcp | head -1
curl -sS https://fbref-mcp.eliorion.fr/.well-known/oauth-protected-resource/mcp
```

More probes, and the tunnel-side configuration, are in
[`../../../infrastructure/services/staging/cloudflare/README.md`](../../../infrastructure/services/staging/cloudflare/README.md).
