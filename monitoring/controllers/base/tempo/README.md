# Tempo

The cluster's trace store. One Tempo 3 process in monolithic mode, blocks on a
30Gi LINSTOR `ssd` volume, keeping 7 days. Traces arrive over OTLP from
`alloy-receiver` ([`../alloy/README.md`](../alloy/README.md)); today that is every
Dagger CI run, and any application instrumented with OpenTelemetry can send to the
same endpoint. Its metrics-generator turns spans into RED metrics and a service
graph in Prometheus. Grafana reads it as the `Tempo` datasource (uid `tempo`). The
design narrative is
[`documentations/18-observability-lgtm.md`](../../../../documentations/18-observability-lgtm.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `repository.yaml` and `release.yaml`. |
| `repository.yaml` | `HelmRepository/tempo` in `monitoring`, `https://grafana-community.github.io/helm-charts`. |
| `release.yaml` | `HelmRelease/tempo`, chart `tempo` `3.0.0` (Tempo 3.0.3), `dependsOn: kube-prometheus-stack`. |

`monitoring/controllers/staging/tempo/` only references the base.

What the release renders: a `tempo` StatefulSet (one pod, PVC `storage-tempo-0` on
`ssd` mounted at `/var/tempo`), Services `tempo` and `tempo-headless`, and a
`ServiceMonitor` labelled `release: kube-prometheus-stack`.

| Port | What |
|---|---|
| 3200 | HTTP API: Grafana queries, `/ready`, `/metrics` |
| 4317 / 4318 | OTLP gRPC / HTTP receivers — `alloy-receiver` uses 4318 |
| 14250, 14268, 6831/udp, 6832/udp, 9411, 55680, 55681 | Jaeger, Zipkin and legacy OTLP listeners the chart always renders; nothing sends to them |

Configuration that matters:

- **`retention: 168h`** — rendered into
  `backend_scheduler.provider.compaction.compaction.block_retention`.
- **metrics-generator** — `service-graphs` and `span-metrics` processors,
  remote-writing to Prometheus
  (`kube-prometheus-stack-prometheus:9090/api/v1/write`, `send_exemplars: true`),
  which is why Prometheus runs with `enableRemoteWriteReceiver` and
  `exemplar-storage`. Produces `traces_spanmetrics_*` and
  `traces_service_graph_*`, used by the Tempo datasource's service map and
  traces-to-metrics links.
- **`span_metrics.filter_policies`** — excludes every span whose
  `resource.service.name` matches `dagger-.*`.
- **`overrides.defaults.global.max_bytes_per_trace: 52428800`** (50MB).

## Why it is like this

**Tempo 3, from `grafana-community`.** Grafana Labs moved the Tempo charts to the
`grafana-community` repository in January 2026 and marked `grafana/tempo`
deprecated, frozen on Tempo 2.9. Tempo 3 removes the ingester and compactor: the
live-store serves recent data and flushes blocks, and a backend scheduler/worker
pair runs compaction and retention.

**Monolithic, not `tempo-distributed`.** Tempo 3's distributed mode *requires*
Kafka, with block-builder and live-store replica counts pinned to the partition
count. Monolithic mode needs none of that. The cost is no replication; during a
restart, `alloy-receiver`'s exporter retries.

**Local backend on `ssd`, not S3** — same reasoning and trade as Loki, see
[`../loki/README.md`](../loki/README.md): Tempo's own documentation marks SeaweedFS
as not fully tested, and the `hdd` tier loses writes with either HDD node.

**Dagger spans are excluded from span metrics.** Dagger names spans after what
they run — `exec go test ./...`, `withDirectory /src`, digests — so the
`span_name` dimension is effectively unbounded. Left in, every CI run would mint
new Prometheus series until the TSDB volume filled. Dagger traces are still fully
stored and searchable; only the derived metrics skip them. The CI dashboard gets
its run-level numbers from TraceQL metrics instead, which read blocks directly.

**`max_bytes_per_trace` is 50MB, ten times the default.** One `dagger call` is a
single trace holding every step of the pipeline — hundreds to thousands of spans,
with large `dagger.io/dag.call` attributes (Tempo truncates attributes past
2048 bytes). At the 5MB default, Tempo drops the rest of a large run with
`TRACE_TOO_LARGE` and the run renders as a partial tree.

**The Jaeger receivers stay on.** The chart's Service template dereferences
`tempo.receivers.jaeger.protocols.*` unconditionally, so removing or nulling the
Jaeger block fails the render. They listen in-cluster only and cost nothing.

## Traps

- **Tempo 3 refuses to start on the old flat overrides format.** Everything under
  `tempo.overrides.defaults` must use the nested form (`global:`, `ingestion:`,
  `metrics_generator:`). A Tempo 2 snippet pasted in CrashLoops the pod.
- **`filter_policies` matches the resource attribute with its `resource.` prefix.**
  Dropping the prefix silently matches nothing, and Dagger span names flood
  Prometheus.
- **Removing `enableRemoteWriteReceiver` from kube-prometheus-stack breaks the
  service map silently.** Tempo logs remote-write 404s; nothing alerts. The same
  goes for renaming the Prometheus Service in `remote_write.url`.
- **The PVC is not resized by editing `persistence.size`.** Grow `storage-tempo-0`
  directly, then update the value.
- **TraceQL metrics only read Tempo-3-format blocks.** Irrelevant on this install
  (it started on 3.0), but a restore of older blocks would not show in the CI
  dashboard's rate and duration panels.

## Operating it

```sh
flux get hr -n monitoring tempo
kubectl -n monitoring get pods,pvc -l app.kubernetes.io/name=tempo

kubectl -n monitoring port-forward svc/tempo 3200:3200
curl -s localhost:3200/ready
curl -s localhost:3200/status/config | less

# Recent Dagger runs, from the API
curl -sG localhost:3200/api/search --data-urlencode 'q={resource.service.name="dagger-cli" && nestedSetParent < 0}'
```

Signals worth watching in Prometheus: `tempo_distributor_spans_received_total`,
`tempo_discarded_spans_total` (by `reason`, e.g. `trace_too_large`,
`rate_limited`), `tempo_distributor_attributes_truncated_total`.
