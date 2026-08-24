# cnpg

The CloudNativePG operator: the controller that manages every Postgres `Cluster`
in this repository (`keycloak-db` in `identity`, `asp-db` in `asp`, `fbref-db` in
`fbref`, `ai-gateway-db` in `ai-gateway`, `n8n-db` in `n8n`, `scraper-db` in
`scraper`, `dbtools-db` in `database`). It runs in the `cnpg-system` namespace
and is installed as a Flux `HelmRelease` from the upstream `cloudnative-pg`
chart. No database lives in this directory — only the operator, plus, under
`plugin/`, the separate barman-cloud CNPG-I plugin that the first five of those
clusters use to archive WAL and take base backups. `scraper-db` and `dbtools-db`
declare no plugin: neither holds anything restorable, so neither is backed up.
When a `Cluster` declares the plugin, the operator injects a `barman-cloud`
sidecar into each instance pod; the plugin itself supplies the `ObjectStore` CRD
and does the uploads and downloads against Cloudflare R2 or Garage.

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Base: `namespace.yaml`, `repository.yaml`, `release.yaml`. |
| `namespace.yaml` | The `cnpg-system` namespace. |
| `repository.yaml` | `HelmRepository/cnpg` in `flux-system`, `https://cloudnative-pg.github.io/charts/`, 24h interval. |
| `release.yaml` | `HelmRelease/cnpg` in `flux-system`, `targetNamespace: cnpg-system`, chart `cloudnative-pg` pinned to `0.28.2`, one replica, requests 100m/256Mi and limits 500m/512Mi, chart monitoring enabled, `upgrade.crds: CreateReplace`. |
| `plugin/` | A standalone Flux unit for the barman-cloud plugin — its own `HelmRepository` (OCI) and `HelmRelease`. See [plugin/README.md](plugin/README.md). |

The chart's `monitoring` values turn on the operator's own PodMonitor and create
the CNPG Grafana dashboard as a ConfigMap in the `monitoring` namespace, which is
where the kube-prometheus-stack Grafana dashboards sidecar looks for them.

Flux applies this directory in two different ways, on purpose:

- The **operator** (`base/cnpg`) is pulled in by the environment overlay and
  applied by the `infrastructure-controllers` Flux Kustomization
  (`path: ./infrastructure/controllers/<env>`), which itself
  `dependsOn: infra-cnpg-plugin`.
- The **plugin** (`base/cnpg/plugin`) is applied by its own Flux Kustomization
  `infra-cnpg-plugin` (`path: ./infrastructure/controllers/base/cnpg/plugin`),
  which `dependsOn: infra-certmanager`, runs with `wait: true`, and is
  health-gated on the `plugin-barman-cloud` HelmRelease. Both are declared in
  `clusters/<env>/infrastructure.yaml`.

### Overlays

- **staging** — `infrastructure/controllers/staging/cnpg/kustomization.yaml` is a
  pass-through onto `../../base/cnpg/`; no patches, no environment-specific
  values. It is referenced from `infrastructure/controllers/staging/kustomization.yaml`.
- **production** — `infrastructure/controllers/production/cnpg/kustomization.yaml`
  is the identical pass-through. The production tree is not deployed.
- The **plugin** has no overlay at all: both clusters point their
  `infra-cnpg-plugin` Kustomization straight at the base path, so staging and
  production run the same plugin manifests.

## Why it is like this

**The operator install is separate from the plugin install.** Keeping the
operator in `base/cnpg` and the plugin in `base/cnpg/plugin` means the layering
that the plugin needs (its own Flux Kustomization, gated on cert-manager) never
churns the already-running operator.

**Backups go through the barman-cloud plugin, not the in-tree object store.**
Upstream CloudNativePG deprecated `spec.backup.barmanObjectStore`, which is used
nowhere in this repository. The plugin ships an `ObjectStore` CRD and an injected
sidecar per instance, which decouples backup configuration from the `Cluster`
spec. The price is a hard cert-manager dependency, a CRD ordering problem, and a
pre-1.0 component (`plugin-barman-cloud` `0.6.0`) sitting in the write path of
every Postgres instance — two logged incidents are downstream of that choice.
See [14-design-decisions.md](../../../../documentations/14-design-decisions.md).

**The plugin gets its own Flux Kustomization.** Flux applies a Kustomization
atomically, so a custom resource that shares a Kustomization with its own CRD
deadlocks on `no matches for kind ObjectStore`. Splitting the CRD provider out
and making every consumer depend on it turns that deadlock into an ordering
guarantee, at the cost of three extra Flux objects and a longer reconcile chain.

