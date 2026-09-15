# Alloy

The collection layer. Two Alloy installations from the same chart, each with a
hand-written config:

- **`alloy-node`** — a DaemonSet that tails log *files* on every node: pod logs,
  Talos service and kernel logs, and the kube-apiserver audit log. Ships to Loki.
- **`alloy-receiver`** — a one-replica Deployment that is the cluster's single
  OTLP endpoint (traces to Tempo, logs to Loki, metrics to Prometheus) and collects
  Kubernetes events.

Prometheus keeps doing all metrics *scraping*; Alloy scrapes nothing. The design
narrative is
[`documentations/18-observability-lgtm.md`](../../../../documentations/18-observability-lgtm.md).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the resources below and generates ConfigMaps `alloy-node` and `alloy-receiver` (key `config.alloy`) from `config/`, **without** a name hash. |
| `repository.yaml` | `HelmRepository/alloy` in `monitoring`, `https://grafana.github.io/helm-charts`. |
| `release-node.yaml` | `HelmRelease/alloy-node`, chart `alloy` `1.12.1` (Alloy v1.19.2), DaemonSet. |
| `release-receiver.yaml` | `HelmRelease/alloy-receiver`, same chart, Deployment, extra Service ports 4317/4318. |
| `rbac.yaml` | `ClusterRole`/`ClusterRoleBinding` `alloy-receiver-events`: `get`/`list`/`watch` on `events`, bound to the `alloy-receiver` ServiceAccount. |
| `config/node.alloy` | Pipeline of `alloy-node`. |
| `config/receiver.alloy` | Pipeline of `alloy-receiver`. |

Both releases `dependsOn: kube-prometheus-stack` (their ServiceMonitors need its
CRDs), set `crds.create: false` (the chart's `PodLogs` CRD is unused) and render
a `ServiceMonitor` labelled `release: kube-prometheus-stack` on port 12345.
`monitoring/controllers/staging/alloy/` only references the base.

### alloy-node

| Source | Path on the node | Loki labels | Processing |
|---|---|---|---|
| Pod logs | `/var/log/pods/*/*/*.log` | `job="kubernetes-pods"`, `namespace`, `pod`, `container`, `stream`, `node` | `stage.cri`; namespace/pod/container parsed from the path; `trace_id`/`span_id` of JSON lines as structured metadata |
| Talos services and kernel | `/var/log/*.log` except `auditd.log` | `job="talos"`, `service`, `node` | successful Talos API calls in `machined` dropped |
| Audit log | `/var/log/audit/kube/kube-apiserver.log` | `job="kube-apiserver-audit"`, `node` | filtered, timestamp from `requestReceivedTimestamp` |

The pod mounts `/var/log` read-only (`alloy.mounts.varlog`) and a hostPath
`/var/lib/alloy-node` as its storage path, which holds the tail positions. It runs
as root with every capability dropped except `DAC_READ_SEARCH`, has no RBAC and no
ServiceAccount token. `K8S_NODE_NAME` is injected by the chart.

### alloy-receiver

| Input | Output |
|---|---|
| OTLP gRPC `:4317`, OTLP HTTP `:4318` | traces → `tempo:4318` (OTLP HTTP); logs → `loki:3100/otlp`; metrics → `kube-prometheus-stack-prometheus:9090/api/v1/otlp` |
| `loki.source.kubernetes_events` | Loki, `job="kubernetes-events"`, logfmt |

All three OTLP signals pass through one `otelcol.processor.batch`. Service:
`alloy-receiver.monitoring.svc.cluster.local`, ports `http-metrics` 12345,
`otlp-grpc` 4317, `otlp-http` 4318. The ARC runner pods are the first client —
[`infrastructure/services/staging/arc-runner-set/README.md`](../../../../infrastructure/services/staging/arc-runner-set/README.md).

## Why it is like this

**Plain `grafana/alloy`, not `grafana/k8s-monitoring`.** k8s-monitoring v4 adds an
Alloy operator, a CRD and Helm hook Jobs, and duplicates kube-state-metrics,
node-exporter and scraping that kube-prometheus-stack already owns. Its node-log
feature reads the systemd journal, which Talos does not have, so the Talos and
audit inputs would have been hand-written anyway. Two small configs in git are
easier to read than a values file that generates them.

**Files, not the Kubernetes API, for pod logs.** `loki.source.kubernetes` streams
logs through the apiserver — one long-lived request per container, on control
planes that also run every workload. Tailing `/var/log/pods` costs the apiserver
nothing. Parsing namespace, pod and container out of the path instead of
discovering pods means `alloy-node` needs no API access at all; the price is that
pod labels (`app`, …) are not attached to log streams.

**Talos logs from `/var/log`, not `machine.logging.destinations`.** Talos 1.13
already writes each service's log (`kubelet.log`, `etcd.log`, `machined.log`,
`cri.log`, `kernel.log`, …) under `/var/log` on the node, rotating at 5MB. Tailing
them needs no Talos config change, no `hostNetwork` listener and no experimental
Alloy component — the JSON-lines-over-TCP route needs `loki.source.syslog` with
the experimental `raw` format. `auditd.log` is excluded: it is the kernel's
SELinux audit stream, megabytes an hour of `PROCTITLE`/`AVC` records. The
`machined` drop removes one line per Talos API call, which the Homepage widgets
generate continuously.

**The audit log is filtered, hard.** Talos' default policy logs every request at
`Metadata`, in up to three stages. Measured on node-1: 100MB every ~25 minutes,
about 6GB a day per node. The pipeline drops:

1. the `RequestReceived` and `ResponseStarted` stages (each request is kept once,
   at `ResponseComplete`);
