# garage-metrics

Prometheus scrapes the three Garage nodes' admin API (`:3903/metrics`) through the Tailscale
operator's egress Services, one target per node, because each node's `/metrics` describes only
itself. Going through the garage-gateway HAProxy would round-robin and mix the nodes into one
series.

| File | What it holds |
| --- | --- |
| `scrapeconfig.yaml` | `ScrapeConfig garage` (`monitoring.coreos.com/v1alpha1`): targets `garage-node-{a,b,c}.tailscale.svc.cluster.local:3903`, label `garage_node`, Bearer auth from the Secret below, every 60 s. |
| `garage-metrics-token.enc.yaml` | Secret `garage-metrics-token` (`token`), sops-encrypted. |
| `garage-metrics-token.enc.yaml.exemple` | Its plaintext template: copy it, never an existing `.enc.yaml`. |
| `podmonitor-gateway.yaml` | `PodMonitor garage-gateway`: HAProxy's built-in exporter on each gateway pod's `health` port (`/metrics`) — the gateway's own view of each node (`haproxy_server_status`, `haproxy_backend_active_servers`). |
| `prometheusrule.yaml` | `PrometheusRule garage-alerts`, below. |
| `dashboard.yaml` | Grafana dashboard **Garage object storage** (uid `garage-overview`): cluster stats, per-node disks (data and metadata, used %, free, 24 h forecast), reachability and response time, the gateway's health check per node, and the CNPG backups stored on Garage (WAL waiting, archive failures, hours since the last base backup). `$node` filters the per-node panels. |

## Alerts

| Alert | Severity | Fires when |
| --- | --- | --- |
| `GarageNodeUnreachable` | critical | a node's `/metrics` cannot be read for 5 min |
| `GarageMetricsMissing` | critical | no Garage target at all for 15 min (the alerts are blind) |
| `GarageNodeSlow` | warning | a reachable node takes over 5 s to answer for 15 min |
| `GarageDiskAlmostFull` | critical | a data or metadata disk is over 90 % for 5 min |
| `GarageDiskFillingUp` | warning | over 80 % for 30 min |
| `GarageDiskFullIn24h` | warning | the 6 h trend reaches zero free space within 24 h, for 1 h — whatever is free now |
| `GarageGatewayBackendDown` | warning | the gateway's health check marks a node DOWN for 5 min |
| `GarageGatewayNoBackend` | critical | the gateway has no healthy node for 2 min |
| `GarageBucketMetricsMissing` | warning | the bucket exporter cannot poll Garage, or is not running, for 20 min |
| `GarageBucketMultipartLeak` | warning | a bucket holds over 5 GB of unfinished multipart uploads for 6 h |

`GarageDiskFullIn24h` deliberately has no "only when nearly full" guard: on 2026-10-19 node c's
metadata disk lost 1.7 GB/h with 80 % still free, because the writes a hung node misses are queued
in the other nodes' metadata.

## One token for both

`garage-metrics-token` is a scoped Garage admin token, read-only, used twice: Prometheus sends it
for each node's `/metrics`, and `garage-bucket-exporter` uses it for the admin API. Its scopes:

```bash
garage admin-token create --scope Metrics,ListBucketsInfo,ListBuckets,GetBucketInfo,GetClusterStatistics prometheus-staging
```

It can read disk metrics, bucket names, sizes and which keys have access; it cannot create, grant,
delete, or read a key's secret. Garage generates its secret, so it is copied into the sops file
(`.exemple` template), not chosen in git. If `ListBucketsInfo` is not a known scope on the running
version, drop it: the exporter falls back to `ListBuckets` + `GetBucketInfo`.

Switching from the old `metrics_token` without a gap: create the token, put it in the sops file,
merge — Garage accepts both while the node config still sets `GARAGE_METRICS_TOKEN` — then remove
that setting from the nodes.

## Per-bucket statistics

`bucket-exporter.yaml` + `bucket_exporter.py` (stdlib Python, hashed ConfigMap): a Deployment in
`monitoring` that polls `ListBucketsInfo` and `GetClusterStatistics` through
`garage-admin.garage-gw:3903` **every 5 minutes** and serves the last answer on `:9101/metrics`
(`PodMonitor garage-bucket-exporter`, every 60 s, from memory: a scrape never calls Garage). About
10-20 KB per poll, a few MB a day. Metrics: `garage_bucket_{bytes,objects,unfinished_uploads,
unfinished_multipart_uploads,unfinished_multipart_upload_parts,unfinished_multipart_bytes,keys,
quota_max_bytes,quota_max_objects}{bucket,bucket_id}`, `garage_cluster_{object_bytes,objects,buckets,
data_avail_bytes,metadata_avail_bytes,stats_incomplete}`, and `garage_bucket_exporter_up` (0 = the
last poll failed; the last good values keep being served). Garage maintains its bucket counters in
the background: read them as trends, not as exact live values.

## Why the token is in sops, not OpenBao

It is on the alerting path: Garage filling up is exactly what must still page if OpenBao is
down (`infrastructure/services/base/openbao/README.md`, the SOPS list).

## Before 2026-10-21 the token was chosen in git

Garage accepts a `metrics_token` set in its configuration, so the value is generated here and
Garage is told to accept it. On the Garage nodes, set it in the NixOS configuration (all three
nodes, then restart Garage):

```bash
sops -d --extract '["stringData"]["token"]' monitoring/configs/staging/garage-metrics/garage-metrics-token.enc.yaml
# services.garage.settings.admin.metrics_token = "<that value>";
```

Until then every target is `down` with `403`, which is harmless.

## Traps

- **The `release: kube-prometheus-stack` label is required.** Without it Prometheus ignores the
  ScrapeConfig silently.
- **Garage 2.1 exports few metric families here** (`garage_local_disk_*`,
  `garage_replication_factor`, `garage_build_info`); the dashboard and alerts use only those, so a
  panel for a family that appears later has to be added, not assumed.
