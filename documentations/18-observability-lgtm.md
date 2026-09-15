# 18 — Observability: logs, traces and CI runs next to Prometheus

Until September 2026 the cluster had metrics and alerts and nothing else. There
was no log store: a crashed pod's logs died with the pod, Talos service logs were
only readable with `talosctl logs` on the right node, and the apiserver audit log
rotated away unread. There were no traces. Dagger CI runs were visible only as a
wall of text in the GitHub Actions log, or in Dagger Cloud, which is not set up.

This guide covers the change that added the other signals — **Loki** for logs,
**Tempo** for traces, **Alloy** to collect both — alongside kube-prometheus-stack,
and how Dagger CI runs land in it. It ends with an honest gap analysis against
what a production-grade Kubernetes cluster would monitor.

Component detail lives in the READMEs:
[Loki](../monitoring/controllers/base/loki/README.md),
[Tempo](../monitoring/controllers/base/tempo/README.md),
[Alloy](../monitoring/controllers/base/alloy/README.md),
[kube-prometheus-stack](../monitoring/controllers/base/kube-prometheus-stack/README.md),
[cilium-metrics](../monitoring/configs/staging/cilium-metrics/README.md),
[dagger-ci](../monitoring/configs/staging/dagger-ci/README.md).

## 1. What was built

```
                    ┌───────────── every node (alloy-node DaemonSet) ─────────────┐
 /var/log/pods ─────┤                                                             │
 /var/log/*.log ────┤  tail files ─▶ parse/filter ─────────────────────────────┐  │
 /var/log/audit ────┤                                                          │  │
                    └──────────────────────────────────────────────────────────┼──┘
                                                                               ▼
 ARC runner (dagger CLI) ─OTLP/HTTP─▶ alloy-receiver ─┬─ logs ─────────────▶ Loki ──┐
 any OTel app ──────────────────────▶   :4317/:4318   ├─ traces ───────────▶ Tempo ─┼─▶ Grafana
 Kubernetes events API ─────────────▶                 └─ metrics ─┐          │      │
                                                                  ▼          │      │
 ServiceMonitors / PodMonitors ◀── scrape ── Prometheus ◀─────────┴── span metrics ─┘
   (+ controller-manager, scheduler, etcd, Cilium, Hubble, Envoy, Dagger engines)
```

| Signal | Store | Collected by | Retention | Volume |
|---|---|---|---|---|
| Metrics | Prometheus (kube-prometheus-stack `91.2.1`) | Prometheus scraping; OTLP and remote-write pushes | 10 days | 30Gi `ssd` |
| Logs | Loki `3.7.7`, Monolithic | `alloy-node` (files), `alloy-receiver` (OTLP, events) | 14 days | 50Gi `ssd` |
| Traces | Tempo `3.0.3`, monolithic | `alloy-receiver` (OTLP) | 7 days | 30Gi `ssd` |
| Alerts | Alertmanager → Telegram | Prometheus rules, incl. Loki's mixin | — | — |

Delivered in two pull requests: the kube-prometheus-stack upgrade `66.2.2 → 91.2.1`
alone first (Prometheus 3, Grafana 13, operator 0.94), then everything else once
the upgrade was verified on the cluster.

## 2. Decisions

### Loki, Tempo and Alloy — and not the `k8s-monitoring` chart

The request was "kube-prometheus-stack with Tempo and Alloy". Alloy only collects;
logs need a store, so the stack is Grafana's LGTM shape with Prometheus in the
Mimir seat. Grafana Labs' own `k8s-monitoring` chart was rejected: it adds an Alloy
operator, CRDs and Helm hook Jobs, duplicates what kube-prometheus-stack already
runs, and its node-log feature reads the systemd journal, which Talos does not have.

Chart sources changed during 2026 and are easy to get wrong: the open-source Loki
chart is `grafana-community/loki` (`grafana/loki` is now Enterprise Logs only), and
Tempo is `grafana-community/tempo` (`grafana/tempo` is deprecated on Tempo 2.9).
Alloy stays on `grafana/alloy`.

### Single-process Loki and Tempo on LINSTOR, not object storage

