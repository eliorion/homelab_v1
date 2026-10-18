# garage-metrics

Prometheus scrapes the three Garage nodes' admin API (`:3903/metrics`) through the Tailscale
operator's egress Services, one target per node, because each node's `/metrics` describes only
itself. Going through the garage-gateway HAProxy would round-robin and mix the nodes into one
series.

| File | What it holds |
| --- | --- |
| `scrapeconfig.yaml` | `ScrapeConfig garage` (`monitoring.coreos.com/v1alpha1`): targets `garage-node-{a,b,c}.tailscale.svc.cluster.local:3903`, label `garage_node`, Bearer auth from the Secret below, every 60 s. |
| `garage-metrics-token.enc.yaml` | Secret `garage-metrics-token` (`token`), sops-encrypted. |

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
- **Alerts and a dashboard come after the first scrape**, so they use the metric names the
  running Garage version really exports, not guessed ones.
