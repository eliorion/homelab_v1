# asp

`asp` is the Automarket application (orchestrator, scraper/crawler lanes, analyzer, frontend).
This directory contains no application manifests: it is a single `HelmRelease` pointing at a
chart that lives in the private `asp` repository (`k8s/charts/asp`), plus the kustomization that
puts it in the `asp` namespace. The chart's own `values.yaml` carries the canonical image tags,
bumped by that repository's CI on each release; everything in `release.yaml` here is an
environment override. The app currently runs with its scraping lanes and its results bridge
turned off — see [Why it is like this](#why-it-is-like-this).

## How it is wired

Files in this directory:

| File | What it does |
|---|---|
| `kustomization.yaml` | sets `namespace: asp` and lists `release.yaml` |
| `release.yaml` | `HelmRelease` `asp` — chart `k8s/charts/asp` from GitRepository `asp` in `flux-system` |

The kustomization's `namespace: asp` is what puts the HelmRelease in the `asp` namespace
(`release.yaml` declares no `metadata.namespace`), which is why
`chart.spec.sourceRef.namespace: flux-system` is spelled out — the GitRepository lives in
`flux-system`, not next to the release.

`release.yaml` settings: `interval: 1m`, `timeout: 10m`, `chart.spec.interval: 1m`,
`reconcileStrategy: Revision`, `install.remediation.retries: 3`,
`upgrade.remediation` `retries: 3` / `strategy: rollback` / `remediateLastFailure: true`,
`rollback.cleanupOnFail: true`, `test.enable: true` with `ignoreFailures: false`, and
`driftDetection.mode: enabled`.

Values set here:

| Value | Setting |
|---|---|
| `global.imagePullSecrets` | `ghcr-pull-secret` — the private `ghcr.io/eliorion/asp-*` images |
| `ingest.enabled` | `false` — the asp-ingest results bridge is off |
| `adminUi.enabled` | `true`, with the Tailscale operator annotations `tailscale.com/expose: "true"` and `tailscale.com/hostname: asp-admin-ui` |
| `webapp.enable` | `true` |

Flux applies this through the `apps` Kustomization in
[`../../../clusters/staging/apps.yaml`](../../../clusters/staging/apps.yaml): `path: ./apps/staging`,
`interval: 1m0s`, `prune: true`, SOPS decryption, `dependsOn: db-migrations`. That chain is
`databases` → `db-migrations` → `apps`, so the schema is migrated before new app images roll
out, and `databases` itself `dependsOn` `infra-cnpg-plugin` and `infra-reflector`.
`apps/staging/kustomization.yaml` lists `asp/` explicitly.

The chart is not in this repository. GitRepository `asp`
([`../../../clusters/staging/sources.yaml`](../../../clusters/staging/sources.yaml)) points at
`ssh://git@github.com/eliorion/asp`, branch `main`, authenticated with the read-only
`asp-deploy-key` Secret, `interval: 1m0s`, with an `ignore` block scoped to `/k8s/charts/asp/`
so unrelated application commits do not produce a new artifact revision.

The admin UI is reached on the tailnet at `https://asp-admin-ui.<your-tailnet>.ts.net`.

The `ghcr-pull-secret` in the `asp` namespace is not created here: the central reflector source
mirrors it into `asp`, `fbref`, `lab` and `scraper` — see
[`../../../infrastructure/controllers/staging/reflector/README.md`](../../../infrastructure/controllers/staging/reflector/README.md).
The database, `asp-db`, is owned by the databases tier —
[`../../base/databases/asp/README.md`](../../base/databases/asp/README.md).

### Overlays

There is no `apps/base/asp/`. The staging directory above is the whole live component.

`apps/production/asp/` contains only `kustomization.yaml` (`namespace: asp`) and
`ghcr-pull-secret.enc.yaml`, a SOPS-encrypted image pull Secret — no HelmRelease, so the app
itself is not defined for production. There is no `apps/production/kustomization.yaml`, and per
[`../../../documentations/01-architecture.md`](../../../documentations/01-architecture.md) the
whole `production/` tree is wired but not deployed; treat it as scaffolding.

## Why it is like this

**Values here are environment overrides, never image tags.** The chart's `values.yaml` in the
`asp` repository is the canonical place for tags, and CI bumps it on each release. A tag pinned
here would silently win over CI and freeze the deployment.

**`reconcileStrategy: Revision` rather than chart version.** `Chart.yaml` stays at a static
`0.1.0`, so there is no version to compare; upgrading on every new git revision of the
chart-path-scoped GitRepository is what makes a CI tag bump roll out with no commit in this
repository.

**`interval: 1m` is a dev-phase choice.** New chart revisions deploy event-driven (the
GitRepository polls at `1m`); the release interval only paces drift checks and retries. It is
short because this app is under active development and fast feedback matters more than churn.

**`timeout: 10m`.** The content lanes gate readiness on a Camoufox warm-up (`initialDelay 90s`)
and add `minReadySeconds 30`. A shorter Helm timeout would make every slow warm-up look like a
failed upgrade.

**Failure handling.** A failed upgrade — pods never Ready inside the timeout, or a failing helm
test hook — rolls back to the last good release instead of leaving the app wedged.
`test.enable: true` runs the chart's own test hooks (`curl /health` and `/healthz`) after every
install and upgrade, and `ignoreFailures: false` makes a failing hook fail the release, which is
what feeds the rollback. `driftDetection.mode: enabled` reverts manual `kubectl` edits back to
the chart-rendered state.

**The admin UI is on the tailnet and nowhere else.** The Tailscale operator annotations publish
the Service to the tailnet, which is authenticated and reachable off-LAN without exposing
anything to the internet. The annotations are inert until the operator is installed
(`infrastructure/controllers/staging/tailscale-operator`).

**asp scraping is stopped, and that is why `ingest.enabled: false`.** The in-chart scraper lanes
are retired (chart default `scraper.enabled: false`), and the central scraper platform no longer
runs static per-(tenant, site) lanes at all — that topology was removed from its chart. asp is
not yet a request-driven client of the new engine either, so there is no producer left to feed
it; `fbref` is the platform's sole first client. With no producer, asp-ingest (the results
bridge) has nothing to consume, so it is turned off rather than left crash-looping on an empty
queue. See [`../scraper/README.md`](../scraper/README.md).