Three backends were on the table:

| Option | For | Against |
|---|---|---|
| **LINSTOR `ssd` volumes — chosen** | Survives any single node (DRBD, 2 replicas + tiebreaker); no credentials, no buckets | Uses SSD capacity, bounded by retention; single-process only |
| SeaweedFS S3 (`hdd`) | 4.4TB, nearly empty | Tempo's docs call SeaweedFS untested; open Loki read bugs; the tier refuses writes when node-1 or node-2 is down — exactly when logs matter |
| Garage S3 | Already used for backups | Two of three nodes off-site over the WAN, mid-rebuild; built for backups, not constant small writes |

Tempo 3's distributed mode requires Kafka, which settles monolithic for traces.
Moving either store to S3 later is a configuration change for new data, not a
migration of old data.

### Logs from files, not from the Kubernetes API or a Talos log sink

`alloy-node` tails `/var/log/pods` and parses namespace/pod/container from the path,
so it needs no API access and costs the apiserver nothing. Talos 1.13 already
writes every service's log (`kubelet.log`, `etcd.log`, `machined.log`, `kernel.log`,
…) under `/var/log`, so the planned `machine.logging.destinations` sink — a TCP
listener on `hostNetwork` using an experimental Alloy component — turned out to be
unnecessary. No Talos logging change was made.

### The audit log is filtered to ~2% before it reaches Loki

Measured before the change: node-1's apiserver audit log rotated its 100MB file
every ~25 minutes — about 6GB a day per node, because Talos logs every request at
`Metadata` in up to three stages. Alloy keeps one record per request, drops
successful reads by `system:` identities, leader-election leases, authorization
reviews and Flux's server-side-apply patches. On a 20 000-line sample that kept
451 lines: every human and `talos:admin` request, every failure, every write by a
workload. The unfiltered log still exists on each node's disk.

### Dagger CI without Dagger Cloud

The `dagger` CLI already speaks OTLP. Verified in the Dagger `v0.21.9` source: it
exports traces, logs and metrics to whatever `OTEL_EXPORTER_OTLP_*` names, without
any Cloud token; the CLI — not the engine — does the exporting, pulling engine
spans and step output over the session. So the whole integration is four
environment variables on the ARC runner container, pointing at `alloy-receiver`,
plus a dashboard. Nothing changed in the `asp` repository.

Three details decided the exact shape:

- **Logs need their own endpoint variable with the full `/v1/logs` path.** Dagger
  ignores the base endpoint for logs by design; setting only
  `OTEL_EXPORTER_OTLP_ENDPOINT` gives traces and silently no step output.
- **OTLP over HTTP end to end.** Dagger's gRPC log exporter is unfinished, and
  gRPC's 4MiB message cap is below a batch of Dagger spans.
- **Dagger spans are excluded from Tempo's span metrics** (span names embed
  commands, unbounded cardinality) and **Tempo's per-trace limit is raised to 50MB**
  (one run is one trace of thousands of spans). The dashboard gets run counts and
  durations from TraceQL metrics instead.

The engines also expose Prometheus metrics through the undocumented
`_EXPERIMENTAL_DAGGER_METRICS_ADDR` (connected clients, cache size and entries).

### Control-plane metrics, with a security trade

controller-manager and scheduler now bind `0.0.0.0` (HTTPS, authenticated), and
etcd serves metrics on `:2381` on every node address — **plaintext and
unauthenticated**. That trade had been refused before and recorded as a
deliberate blind spot; it was accepted in this change because etcd on
control planes that also carry every workload and all DRBD replication is where
disk latency will hurt first, and the chart's 15 etcd alerts were inert without it.

### Cilium and Hubble metrics as PodMonitors

Cilium is the CNI and installs before the monitoring stack. Its chart refuses to
render ServiceMonitors without the prometheus-operator CRDs, so enabling them in
the Cilium release would deadlock a cold bootstrap. The metric ports are enabled in
the Cilium release; the scrapes are PodMonitors in `monitoring-configs`.

## 3. Rollout

Order matters in two places.

