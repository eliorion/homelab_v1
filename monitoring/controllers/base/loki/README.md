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
| `kustomization.yaml` | Lists `repository.yaml`, `release.yaml` and `prometheusrule-ruler.yaml`; generates ConfigMap `loki-rules` from `rules/fake/` **without** a name hash. |
| `repository.yaml` | `HelmRepository/loki` in `monitoring`, `https://grafana-community.github.io/helm-charts`. |
| `release.yaml` | `HelmRelease/loki`, chart `loki` `18.13.0` (Loki 3.7.7), `dependsOn: kube-prometheus-stack`. |
| `rules/fake/log-alerts.yaml` | The log-based alert rules, evaluated by Loki's ruler. See "Log-based alerts" below. |
| `prometheusrule-ruler.yaml` | `PrometheusRule/loki-ruler`: `LokiRuleEvaluationFailing`, `LokiRulerCannotNotify` — Prometheus watching the ruler. |

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
chart test requires the canary; the rules sidecar needs a ClusterRole reading every
ConfigMap and Secret, and writes rule files flat into one directory. Rules ship as
a plain ConfigMap instead — see below.

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

## Log-based alerts

Loki's ruler (in-process in Monolithic mode) evaluates LogQL alert rules every minute
and sends firing alerts to Alertmanager, so they reach Telegram through the same routes
as every Prometheus alert.

- `rules/fake/log-alerts.yaml` becomes ConfigMap `loki-rules` (kustomize generator, no
  hash), mounted through `singleBinary.extraVolumes` at `/etc/loki/rules/fake`.
- `loki.rulerConfig`: `storage.type: local` at `/etc/loki/rules`,
  `alertmanager_url: http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093`
  (API v2), `enable_api: true`.

| Alert | Source | Fires when | Severity |
|---|---|---|---|
| `KernelDiskIOErrors` | `{job="talos", service="kernel"}` | block-device or USB-bridge error signatures (`I/O error`, `uas_eh_`, `reset SuperSpeed USB`, `blk_update_request`, `critical medium error`) in 10m | critical |
| `KernelHungTask` | kernel | `blocked for more than N seconds`, soft/hard lockup, RCU stall | warning |
| `KernelOOMKill` | kernel | the node-level OOM killer ran | warning |
| `FilesystemErrors` | kernel | XFS error/corruption/shutdown, ext4 error, remount read-only | critical |
| `VolumeMountFailing` | `{job="kubernetes-events"}` | > 10 FailedAttachVolume/FailedMount in 30m per namespace, for 15m | warning |
| `UnexpectedPodExec` | `{job="kube-apiserver-audit"}` | a successful (`101`) exec/attach/port-forward by anyone except `admin`, `talos:admin`, `arc-runners` service accounts, the CNPG operator | warning |

**Why these, and not more.** Each targets a failure that metrics do not see or see late,
and each was backtested over 24 hours of real logs (2026-09-15, including three node
reboots the day before) with zero would-be firings:

- The kernel signatures are the ones recorded while qualifying the USB disks
  ([`documentations/16`](../../../../documentations/16-usb-disk-qualification.md)); they
  matched 0 lines in 24 h and match the sample error lines they target.
- `VolumeMountFailing`'s threshold sits above what a node reboot produces (peak 7 events
  in 15 minutes in one namespace during the reboots).
- `UnexpectedPodExec`'s allowlist is exactly the identities seen in 24 h: `admin` (the
  cluster admin kubeconfig), the ARC runner service account (Dagger's `kube-pod://`
  transport), and the CNPG operator.

Rejected because a metric alert already covers them: DRBD split-brain and quorum loss
(`infrastructure/controllers/base/linstor/monitoring`), etcd slow disk
(`EtcdRequestLatencyHigh`, `etcdHighCommitDurations`), image pull failures
(`KubeContainerWaiting`).

## Traps

- **Never match bare `denied`, `error` or `drbd` in kernel lines.** node-3 logs ~2 200
  SELinux `avc: denied` lines an hour (permissive mode), and DRBD logs routine state
  changes several times an hour per node. Every kernel rule matches a specific failure
  signature.
- **The ConfigMap must keep its fixed name.** `release.yaml` mounts `loki-rules` by name;
  kustomize's hash suffix is not rewritten inside HelmRelease values, so re-enabling the
  hash mounts a ConfigMap that does not exist and the pod fails to start.
- **No `subPath` on the rules mount.** A subPath mount never receives ConfigMap updates;
  the plain directory mount does, and the ruler re-reads it on its poll interval.
- **The tenant directory is `fake`** because `auth_enabled` is false. Rules placed directly
  under `/etc/loki/rules` are ignored without an error.
- **Rule files are `configMapGenerator` inputs.** Editing a comment in them changes the
  ConfigMap and reloads the rules; harmless, but not a no-op.
- **`UnexpectedPodExec` allowlists `admin` by name.** Everyone using the admin kubeconfig
  is invisible to it; it catches service accounts and other identities, not a leaked
  admin credential.

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
