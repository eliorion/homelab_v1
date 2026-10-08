# flux-grafana — where is Flux reconciling, and what is failing

Two Grafana dashboards that answer "what is Flux doing right now, and is any of
it broken?" from the Flux metrics Prometheus already holds. No Prometheus object
lives here: the scrape is [`../flux-am/`](../flux-am/podmonitor.yaml), the
alert on the same condition is `../flux-am/prometheusrule.yaml`. This directory
adds only the two ConfigMaps Grafana's sidecar loads.

| Dashboard | uid | Question |
|---|---|---|
| `Flux reconciliation` | `flux-reconciliation` | Which Flux objects (every kind: Kustomization, HelmRelease, sources, image automation) are Ready, reconciling, failing or suspended, since when, and why? |
| `Flux HelmReleases` | `flux-helmreleases` | The same for HelmReleases only, plus release behaviour (duration, retries, flapping), the chart sources they depend on, and `helm-controller` itself. |

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the two ConfigMaps. No `namespace:` transformer — both name `monitoring`. |
| `dashboard-flux.yaml` | ConfigMap `flux-grafana-dashboard`, label `grafana_dashboard: "1"`, key `flux-reconciliation.json`. |
| `dashboard-helm.yaml` | ConfigMap `flux-helm-grafana-dashboard`, label `grafana_dashboard: "1"`, key `flux-helmreleases.json`. |

Applied by `monitoring-configs` through `../kustomization.yaml`. Grafana's
sidecar defaults apply (no `grafana.sidecar` values in the HelmRelease), so the
ConfigMaps must be in `monitoring`. Datasources are the chart's `prometheus` and
the `loki` one added in the HelmRelease values; both uids are hard-coded in every
panel.

### Flux reconciliation (`flux-reconciliation`)

Variables: `$kind` and `$namespace` (multi, default All), `$search` (a regex
the two log panels filter on). `time: now-6h`, `refresh: 30s`.

| Row | Panels | Source |
|---|---|---|
| Right now | Ready, NOT Ready, Reconciling, Suspended, Controllers down, Objects tracked | `gotk_reconcile_condition`, `gotk_suspend_status`, `up` |
| What needs attention | Table of every object that is NOT READY, reconciling or suspended | the same, unioned with `label_replace(... "state" ...)` |
| Reconciliation history | State timeline: one row per object, green/yellow/red/purple | state code `0` ready, `1` reconciling, `2` not ready, `+4` suspended |
| Reconcile duration and rate | p95 by kind, slowest 10 objects, reconciles per second | `gotk_reconcile_duration_seconds_{bucket,count}` |
| Controllers | Errors/s, results/s, work queue depth per controller | `controller_runtime_reconcile_*`, `workqueue_depth` |
| What went wrong | Error lines per controller over time; Warning events; raw error logs | Loki |

### Flux HelmReleases (`flux-helmreleases`)

Variables: `$namespace`, `$release` (both multi, default All), `$search`.

| Row | Panels |
|---|---|
| Right now | HelmReleases, Ready, NOT Ready, Reconciling, Suspended, helm-controller down |
| Releases | Table of every HelmRelease, worst first; state timeline over time |
| Behaviour | p95 reconcile duration (top 10), reconciles/s (top 10), Ready flips in the last hour |
| helm-controller | Errors/s, results/s, queue depth (`controller="helmrelease"`) |
| Sources feeding the releases | Table of HelmRepository / HelmChart / OCIRepository / GitRepository / Bucket not Ready (includes `flux-system`); source reconcile p95 |
| What went wrong | `helm-controller` Warning events and error logs |

## Why it is like this

**Metrics for "where", logs for "why".** `gotk_reconcile_condition` says which
object is broken and since when, but carries no message. The reason (a failed
Helm upgrade, a Kustomize build error, a health-check timeout) is only in the
Flux Kubernetes events and the controller logs, so each dashboard ends with the
two Loki panels. The rule of thumb is: read the table and timeline, then read the
Warning events for the row that is red.

**Not Ready is shown immediately; the alert waits 5 minutes.** `FluxHelmReleaseFailed`
and `FluxKustomizationFailed` carry `for: 5m` so a transient failure does not
page. The dashboard has no such delay, so it shows failures the alert has not
fired on yet. That is intended.

**One state code per object instead of three queries.** The timelines and the
HelmRelease table compute `NOT READY*2 + reconciling + suspended*4` in a single
expression, which is why the value mappings are `0 1 2 4 5 6`. The suspend half
is `X + (S*4 or X*0)`: `gotk_suspend_status` is not guaranteed to exist for every
object, and a plain `+` would silently drop any object that lacks it from the
panel.