1. **kube-prometheus-stack `91.2.1`** (PR #162) — merged and verified alone: all
   targets up, 249 rules loaded and healthy, Grafana 13 serving every dashboard.
2. **Talos control-plane patch before the monitoring change reconciles.** The
   dry-run of a full `apply-config` showed it would also push the Harbor registry
   mirrors, which `talconfig.yaml` forbids while Harbor serves a letsencrypt-staging
   chain, and remove Longhorn leftovers. So the three args went on with
   `talosctl patch machineconfig`, node-3 → node-2 → node-1. controller-manager and
   scheduler switched live (kube-apiserver restarted with them). etcd did not: Talos
   stores the new spec but never restarts etcd for it, and refuses
   `service etcd restart`. Each node was rebooted in turn after switching its CNPG
   primaries away and draining it; between nodes, etcd `:2381` answered, DRBD
   returned to `UpToDate` and CNPG to healthy. Only the single-instance `dbtools-db`
   was briefly down.
3. **Merge the observability change.** Flux applies, in dependency order:
   kube-prometheus-stack values (receivers, datasources, control-plane jobs) →
   Loki, Tempo, Alloy (`dependsOn: kube-prometheus-stack`); Cilium rolls its agents
   for the metrics ports; ARC runner pods pick up the OTLP variables on their next
   start; the Dagger engines restart once for the metrics listener.

## 4. Verifying it

```sh
flux get hr -n monitoring
kubectl -n monitoring get pods,pvc

# Logs arriving, per source
kubectl -n monitoring port-forward svc/loki 3100:3100 &
curl -sG localhost:3100/loki/api/v1/label/job/values

# Traces arriving
kubectl -n monitoring port-forward svc/tempo 3200:3200 &
curl -sG localhost:3200/api/search --data-urlencode 'q={resource.service.name="dagger-cli"}' | head -c 400
```

In Grafana: **Explore → Loki** `{job="talos", service="etcd"}`; **Explore → Tempo**
search by service; **Dashboards → Dagger CI**; Prometheus targets for
`kube-etcd`, `cilium-agent` and `dagger-engine`.

### What the rollout showed (2026-09-14)

- All five monitoring releases reached Ready in about three minutes after the merge;
  Loki, Tempo and Alloy waited on kube-prometheus-stack through `dependsOn` as intended.
- Every new scrape target came up: etcd, controller-manager and scheduler on all three
  nodes, Cilium agent, Hubble, Envoy and operator, both Dagger engines, Loki, Tempo and
  the Alloy pods. 301 rules loaded, none unhealthy.
- Loki received all four file and API sources within a minute (`kubernetes-pods`,
  `talos`, `kube-apiserver-audit`, `kubernetes-events`). Index labels stayed at
  nine; every `dagger.io/*` attribute landed as structured metadata.
- A `dagger-ci` run dispatched by hand produced 178 spans (all accepted by Tempo, none
  discarded), 21 step-output log records and 46 metric points, with no exporter
  failures. The dashboard's root-span query found the run (`ci --source=.`), both
  TraceQL metrics panels returned series, and Prometheus gained per-step Dagger metrics
  (`dagger_io_metrics_*`: CPU, memory, IO, network) on top of the engine's own.
- **One bug, fixed in a follow-up:** Tempo names the engine's forwarded spans
  `unknown_service:dagger-engine` while Loki labels the same engine's logs
  `dagger-engine`, so the default `service.name` → `service_name` trace-to-logs
  mapping found nothing for engine steps. The link now filters on `trace_id` and
  `span_id` instead.

## 5. Gap analysis: is this a production-grade monitoring stack?

Measured against what a production Kubernetes platform is normally expected to
observe. "Covered" means data flows and something alerts or can be queried;
"partial" means data exists but a piece is missing.

| Area | State | Detail |
|---|---|---|
| Node and container metrics | Covered | node-exporter, kubelet/cAdvisor, kube-state-metrics |
| Control plane: apiserver, controller-manager, scheduler, etcd | Covered | etcd via the plaintext `:2381` trade above |
| CoreDNS | Covered | chart ServiceMonitor |
| CNI / network flows | Covered | Cilium agent, operator, Envoy; Hubble drops, DNS, TCP, flows per namespace. No L7 HTTP or DNS metrics — Hubble only sees those through L7 rules in a `CiliumNetworkPolicy`, and the app NetworkPolicies are L3/L4 |
| Storage | Covered | LINSTOR and SeaweedFS rules; CNPG WAL archiving and volume fill |
| GitOps | Covered | Flux reconcile failures on two Telegram paths |
| Backups | Covered | etcd backup staleness; CNPG archiving |
| Pod logs | Covered | 14 days |
| Node / OS logs | Covered | Talos services and kernel |
| Audit log | Covered, filtered | Successful system reads are not in Loki; the full log stays on each node for its rotation window |
| Kubernetes events | Covered | kept past the apiserver's 1h event TTL |
| Traces | Partial | Store and pipeline ready; **only Dagger emits them**. The applications (`asp`, `fbref`, `scraper`) are not instrumented. Beyla (eBPF auto-instrumentation, available in Alloy) is the no-code option |
| CI/CD | Covered | Every Dagger run: span tree, step output, duration and failure trend, engine cache. GitHub workflow-level spans (queue time, non-Dagger steps) are not captured |
| Log-based alerting | **Gap** | Loki's ruler is not wired to Alertmanager; no alert fires on a log line |
| Dead man's switch | **Gap** | `Watchdog` is still routed to a blackhole — a dead Prometheus or Alertmanager is silent. Tracked in [14](14-design-decisions.md) |
| Synthetic / black-box probing | Covered | blackbox-exporter probes the four Cloudflare-tunnel hostnames the way users reach them, and Harbor from inside; `PublicEndpointDown` is critical. The home uplink itself failing is left to the dead man's switch |
| Certificate expiry | Covered | cert-manager metrics (`CertificateNotReady`, `CertificateExpiringSoon`) plus probe-side expiry for served certificates, Cloudflare edge included. Harbor, KEDA, ARC controller, Tailscale operator and Keycloak metrics are still not scraped |
| Continuous profiling | Not planned | Pyroscope would be a fourth stateful store for little gain until the applications are profiled |
| Metrics HA and long-term retention | Accepted | One Prometheus replica, 10 days. Thanos or Mimir is the production answer; not worth the footprint at homelab scale |
| Logs and traces HA | Accepted | Single-process Loki and Tempo: a restart pauses ingestion (collectors retry) and queries fail |
| SLOs / error budgets | Not planned | Pyrra or Sloth once applications emit request metrics or traces |
| Runtime security detection | Not planned | Tetragon (Cilium's) or Falco |
| Access control on the stack | Partial | Grafana is tailnet-only with a local admin; no SSO via the existing Keycloak. Loki, Tempo and Prometheus push endpoints are unauthenticated in-cluster; `monitoring` has no NetworkPolicy. An app whose namespace restricts egress must allow `alloy-receiver:4318` before it can send traces |

**Verdict.** With this change the cluster collects all three core signals — metrics,
logs, traces — plus events, audit and CI, which is the substance of a
production-grade stack. What separates it from one is not missing data but missing
*guarantees*: nothing tells you the monitoring itself is dead (dead man's switch),
nothing checks the service from the outside (probing), nothing alerts on logs, and
the stores are single replicas. Those four, in that order, are the next work.

## 6. Costs accepted

- About 1.5Gi more memory requested cluster-wide, up to ~6.5Gi at the limits
  (Loki and Tempo 512Mi / 2Gi each, `alloy-node` 128Mi / 512Mi per node,
  `alloy-receiver` 128Mi / 1Gi), and 80Gi more `ssd` — 160Gi of LVM-thin capacity
  at two replicas.
- Three new unauthenticated plaintext listeners on node addresses: etcd metrics
  (2381), Cilium agent metrics (9962) and Hubble metrics (9965).
- Every ARC job's environment carries `OTEL_EXPORTER_OTLP_*`, so any
  OpenTelemetry-instrumented tool run in CI exports to the cluster too.
- The Dagger engines' metrics come from an undocumented, experimental flag.