**Instance metrics are not scraped by this chart.** The `Cluster` resources keep
`enablePodMonitor: false`, and a single hand-written PodMonitor
(`cnpg-instances`, in `monitoring/configs/staging/cnpg-alerts/`) covers every
current and future CNPG instance in any namespace. The operator-generated
PodMonitor carries no `release: kube-prometheus-stack` label and the CRD has no
field to add one, so Prometheus' `podMonitorSelector` would ignore it. Before
that PodMonitor existed, `cnpg_*` was empty in Prometheus and an
ai-gateway WAL-archiving failure ran for three days unseen.

## Traps

- **`bootstrap.recovery` does not inherit `database:` / `owner:` from
  `bootstrap.initdb`.** Omit them and the operator defaults both to `app`: it
  creates an empty `app` database next to the restored one, an `app` role, and a
  `<cluster>-app` Secret describing those. Nothing fails — the restore reports
  healthy and the real database is intact — but every consumer reading `dbname`,
  `username` or `uri` out of that Secret is now pointed at the empty one. This
  cost five clusters on 2026-08-24. The Secret is operator-generated, holds a
  generated password and is not in git, so it cannot be pre-committed: the pair
  has to be right in the recovery patch, or repaired by hand afterwards. Both the
  per-cluster values and the repair are in
  [`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md).
- **Anything that declares an `ObjectStore` must `dependsOn: infra-cnpg-plugin`.**
  The CRD ships with the plugin; the CRs are applied by the `databases`
  Kustomization (`path: ./apps/staging/databases`), which declares that
  `dependsOn` directly, and by `infrastructure-services`
  (`path: ./infrastructure/services/staging`), which inherits it through
  `infrastructure-controllers`. Drop the dependency and the consuming
  Kustomization fails with `no matches for kind ObjectStore`.
- **`infra-cnpg-plugin` must stay gated on `infra-certmanager`.** cert-manager
  mints the TLS certificate for the plugin's gRPC endpoint to the operator.
  Without it the `plugin-barman-cloud` HelmRelease never goes Ready, and because
  that Kustomization is health-gated with `wait: true`, everything downstream
  stays blocked.
- **`upgrade.crds: CreateReplace` in `release.yaml` is what keeps the CNPG CRDs
  in step with the chart.** Flux does not update CRDs on upgrade unless told to;
  removing this leaves the cluster on the CRD version installed at first release.
- **Chart versions are pinned and Renovate bumps them**: `cloudnative-pg`
  `0.28.2` here, `plugin-barman-cloud` `0.6.0` (appVersion `v0.12.0`) in
  `plugin/`. The plugin is pre-1.0 and lives in the write path — read
  [03-backups.md](../../../../documentations/03-backups.md) before bumping it.
- **Both HelmReleases target `cnpg-system`.** The plugin is deployed alongside
  the operator, not into a namespace of its own.
- **Per-cluster backup traps are not in this directory.** The R2 boto3 checksum
  env vars, `AWS_REGION`/`AWS_DEFAULT_REGION: garage` on every Garage
  `ObjectStore`, and the "never archive back into the path you restored from"
  rule all live with the `ObjectStore` CRs. They are documented in
  [03-backups.md](../../../../documentations/03-backups.md) and
  [12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md).

## Operating it

Render and reconcile checks:

```sh
kubectl kustomize infrastructure/controllers/staging
flux get kustomizations
flux get helmreleases -A
```

The two HelmReleases to look at are `cnpg` and `plugin-barman-cloud`, both in
`flux-system`; the workloads they create are in `cnpg-system`.

Trigger an on-demand backup instead of waiting for the ScheduledBackup:

```sh
kubectl cnpg backup keycloak-db -n identity \
  --method=plugin --plugin-name=barman-cloud.cloudnative-pg.io
```

Check archiving and backup status:

```sh
kubectl -n identity get cluster keycloak-db \
  -o jsonpath='{.status.conditions}'        # ContinuousArchiving=True
kubectl -n identity get scheduledbackup,backup
```

When backups break, the alerts that fire are `CNPGWALArchivingFailing`,
`CNPGWALArchiveBacklog`, `CNPGVolumeFillingUp` and `CNPGVolumeAlmostFull`
(`monitoring/configs/staging/cnpg-alerts/prometheusrule.yaml`); the logs to read
are the `plugin-barman-cloud` sidecar's in the failing instance pod.

Deep detail:
[03-backups.md](../../../../documentations/03-backups.md) (architecture, storage
layout, restore drill),
[12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md)
(the Garage backend and the 2026-08-10 outage),
[14-design-decisions.md](../../../../documentations/14-design-decisions.md)
(the choices above and what they cost).
