# Loki

The cluster's log store. One Loki process in `Monolithic` mode, storing chunks and
its TSDB index on a 50Gi LINSTOR `ssd` volume, keeping 14 days. Everything that
writes here comes through Alloy
([`../alloy/README.md`](../alloy/README.md)): pod logs, Talos service and kernel
logs, the filtered kube-apiserver audit log, Kubernetes events, and OTLP logs —
which today means the step output of every Dagger CI run. Grafana reads it as the
`Loki` datasource (uid `loki`). The design narrative is
[`documentations/18-observability-lgtm.md`](../../../../documentations/18-observability-lgtm.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `repository.yaml` and `release.yaml`. |
| `repository.yaml` | `HelmRepository/loki` in `monitoring`, `https://grafana-community.github.io/helm-charts`. |
| `release.yaml` | `HelmRelease/loki`, chart `loki` `18.13.0` (Loki 3.7.7), `dependsOn: kube-prometheus-stack`. |

`monitoring/controllers/staging/loki/` only references the base. The production
aggregate does not list Loki: that tree is not deployed.

What the release renders: a `loki` StatefulSet (one pod, PVC `storage-loki-0` on
`ssd`), Services `loki` (HTTP 3100, gRPC 9095), `loki-headless` and
`loki-memberlist`, a `ServiceMonitor` and two `PrometheusRule`s (the Loki mixin's
recording rules and alerts: `LokiRequestErrors`, `LokiRequestPanics`,
`LokiRequestLatency`, compactor alerts), all labelled
`release: kube-prometheus-stack`.

Endpoints used inside the cluster:

| Path | Used by |
|---|---|
| `http://loki.monitoring.svc.cluster.local:3100/loki/api/v1/push` | `alloy-node` and `alloy-receiver` (`loki.write`) |
| `http://loki.monitoring.svc.cluster.local:3100/otlp` | `alloy-receiver` (`otelcol.exporter.otlphttp`); the exporter appends `/v1/logs` |
| `http://loki.monitoring.svc.cluster.local:3100` | Grafana datasource |

### Labels you will find

| `job` | Other labels | Source |
|---|---|---|
| `kubernetes-pods` | `namespace`, `pod`, `container`, `stream`, `node` | `/var/log/pods` on each node |
| `talos` | `service` (`kubelet`, `etcd`, `machined`, `cri`, `kernel`, …), `node` | `/var/log/*.log` on each node |
| `kube-apiserver-audit` | `node` | `/var/log/audit/kube/kube-apiserver.log`, filtered |
| `kubernetes-events` | `namespace`, `instance` | the events API |
| — (OTLP) | `service_name` and the other promoted resource attributes | OTLP senders, e.g. `service_name="dagger-engine"` |

OTLP log and resource attributes that Loki does not promote to labels —
`trace_id`, `span_id`, `stdio_stream`, the `dagger.io/*` attributes — are stored as
structured metadata and filter with `| trace_id="…"`.

## Why it is like this

**Monolithic, not SimpleScalable or Distributed.** SimpleScalable is deprecated and
goes away in Loki 4; Distributed is a dozen workloads plus memcached for a
cluster that produces a few hundred megabytes of compressed logs a day. One
process is the whole install. The cost is no replication: while the pod restarts,
Alloy buffers and retries, and queries fail.

**Filesystem on `ssd`, not S3.** Chosen deliberately over the SeaweedFS S3 tier.
Grafana's Tempo docs call SeaweedFS "not fully tested", there are open reports of
Loki reads failing against it, and the `hdd` tier stops accepting writes when
node-1 or node-2 is down — precisely when logs matter. `ssd` is DRBD with two
replicas and a tiebreaker, so the volume survives any single node, and Loki needs
no credentials or buckets. The trade is SSD capacity, bounded by retention. Moving
to object storage later is a schema change (a new `schemaConfig` period with
`object_store: s3`), not a migration of old chunks.

**`chunksCache` and `resultsCache` are off.** The chart's default chunks cache is a
memcached StatefulSet requesting about 9.8Gi of memory, on a cluster whose fullest
node already sits above 60%. At this volume Loki's in-process caches are enough.

**No gateway, no canary, no test, no rules sidecar.** The nginx gateway only adds a
hop in front of one pod; the canary is a DaemonSet writing synthetic logs; the
chart test requires the canary; the rules sidecar watches every ConfigMap and
Secret cluster-wide for rule files nothing ships yet. Log-based alerting would
start by turning that sidecar back on.

**`allow_structured_metadata: true` is not optional.** OTLP ingestion stores
resource and log attributes as structured metadata; with it off, Loki rejects
every OTLP push. `volume_enabled` and `pattern_ingester` power Grafana's Logs
Drilldown app.

**`ingestion_rate_mb: 16`, burst 32.** The default 4MB/s is below what a burst of
parallel Dagger runs plus a node's worth of pod logs after an Alloy restart can
produce; hitting it returns 429s that Alloy retries, delaying rather than losing
lines — but also delaying every other stream behind them.

**`GOMEMLIMIT` just under the 2Gi limit.** It makes the Go runtime collect harder
near the limit instead of being OOM-killed at it.

## Traps

- **`read`, `write` and `backend` must stay at `replicas: 0`.** They default to 3
  and the chart refuses to render `Monolithic` with any of them non-zero.
- **`test.enabled: false` must follow `lokiCanary.enabled: false`.** The chart
  test depends on the canary and fails validation without it.
- **`schemaConfig` periods are append-only.** Never edit the `from` date or the
  store of an existing period — Loki would stop finding every chunk written under
  it. Add a new period starting in the future instead.
- **The PVC is not resized by editing `size` alone.** StatefulSet
  `volumeClaimTemplates` are immutable; grow `storage-loki-0` directly (LINSTOR
  expands online) and then update the value so a rebuild matches.
- **`auth_enabled: false` means one tenant, `fake`, and no authentication.**
  Anything in the cluster that can reach port 3100 can push and query. App namespaces (`asp`, `fbref`, `scraper`, `database`, `lab`, `identity`, `n8n`, `flux-system`) carry NetworkPolicies, but `monitoring` has none, so nothing restricts who reaches it.
  Loki is not exposed outside the cluster.
- **Retention is enforced by the compactor, not by the ingester.** `retention_period`
  does nothing unless `compactor.retention_enabled` is true and
  `delete_request_store` is set; with either missing, the volume fills.

## Operating it

```sh
kubectl kustomize monitoring/controllers/staging
flux get hr -n monitoring loki
kubectl -n monitoring get pods,pvc -l app.kubernetes.io/name=loki

# Is it ready, and what does it think its config is?
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -s localhost:3100/ready
curl -s localhost:3100/config | less

# What is arriving, per job?
curl -sG localhost:3100/loki/api/v1/label/job/values
```

Disk use: `kubelet_volume_stats_used_bytes{persistentvolumeclaim="storage-loki-0"}`
in Prometheus, or the "Kubernetes / Persistent Volumes" dashboard.
