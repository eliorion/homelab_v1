# cilium-metrics — Cilium, Hubble and Envoy scrapes

Three `PodMonitor`s that give Prometheus the network layer: the Cilium agent's own
metrics, Hubble's flow metrics (drops, DNS, TCP flags, ICMP, per-namespace flows),
the operator, and the Envoy DaemonSet that serves the Gateway API. The Grafana
dashboards come from the Cilium chart itself.

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `podmonitor.yaml`. |
| `podmonitor.yaml` | `PodMonitor`s in `monitoring`, all selecting pods in `kube-system`. |

| PodMonitor | Pod selector | Ports | Added labels |
|---|---|---|---|
| `cilium-agent` | `k8s-app: cilium` | `prometheus` (9962), `hubble-metrics` (9965) | `k8s_app`, `node` |
| `cilium-operator` | `io.cilium/app: operator` | `prometheus` (9963) | `io_cilium_app` |
| `cilium-envoy` | `k8s-app: cilium-envoy` | `envoy-metrics` (9964) | `k8s_app`, `node` |

The ports exist because
[`infrastructure/controllers/base/cilium/release.yaml`](../../../../infrastructure/controllers/base/cilium/release.yaml)
sets `prometheus.enabled`, `hubble.metrics.enabled` (the operator and Envoy
listeners are chart defaults). The same file enables `dashboards`,
`operator.dashboards` and `hubble.metrics.dashboards`, which render six dashboard
ConfigMaps into `kube-system` labelled `grafana_dashboard: "1"`; the Grafana
sidecar watches every namespace.

## Why it is like this

**PodMonitors here, not the chart's ServiceMonitors.** The Cilium chart can render
its own ServiceMonitors, but Cilium is installed by `infra-cilium`
(`wait: true`) *before* anything else — it is the CNI. A ServiceMonitor inside that
release needs the prometheus-operator CRDs, which only exist once
kube-prometheus-stack is running, which needs a CNI. On a cold bootstrap that is a
deadlock (the chart fails the render unless `trustCRDsExist`, and with it the apply
fails instead). Objects in `monitoring-configs` just retry until the CRDs exist.
The dashboards stay in the Cilium release because ConfigMaps need no CRD — and in
`kube-system`, because a `monitoring` namespace would be the same ordering problem.

**`podTargetLabels` copy `k8s-app` and `io.cilium/app`.** The chart's dashboards
filter on `k8s_app="cilium"` and `io_cilium_app="operator"`, labels its own
ServiceMonitors would add. Without them every panel is empty.

**Hubble metrics carry `labelsContext=source_namespace,destination_namespace`.**
That is what populates the namespace variables of the `hubble-network-overview-namespace`
and `hubble-dns-namespace` dashboards. Workload- or pod-level context was not
added: with ~35 namespaces, namespace pairs stay cheap, while pod pairs grow with
every ephemeral CI runner.

## Traps

- **Every object needs `release: kube-prometheus-stack`** — see
  [`../../README.md`](../../README.md). Missing it, the scrape silently never
  happens.
- **Port names are a contract with the Cilium chart.** A chart bump that renames
  `hubble-metrics` or `envoy-metrics` leaves these monitors selecting nothing, with
  no error.
- **`hubble-l7-http-metrics-by-workload` and `hubble-dns-namespace` stay empty.**
  Hubble's HTTP and DNS metrics come from Cilium's L7 proxy, which only sees traffic
  selected by an L7 rule (`toPorts.rules.http` / `rules.dns`) in a
  `CiliumNetworkPolicy`. The NetworkPolicies in the app namespaces are plain L3/L4, so
  `hubble_dns_queries_total` and `hubble_http_requests_total` have no series (measured
  2026-09-14). The dashboards are rendered by the chart and cannot be skipped
  separately.
- **The agent is `hostNetwork`**: ports 9962 and 9965 are open on every node's LAN
  address, unauthenticated, like node-exporter's 9100.

## Operating it

```sh
kubectl -n monitoring get podmonitor cilium-agent cilium-operator cilium-envoy
# Prometheus → Status → Targets: podMonitor/monitoring/cilium-agent/0 and /1
```

```promql
sum by (reason) (rate(hubble_drop_total[5m]))
sum by (source_namespace, destination_namespace) (rate(hubble_flows_processed_total{verdict="DROPPED"}[5m]))
```
