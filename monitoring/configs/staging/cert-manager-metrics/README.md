# cert-manager-metrics — certificates cert-manager manages

A `PodMonitor` on the cert-manager controller and two alert rules on the certificates it
issues: not Ready, and close to expiry.

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the two files below. |
| `podmonitor.yaml` | `PodMonitor/cert-manager` in `monitoring`: namespace `cert-manager`, pods `app.kubernetes.io/name: cert-manager` + `app.kubernetes.io/component: controller`, port `http-metrics` (9402). |
| `prometheusrule.yaml` | `PrometheusRule/cert-manager`, group `cert-manager.rules`. |

| Alert | Expression | `for` | Severity |
|---|---|---|---|
| `CertificateNotReady` | `certmanager_certificate_ready_status{condition="False"} == 1` | 15m | warning |
| `CertificateExpiringSoon` | `certmanager_certificate_expiration_timestamp_seconds - time() < 14d` | 1h | warning |

Covered when this was written (2026-09-15): `registry/registry-tls` (letsencrypt-prod),
`identity/keycloak-tls` and `identity/keycloak-ca` (private CA), `cnpg-system/barman-cloud-client`
and `barman-cloud-server` (self-signed issuer).

## Why it is like this

**A PodMonitor here, not the chart's `prometheus.servicemonitor`.** cert-manager is applied by
the `infra-certmanager` Flux Kustomization with `wait: true`, before anything else, and the
ServiceMonitor CRD only exists once kube-prometheus-stack is running. A ServiceMonitor inside
that release would deadlock a cold bootstrap — the same trap documented for Cilium in
[`infrastructure/controllers/base/cilium/README.md`](../../../../infrastructure/controllers/base/cilium/README.md).

**14 days is a renewal failure, not a warning period.** cert-manager renews at two thirds of a
certificate's lifetime — 30 days before expiry for a 90-day Let's Encrypt certificate — so a
certificate still within 14 days of expiry has been failing to renew for over two weeks.

## Traps

- **`exported_namespace`, not `namespace`.** cert-manager's metrics carry the certificate's
  namespace in `namespace`; the scrape target also sets `namespace` (`cert-manager`), so
  Prometheus renames the metric's label. Rules written against `namespace` report every
  certificate as living in `cert-manager`.
- **The pod labels are a contract with the cert-manager chart** (`v1.21.2` at the time). A
  chart bump that changes `app.kubernetes.io/component: controller` leaves the PodMonitor
  selecting nothing — no error, no data, no alert.
- **Only cert-manager-managed certificates.** Cloudflare's edge certificates and the Tailscale
  MagicDNS certificates are not here; the first are covered by the blackbox probes'
  `EndpointTLSCertExpiringSoon`, the second by nothing.

## Operating it

```promql
certmanager_certificate_ready_status{condition="True"}
(certmanager_certificate_expiration_timestamp_seconds - time()) / 86400
```
