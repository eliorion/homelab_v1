# monitoring

The observability tier. It has exactly two halves, and the split is the thing to
understand before anything else:

- `monitoring/controllers/` installs the `kube-prometheus-stack` HelmRelease —
  Prometheus, Alertmanager, Grafana, prometheus-operator, node-exporter,
  kube-state-metrics, and the CRDs (`PodMonitor`, `ServiceMonitor`,
  `PrometheusRule`, …) that the rest of the repository is written against.
- `monitoring/configs/` holds everything that *uses* that stack: scrape
  definitions, alert rules, Grafana dashboards and datasources, and the Telegram
  delivery wiring.

Each half is reconciled by its own Flux Kustomization, and they are independent.
This file documents the tier itself — which directory Flux points at, which
kustomization aggregates what, and the rules that apply across both halves. The
components have their own READMEs:
[`controllers/base/kube-prometheus-stack/README.md`](controllers/base/kube-prometheus-stack/README.md)
(the stack, its values, Alertmanager and Grafana),
[`configs/README.md`](configs/README.md) (the alerting directories and both
Telegram paths), and one each for the two directories that file leaves out:
[`configs/staging/fbref-grafana/README.md`](configs/staging/fbref-grafana/README.md)
and [`configs/staging/n8n-metrics/README.md`](configs/staging/n8n-metrics/README.md).

Background reading:
[`../documentations/01-architecture.md`](../documentations/01-architecture.md),
[`../documentations/05-alerting.md`](../documentations/05-alerting.md),
[`../documentations/14-design-decisions.md`](../documentations/14-design-decisions.md).

## How it is wired

Nothing here runs because it is in this directory. It runs because a
Kustomization in `clusters/<env>/monitoring.yaml` names its path.

| Flux Kustomization | Declared in | `path` |
|---|---|---|
| `monitoring-controllers` | [`../clusters/staging/monitoring.yaml`](../clusters/staging/monitoring.yaml) | `./monitoring/controllers/staging` |
| `monitoring-configs` | [`../clusters/staging/monitoring.yaml`](../clusters/staging/monitoring.yaml) | `./monitoring/configs/staging` |
| `monitoring-controllers` | [`../clusters/production/monitoring.yaml`](../clusters/production/monitoring.yaml) | `./monitoring/controllers/production` |

All three share `interval: 1m0s`, `retryInterval: 1m`, `timeout: 5m`,
`prune: true` and a `decryption` block pointing at the `sops-age` Secret. None of
them has a `dependsOn`. There is no `monitoring-configs` in production.

Those three paths are the only entry points. No component in this tier has a
Flux Kustomization of its own, so a directory that is not listed in the overlay
kustomization below is not deployed at all.

### Files at this level

| Path | What it does |
|---|---|
| `monitoring/` | Container only. **There is no `monitoring/kustomization.yaml`** and there should not be one — Flux names the overlay directories directly, so a kustomization here would be reconciled by nobody. |
| `controllers/base/` | Holds `kube-prometheus-stack/` and nothing else. **No `controllers/base/kustomization.yaml`**, same convention as `infrastructure/controllers/base/`: overlays reference the component directory, not the tier. |
| `controllers/staging/kustomization.yaml` | The aggregate Flux reconciles as `monitoring-controllers` in staging. One resource: `kube-prometheus-stack`. |
| `controllers/production/kustomization.yaml` | The production aggregate. One resource: `kube-prometheus-stack`. |
| `configs/staging/kustomization.yaml` | The aggregate Flux reconciles as `monitoring-configs`. Seven resources, listed below. No namespace transformer — every component names its own namespace. |

`configs/` has no `base/` and no `production/`: `staging/` is the only overlay,
so its components hard-code their staging values.

### What the aggregates pull in

`controllers/<env>/kustomization.yaml` → `kube-prometheus-stack`:

| Path | What it does |
|---|---|
| `controllers/base/kube-prometheus-stack/` | `namespace.yaml` (namespace `monitoring`, PSA `privileged`), `repository.yaml` (`HelmRepository` → `https://prometheus-community.github.io/helm-charts`), `release.yaml` (`HelmRelease`, chart `kube-prometheus-stack` pinned to `66.2.2`). |
| `controllers/staging/kube-prometheus-stack/` | `namespace: monitoring`, the base above, plus `grafana-admin.enc.yaml`. No patches. |
| `controllers/production/kube-prometheus-stack/` | The same two resources, plus a JSON 6902 patch setting `/spec/values/grafana/ingress/enabled` to `false`. |

`configs/staging/kustomization.yaml`, in list order:

| Directory | What it adds |
|---|---|
| `flux-alerts/` | notification-controller → Telegram (the event path): `Provider`, `Alert` and bot token, all in `flux-system`. |
| `flux-am/` | Flux metrics → Prometheus → Alertmanager → Telegram (the metric path): `PodMonitor`, `PrometheusRule`, and the Alertmanager token Secret in `monitoring`. |
| `fbref-grafana/` | The SOPS-encrypted Grafana datasource for `fbref-db` plus two dashboard ConfigMaps (`fbref-grafana-dashboard`, `fbref-grafana-dashboard-audit`), picked up by the Grafana sidecar through the label `grafana_dashboard: "1"`. |
| `etcd-backup-alerts/` | `PrometheusRule` `etcd-backup` — job failure and snapshot staleness. |
| `cnpg-alerts/` | `PodMonitor` `cnpg-instances` (every CNPG pod in the cluster) and `PrometheusRule` `cnpg-alerts` (WAL archiving + volume usage). |
| `n8n-metrics/` | `ServiceMonitor` `n8n` (created in `monitoring`, selecting namespace `n8n`, port `http`, `/metrics`, `interval: 60s`) and a `PrometheusRule` with `N8nDown` and `N8nMetricsMissing`. |