## Traps

- **Never set image tags in `release.yaml`.** They belong to the chart's `values.yaml`, which the
  asp repository's CI bumps per release.
- **`upgrade.remediation.retries: 3` is required, not decorative.** helm-controller performs no
  remediation at the default `retries: 0`, so `strategy: rollback` alone is a no-op.
- **`timeout: 10m` must stay above the lanes' warm-up budget** (readiness `initialDelay 90s` plus
  `minReadySeconds 30`). Lower it and healthy-but-slow rollouts get rolled back.
- **`reconcileStrategy: Revision` is load-bearing** while `Chart.yaml` stays at `0.1.0`. Switch to
  the default ChartVersion strategy and nothing ever upgrades.
- **Re-enabling `ingest` is not a one-line change.** Flipping `ingest.enabled: true` gives asp an
  ingest pod with no producer. asp must first rejoin the scraper platform — either by re-adding
  it to the scraper engine or by giving it its own request driver.
- **`ghcr-pull-secret` must already exist in the `asp` namespace.** It is mirrored in by
  kubernetes-reflector, and the `databases` Kustomization `dependsOn: infra-reflector` is what
  gates the whole app chain on that mirror.
- **Keep `chart.spec.sourceRef.namespace: flux-system`.** The release itself is in the `asp`
  namespace, so without the explicit source namespace the GitRepository is never found.
- **`driftDetection.mode: enabled` means hand edits do not survive.** Any `kubectl edit` on a
  chart-owned object is reverted on the next reconcile; change the chart or these values instead.

## Operating it

```sh
kubectl kustomize apps/staging/asp          # render check before commit
flux get kustomizations | grep -E 'apps|db-migrations|databases'
flux get helmreleases -n asp
flux reconcile helmrelease asp -n asp --with-source
kubectl -n asp get pods
```
