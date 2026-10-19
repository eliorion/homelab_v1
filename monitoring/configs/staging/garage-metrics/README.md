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

`GarageDiskFullIn24h` deliberately has no "only when nearly full" guard: on 2026-10-19 node c's
metadata disk lost 1.7 GB/h with 80 % still free, because the writes a hung node misses are queued
in the other nodes' metadata.

## Why the token is in sops, not OpenBao

It is on the alerting path: Garage filling up is exactly what must still page if OpenBao is
down (`infrastructure/services/base/openbao/README.md`, the SOPS list).

## The token is chosen in git, not by Garage

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