The four alerting directories are documented in
[`configs/README.md`](configs/README.md); `fbref-grafana/` and `n8n-metrics/`
have a README each,
[`configs/staging/fbref-grafana/README.md`](configs/staging/fbref-grafana/README.md)
and [`configs/staging/n8n-metrics/README.md`](configs/staging/n8n-metrics/README.md).

## Why it is like this

**Two Flux Kustomizations, not one.** The chart creates the CRDs; everything in
`configs/` is an instance of one of those CRDs. Keeping them apart means a stuck
Helm upgrade does not block an alert-rule change, and a bad rule does not hold
the stack. The cost is that nothing orders them: on a cold bootstrap
`monitoring-configs` can try to apply a `PrometheusRule` before the CRD exists.
That is not fatal — the Kustomization fails and retries on `retryInterval: 1m`
until the chart has landed — but it is why a fresh cluster shows
`monitoring-configs` failing for the first few minutes.

**Both paths carry SOPS Secrets, so both need `decryption`.** `controllers/`
has `grafana-admin.enc.yaml` per overlay; `configs/staging` has the Grafana TLS
Secret, the Grafana datasource and the two Telegram tokens.

**Production is wired but not deployed.** `clusters/production/monitoring.yaml`
reconciles only `monitoring/controllers/production`, and there is no
`monitoring/configs/production/`. Nothing in the `configs` table above exists
there: no alert rules, no dashboards, no Alertmanager token.

The production overlay also patches the Grafana ingress off, for a separate
reason — the Tailscale operator is declared only in the staging infrastructure
overlay, so `ingressClassName: tailscale` names a controller production does not
run.

## Traps

- **Every `PodMonitor`, `ServiceMonitor` and `PrometheusRule` in this tier — and
  in every other tier — must carry the label `release: kube-prometheus-stack`.**
  It is the chart's default `podMonitorSelector` / `serviceMonitorSelector` /
  `ruleSelector`, and its value is the Helm release name, i.e. the
  `HelmRelease`'s `metadata.name`. An object without it applies cleanly, appears
  in `kubectl get`, and is silently ignored by Prometheus — no scrape, no rule,
  no error anywhere.
- **Both Flux Kustomizations must keep their `decryption` block.** Without it
  Flux applies the ciphertext verbatim: the Secret's values become the literal
  `ENC[AES256_GCM,...]` string and nothing fails at apply time. Grafana just
  refuses the admin login, and Alertmanager just never delivers.
- **`prune: true` on all three Kustomizations.** Deleting a directory from an
  aggregate `kustomization.yaml` deletes the objects from the cluster on the next
  reconcile, including Secrets. Removing an entry is a destructive change.
- **A new component directory is invisible until it is listed** in
  `configs/staging/kustomization.yaml` or `controllers/<env>/kustomization.yaml`.
  There is no per-component Flux Kustomization in this tier to fall back on, and
  an unlisted directory produces no error.
- **Anything added under `configs/staging/` is staging-only.** Production
  reconciles the controllers path alone; alert rules, dashboards and monitors do
  not follow.
- **`controllers/base/` and `monitoring/` have no `kustomization.yaml` on
  purpose.** Adding one does not wire anything up, because no Flux Kustomization
  points at either path.

## Operating it

Render both halves before committing — the aggregates are what Flux builds:

```sh
kubectl kustomize monitoring/controllers/staging
kubectl kustomize monitoring/configs/staging
```

Reconcile and inspect:

```sh
flux get kustomizations
flux reconcile kustomization monitoring-controllers -n flux-system
flux reconcile kustomization monitoring-configs -n flux-system
flux get helmreleases -n monitoring
```

List what the tier applied. `kubectl get` shows every object whether or not
Prometheus selected it, so this confirms the apply, not the scrape — an object
missing the `release` label is in this list and still ignored:

```sh
kubectl -n monitoring get prometheusrule,podmonitor,servicemonitor
kubectl -n monitoring get pods
```

## Overlays

| Tier | `base/` | `staging/` | `production/` |
|---|---|---|---|
| `controllers/` | yes (`kube-prometheus-stack/`, no tier kustomization) | yes, reconciled | yes, one patch, declared but not deployed |
| `configs/` | no | yes, reconciled | no |

Encrypted files live only in the overlays, never in `base/`. The `.enc.yaml`
files under `staging/` are matched by the `(^|/)staging/.*\.enc\.ya?ml$` rule in
[`../.sops.yaml`](../.sops.yaml) and the `production/` ones by the
`(^|/)production/.*\.enc\.ya?ml$` rule, both encrypting only `data` /
`stringData` under their environment's age key.

Adding a second environment to `configs/` means splitting a `base/` out first and
declaring a `monitoring-configs` Kustomization in that cluster directory.
