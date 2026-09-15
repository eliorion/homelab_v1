# blackbox-exporter

Prometheus' black-box prober. It performs HTTP requests on Prometheus' behalf — DNS
lookup, TCP, TLS handshake, status check — and reports `probe_success`,
`probe_http_status_code` and `probe_ssl_earliest_cert_expiry` per target. This directory
only installs the prober; **what** is probed (the `Probe` objects) and the alert rules live
in [`monitoring/configs/staging/blackbox-probes`](../../../configs/staging/blackbox-probes/README.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `release.yaml`. |
| `release.yaml` | `HelmRelease/prometheus-blackbox-exporter` in `monitoring`, chart `prometheus-blackbox-exporter` `11.18.0` (exporter v0.28.0), two modules, requests 10m / 32Mi, limit 64Mi. |

`monitoring/controllers/staging/blackbox-exporter/` only references the base.

The release renders one Deployment and the Service
`prometheus-blackbox-exporter.monitoring.svc.cluster.local:9115`, which every `Probe`
names as its `prober.url`. No ServiceMonitor: Prometheus scrapes the exporter's `/probe`
endpoint through the `Probe` objects, not the exporter itself.

| Module | Passes when |
|---|---|
| `http_2xx` | HTTPS only (`fail_if_not_ssl`), certificate valid, redirects followed, final status 2xx |
| `http_401` | HTTPS only, certificate valid, **no** redirect, status exactly `401` |

Both force IPv4 (`preferred_ip_protocol: ip4`): the cluster has no IPv6 egress, and the
default dual-stack attempt would add a failing AAAA path to every probe.

## Why it is like this

**Probes run inside the cluster, not from outside.** They take the same path a user does
— public DNS, Cloudflare's edge, the tunnel back into the cluster, the origin — so a broken
tunnel, a missing DNS record, a revoked edge certificate or a crashed backend all fail the
probe. What an in-cluster prober cannot see is the home internet link itself going down;
that case is the dead man's switch's job (pings to healthchecks.io stop).

**`http_401` for authenticated endpoints.** `fbref-mcp` and the Harbor registry API answer
unauthenticated requests with `401`. Treating `401` as success is deliberate: it proves the
service is up *and* still enforcing authentication. A `200` there would mean auth was
switched off and fails the probe, which is the point.

**The HelmRepository is `kube-prometheus-stack`'s.** Both charts come from
`prometheus-community`; a second HelmRepository object would download the same large index
twice a day. The name is a leftover of that repository's first consumer.

## Traps

- **Renaming the HelmRelease renames the Service**, and every `Probe` in
  `monitoring/configs/staging/blackbox-probes` would target a prober that does not exist.
  Nothing fails loudly: the scrape errors and `PublicEndpointDown` fires for every target.
- **A module name used by a `Probe` must exist here.** An unknown module makes the exporter
  answer the scrape with an error for that target only.
- **`fail_if_not_ssl: true` on both modules.** A target given as `http://` fails by design;
  use a new module if a plain-HTTP target is ever needed.
- **Deleting the `kube-prometheus-stack` HelmRepository breaks this release too.**

## Operating it

Validate a module change locally before committing (exporter v0.28.0 binary):

```sh
blackbox_exporter --config.check --config.file=<(helm template … | yq 'select(.kind=="ConfigMap") | .data."blackbox.yaml"')
```

Probe a target by hand through the in-cluster exporter:

```sh
kubectl -n monitoring port-forward svc/prometheus-blackbox-exporter 9115:9115
curl -s 'localhost:9115/probe?module=http_401&target=https://registry.eliorion.fr/v2/&debug=true'
```