2. successful (`1xx`/`2xx`/`3xx`) `get`/`list`/`watch` by any `system:` identity —
   `1xx` because a WebSocket watch (the Keycloak operator's Java client) completes
   with `101 Switching Protocols`, which the first version of the regex let through;
3. `create`/`update`/`patch` of `leases`, `subjectaccessreviews` and `tokenreviews`
   — leader-election heartbeats and authorization checks;
4. `patch` by Flux's `kustomize-controller` and `helm-controller` — server-side
   apply on every reconcile; git is the audit trail for those.

On a 20 000-line sample this kept 451 lines (2.3%): every human and `talos:admin`
request, every failed request, and every write by a workload identity. That is
about 130MB a day per node before Loki's compression. Filtering in Alloy rather
than tightening the Talos audit policy keeps the full log on the node's disk for
forensics (Talos rotates it at 100MB × 10), while Loki only holds what is worth
searching.

**Trace ids from app logs become structured metadata.** The asp, fbref and scraper
Python services write JSON logs, and inside a sampled span their formatter adds
`trace_id` and `span_id`. Lifting both into structured metadata lets Loki's `trace_id`
derived field link a log line to its trace, and Tempo's "Logs for this span" query
(`| trace_id=… | span_id=…`) find the lines of a span. Labels would open a stream per
trace. Only lines containing `"trace_id": "` are parsed, so the JSON stage never runs on
the rest of the cluster's logs.

**`alloy-receiver` is one replica.** `loki.source.kubernetes_events` has no
clustering, so a second replica would ship every event twice. OTLP itself is
stateless and could scale; if it ever needs to, split events into their own
instance first.

**Traces go to Tempo over OTLP HTTP.** OTLP gRPC's default 4MiB message cap is
smaller than a batch of Dagger spans, whose `dagger.io/dag.call` attributes are
large.

**ConfigMaps without a name hash.** The chart takes the ConfigMap by name, and its
`config-reloader` sidecar watches the mounted file and calls `/-/reload`, so a
config change applies in place without restarting a DaemonSet that is tailing
every log on the node. A hashed name would change the pod spec on every edit.

**Least-privilege RBAC.** The chart's default Role grants `get`/`list`/`watch` on
Secrets and ConfigMaps cluster-wide, plus pods, nodes and every monitoring CRD.
`alloy-node` needs none of it; `alloy-receiver` needs events only. The chart
cannot render a rules list with an empty `clusterRules` (its template emits an
invalid sequence), so `alloy-receiver` sets `rbac.create: false` and `rbac.yaml`
carries the one rule.

## Traps

- **`config.alloy` in `release-*.yaml` must match the generator's key and name** in
  `kustomization.yaml`. A mismatch mounts an empty directory; Alloy exits with "no
  such file" and CrashLoops.
- **The `.alloy` files are configMapGenerator inputs.** Editing a comment in them
  changes the ConfigMap and triggers a reload. Harmless, but not a no-op.
- **`tail_from_end = true` only applies to files with no saved position.** Wiping
  `/var/lib/alloy-node` on a node (or losing the hostPath) makes Alloy start at the
  end of every file again: lines written while it was down are skipped, not
  re-sent.
- **Talos SELinux is `permissive`.** The files Alloy reads are labelled
  `pods_log_t`, `var_log_t` and `kube_log_t`. If the nodes are ever switched to
  `enforcing`, these reads are denied and log collection stops with permission
  errors, not with a pod failure.
- **The audit drop rules are regexes over `verb;username;code` joined with `;`.**
  Reordering the `source` list without rewriting the expression silently changes
  what is dropped. The `drop_counter_reason` of each stage shows up in
  `loki_process_dropped_lines_total{reason=…}` — check it after any edit.
- **The trace-id match is a substring of Python's `json.dumps` output**, `"trace_id": "`
  with a space after the colon. A logger that writes compact JSON (`"trace_id":"`)
  is not matched and its lines get no trace link. The selector is an Alloy raw
  string holding a double-quoted LogQL filter: a LogQL backtick string there passes
  `alloy validate` but fails when the component is built, and the reloader then
  keeps the previous config.
- **`alloy-node` runs as root with `DAC_READ_SEARCH`.** The audit log is mode 0600
  owned by uid 65534; dropping the capability makes that one source fail while pod
  and Talos logs keep flowing.
- **Stability level is `generally-available`.** An experimental component added to
  either config makes Alloy refuse to load the file until
  `alloy.stabilityLevel` is raised — and the reloader keeps the previous config
  running, so nothing looks broken.

## Operating it

Validate a config change before committing (Alloy v1.19.2 binary):

```sh
K8S_NODE_NAME=x alloy validate monitoring/controllers/base/alloy/config/node.alloy
alloy validate monitoring/controllers/base/alloy/config/receiver.alloy
alloy fmt -w monitoring/controllers/base/alloy/config/*.alloy
```

In the cluster:

```sh
flux get hr -n monitoring alloy-node alloy-receiver
kubectl -n monitoring get pods -l app.kubernetes.io/name=alloy -o wide

# The component graph and each component's health
kubectl -n monitoring port-forward svc/alloy-receiver 12345:12345   # http://localhost:12345

# Did a reload apply?
kubectl -n monitoring logs ds/alloy-node -c alloy | grep -i reload
```

Useful metrics: `loki_write_sent_entries_total`, `loki_write_dropped_entries_total`,
`loki_process_dropped_lines_total` (by `reason`),
`otelcol_receiver_accepted_spans_total`, `otelcol_exporter_send_failed_spans_total`,
`otelcol_exporter_send_failed_log_records_total`.
