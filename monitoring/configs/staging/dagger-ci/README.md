# dagger-ci — CI runs in Grafana instead of Dagger Cloud

The Grafana dashboard **Dagger CI** (uid `dagger-ci`) and the scrape of the Dagger
engines' own metrics. Together with the OTLP wiring on the runners, this is what
replaces Dagger Cloud's run view: every `dagger call` in CI shows up as a trace in
Tempo, with each step's stdout/stderr in Loki, correlated by trace ID.

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the two objects below. |
| `podmonitor.yaml` | `PodMonitor/dagger-engine` in `monitoring`: namespace `dagger`, `app: dagger-engine`, port `metrics` (9090). |
| `dashboard.yaml` | ConfigMap `dagger-ci-grafana-dashboard`, label `grafana_dashboard: "1"`, key `dagger-ci.json`. |

The full data path:

```
ARC runner pod ── dagger CLI ──OTLP/HTTP──▶ alloy-receiver:4318 ─┬─ traces ──▶ Tempo
   (OTEL_EXPORTER_OTLP_*_ENDPOINT)                                ├─ logs ────▶ Loki  (service_name="dagger-engine" | "dagger-cli")
                                                                  └─ metrics ─▶ Prometheus (OTLP receiver)
dagger-engine-0 :9090/metrics ◀──── PodMonitor ── Prometheus
```

The pieces live in four places:
[`arc-runner-set`](../../../../infrastructure/services/staging/arc-runner-set/README.md)
(the environment variables),
[`dagger`](../../../../infrastructure/services/base/dagger/README.md) (the engine
metrics listener),
[`alloy`](../../../controllers/base/alloy/README.md) (the receiver), and
this directory.

### The dashboard

| Row | Panel | Query |
|---|---|---|
| Runs | Recent dagger runs (table) | Tempo TraceQL `{resource.service.name="dagger-cli" && nestedSetParent < 0}` — the root span of each CLI invocation |
| Runs | Runs by status | TraceQL metrics `… \| count_over_time() by (status)` |
| Runs | Run duration p50/p90 | TraceQL metrics `… \| quantile_over_time(duration, .5, .9)` |
| Selected run | Trace | the trace whose ID is in the `trace_id` textbox |
| Selected run | Step output | Loki `{service_name=~"dagger-.+"} \| trace_id="$trace_id"` |
| Engines | Connected clients, local cache size, cache entries | `dagger_connected_clients`, `dagger_local_cache_total_disk_size_bytes`, `dagger_local_cache_entries` by pod |

Clicking a `traceID` in the table follows a data link that sets `var-trace_id`, which
loads that run's span tree and its full output underneath. From the trace view,
"Logs for this span" (the Tempo datasource's `tracesToLogsV2`) narrows the output
to one step.

## Why it is like this

**No Dagger Cloud.** The Dagger CLI's OTLP exporters are independent of its Cloud
exporter: without `DAGGER_CLOUD_TOKEN` only OTLP is used. The CLI, not the engine,
does the exporting — it pulls engine spans and logs over the session — so nothing
on the engine talks to the collector.

**Root spans from TraceQL, not span metrics.** Tempo's span-metrics processor
excludes `dagger-*` services (unbounded span names, see
[`../../../controllers/base/tempo/README.md`](../../../controllers/base/tempo/README.md)).
TraceQL metrics read the stored blocks directly and only ever group by `status`,
so they cost no Prometheus series.

**Step output is queried by `service_name=~"dagger-.+"`.** Verified on the first run
(2026-09-14): step stdout/stderr arrives in Loki as `service_name="dagger-engine"`,
the CLI's own messages as `dagger-cli`; module runtimes can add `dagger-go-sdk`.
Tempo names the same engine spans `unknown_service:dagger-engine` — the forwarded
span resource lacks `service.name` — which is why the trace-to-logs link matches on
`trace_id`/`span_id` instead of the service. The regex keeps all of
them for one trace. Each OTLP record is one *write*, not one line, and keeps ANSI
colour codes — Grafana's logs panel renders those.

**The dashboard JSON is generated, then committed.** It is a plain ConfigMap like
`fbref-grafana`; there is no build step at deploy time.

## Traps

- **uids `tempo`, `loki` and `prometheus` are hard-coded** in every panel. They are
  set in the kube-prometheus-stack values; renaming a datasource there empties this
  dashboard.
- **`_EXPERIMENTAL_DAGGER_METRICS_ADDR` is undocumented.** An engine bump can
  rename the metrics or drop the listener; the Engines row goes blank and
  `TargetDown` fires for `dagger`.
- **Runs on a GitHub-hosted runner never appear.** The OTLP variables are set on
  the ARC runner pods only.
- **`nestedSetParent < 0` is Tempo's root-span test.** A run whose root span was
  dropped (for example `TRACE_TOO_LARGE`) is missing from the table even though
  its steps are searchable.

## Operating it

```sh
kubectl -n monitoring get podmonitor dagger-engine
kubectl -n monitoring get cm dagger-ci-grafana-dashboard
```

To edit the dashboard, change it in Grafana, export the JSON ("Export → Export as
JSON", external sharing off), and replace the `dagger-ci.json` block in
`dashboard.yaml`. Provisioned dashboards are read-only in Grafana: saving in the UI
does not persist.
