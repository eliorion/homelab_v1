# blackbox-probes — is the service reachable the way users reach it?

`Probe` objects that make Prometheus test endpoints through the blackbox exporter
([`monitoring/controllers/base/blackbox-exporter`](../../../controllers/base/blackbox-exporter/README.md)),
and the rules that alert on the results.

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the two files below. |
| `probe.yaml` | Three `Probe` objects in `monitoring`, each `interval: 60s`. |
| `prometheusrule.yaml` | `PrometheusRule/blackbox-probes`, group `blackbox-probes.rules`. |

| Probe | Job | Module | Targets | Exposure |
|---|---|---|---|---|
| `public-endpoints` | `blackbox-public` | `http_2xx` | Keycloak realm `mcp` OIDC discovery, `nao.eliorion.fr`, `mve-azuracast.eliorion.fr` | internet via Cloudflare tunnel |
| `public-endpoints-authenticated` | `blackbox-public` | `http_401` | `fbref-mcp.eliorion.fr/mcp` | internet via Cloudflare tunnel |
| `internal-endpoints` | `blackbox-internal` | `http_401` | `registry.eliorion.fr/v2/` (Harbor) | cluster only |

| Alert | Expression | `for` | Severity |
|---|---|---|---|
| `PublicEndpointDown` | `max by (instance) (probe_success{job="blackbox-public"}) == 0` | 5m | critical |
| `InternalEndpointDown` | same for `job="blackbox-internal"` | 5m | warning |
| `EndpointTLSCertExpiringSoon` | `min by (instance) (probe_ssl_earliest_cert_expiry - time()) < 14d` | 1h | warning |

Measured when this was written (2026-09-15), from outside the cluster with exporter
v0.28.0: every public target `probe_success 1` — Keycloak 200, nao 200 (the app, behind
Cloudflare Access at the edge), azuracast 302 → `/login` 200, fbref-mcp `/mcp` 401. A
negative control (`http_401` against a 200 site) returned 0.

## Why it is like this

**The targets are the internet-facing hostnames from the Cloudflare tunnel**
([`infrastructure/services/staging/cloudflare/README.md`](../../../../infrastructure/services/staging/cloudflare/README.md)),
each on a path that exercises the backend rather than Cloudflare alone: Keycloak's OIDC
discovery document is served by Keycloak, not by the edge. Tailnet-only services are not
probed: the exporter pod is not on the tailnet, and those are admin UIs already covered by
their pods' readiness.

**Harbor is `warning`, public endpoints `critical`.** An unreachable registry degrades image
pulls (Talos and the Dagger engines fall back to the upstream registries); an unreachable
public endpoint is an outage someone outside notices.

**Certificate expiry from the probe complements cert-manager's.** `probe_ssl_earliest_cert_expiry`
covers the certificates users actually receive — including Cloudflare's edge certificates,
which cert-manager never sees. cert-manager's own view of the certificates it manages is in
[`../cert-manager-metrics`](../cert-manager-metrics/README.md).

## Traps

- **Every object needs `release: kube-prometheus-stack`** ([`../../README.md`](../../README.md)).
  Prometheus' `probeSelector` matches it; without it the probe is silently ignored.
- **Changing an endpoint's auth changes the right module.** If `fbref-mcp` ever answers `/mcp`
  without authentication, `http_401` fails and `PublicEndpointDown` fires — intended. Moving a
  target between modules is a deliberate statement about what "healthy" means.
- **Probing from the cluster cannot detect the home internet uplink failing** — the probe
  requests would fail too, but Alertmanager could not deliver the alert either. That failure
  mode belongs to the dead man's switch.
- **Keycloak's realm name is in the URL.** Renaming realm `mcp` makes the probe return 404.
- **Harbor's CiliumNetworkPolicy admits `cluster`, `host` and `remote-node` only.** The
  exporter pod is a `cluster` identity; moving it to `hostNetwork` would still pass, moving the
  probe outside the cluster would not.

## Operating it

```promql
probe_success{job=~"blackbox-.+"}
probe_http_status_code{job=~"blackbox-.+"}
(probe_ssl_earliest_cert_expiry{job=~"blackbox-.+"} - time()) / 86400
probe_duration_seconds{job=~"blackbox-.+"}
```