**The attention tables use `label_replace` + `or`, not three queries.** A table
of several instant queries would need a join transformation across frames. The
three states share the same label set apart from a synthetic `state` label, so
one union query gives one frame.

**No chart version column.** `helm-controller` does not export the chart version
or the last applied revision as a metric. Showing them needs kube-state-metrics
`customResourceState` for the Flux CRDs, which is a change to the
`kube-prometheus-stack` values, not to this directory. Until then use
`flux get helmreleases -A`.

## Traps

- **`exported_namespace`, not `namespace`.** The same rename the alert rules
  depend on (see [`../../README.md`](../../README.md), `flux-am`): the scrape
  supplies `namespace="flux-system"`, so the Flux object's namespace arrives as
  `exported_namespace`. A panel filtering on `namespace` shows only
  `flux-system` objects. The controller-level panels (`controller_runtime_*`,
  `workqueue_depth`, `up`) are the opposite: they have no object namespace, and
  `namespace="flux-system"` there is the controller pod.
- **Everything hangs off `../flux-am/podmonitor.yaml`.** Rename its port or drop
  its `release: kube-prometheus-stack` label and both dashboards go blank with
  no error. The "Controllers down" stat will not show it, because a target that
  is not scraped has no `up` series at all.
- **The `gotk_*` series are controller-exported.** If a Flux upgrade moves them
  to kube-state-metrics (`gotk_resource_info`), the alerts in `flux-am` and
  every state panel here go empty together. Check
  `gotk_reconcile_condition` in Prometheus after a Flux upgrade.
- **The controller panels hard-code controller names.** `controller="helmrelease"`
  and `name="helmrelease"` (work queue) are controller-runtime's lowercase Kind
  names. A renamed controller leaves those three panels empty.
- **The Loki panels depend on log shapes this repo does not own.**
  - Pod logs: labels `namespace`, `pod`, `container` come from
    `alloy-node` (`../../../controllers/base/alloy/config/node.alloy`), and
    Flux controllers log JSON with `"level":"error"`; the filter is a plain
    line match on that substring.
  - Events: `job="kubernetes-events"` is set by `alloy-receiver`
    (`loki.source.kubernetes_events`, logfmt). The `type=Warning` and
    `*-controller` substrings are matched against the logfmt line, not against
    labels. **These field names were written from Alloy's documented output and
    were not checked against live Loki.** If the Warning events panel is empty
    while a release is failing, run `{job="kubernetes-events"}` in Explore and
    adjust the two substrings in the panel query to what the line actually
    carries.
- **`$search` is a regex, case-insensitive.** An unescaped `(` or `[` makes the
  log panels error instead of returning nothing.
- **The event panels only show what the Kubernetes API still holds, and only
  what Alloy was running to collect.** Events are shipped as they occur. A
  failure during an `alloy-receiver` outage has no event in Loki; the controller
  error log is the fallback.
- **Editing a panel in the Grafana UI does not come back here.** The ConfigMaps
  are the source of truth; the sidecar reloads them and any UI change is lost.
  Change the JSON in git. The JSON is embedded in a literal block, so
  a hand edit that breaks it applies as a valid ConfigMap and loads as nothing.
- **A dashboard ConfigMap is capped at 1 MiB.** Both are about 40 KB.

## Operating it

Validate before committing (a malformed dashboard silently loads as nothing):

```bash
kubectl kustomize monitoring/configs/staging/flux-grafana
for f in dashboard-flux dashboard-helm; do
  yq -r '.data | to_entries[0].value' monitoring/configs/staging/flux-grafana/$f.yaml | jq -e . > /dev/null
done
```

Push, then check Grafana picked them up:

```bash
flux reconcile kustomization monitoring-configs -n flux-system
kubectl -n monitoring get cm -l grafana_dashboard=1
kubectl -n monitoring logs deploy/kube-prometheus-stack-grafana -c grafana-sc-dashboard --tail=20
```

Check the series the panels need exist (empty means the scrape is broken):

```bash
kubectl -n monitoring exec sts/prometheus-kube-prometheus-stack-prometheus -c prometheus -- \
  promtool query instant http://localhost:9090 'count by (kind) (gotk_reconcile_condition{type="Ready"})'
```

## Overlays

`staging/` only, no `base/`; the dashboards hard-code the staging datasource uids
and the `flux-system` namespace. A second environment means splitting a `base/`
out first.
