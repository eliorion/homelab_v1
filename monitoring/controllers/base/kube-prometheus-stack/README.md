# kube-prometheus-stack

The whole observability stack, installed as one Flux `HelmRelease` into the
`monitoring` namespace: Prometheus, Alertmanager, Grafana, the
prometheus-operator, `prometheus-node-exporter` and `kube-state-metrics`. It is
also the component that installs the CRDs — `Prometheus`, `Alertmanager`,
`ServiceMonitor`, `PodMonitor`, `PrometheusRule` and friends — that every
monitor and alert rule elsewhere in this repository is written against.

No alert rule, dashboard or scrape target lives in this directory. Those are in
`monitoring/configs/staging/` (`cnpg-alerts`, `etcd-backup-alerts`, `flux-am`,
`flux-alerts`, `fbref-grafana`, `n8n-metrics`) and are applied by a separate
Flux Kustomization — see [monitoring/configs/README.md](../../../configs/README.md).
What is configured here is the stack itself: the Grafana
admin credentials and ingress, the Alertmanager routing and Telegram receiver,
and the node-exporter container security context.

## How it is wired

Base — `monitoring/controllers/base/kube-prometheus-stack/`:

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `namespace.yaml`, `repository.yaml`, `release.yaml`, `hpa-maxedout-rule.yaml`. |
| `namespace.yaml` | Namespace `monitoring`, carrying `pod-security.kubernetes.io/enforce`, `/audit` and `/warn` all set to `privileged`. |
| `repository.yaml` | `HelmRepository/kube-prometheus-stack` in namespace `monitoring`, `https://prometheus-community.github.io/helm-charts`, `interval: 24h`. |
| `release.yaml` | `HelmRelease/kube-prometheus-stack` in namespace `monitoring`, chart `kube-prometheus-stack` pinned to `91.2.1`, `interval: 30m` with a `12h` chart interval, `install.crds: Create`, `upgrade.crds: CreateReplace`, drift detection enabled, plus the values described below. |

The `HelmRelease` sets no `targetNamespace` and no `releaseName`: the object,
the Helm release and every workload it creates all land in `monitoring`.

Values in `release.yaml`, block by block:

- **`grafana.admin`** — `existingSecret: grafana-admin`, `userKey: admin-user`,
  `passwordKey: admin-password`. The Secret itself is not in `base/`; each
  overlay supplies its own `grafana-admin.enc.yaml`.
- **`grafana.ingress`** — enabled, `ingressClassName: tailscale`, no `hosts`,
  `tls.hosts: [grafana]`. That publishes Grafana on the tailnet over HTTPS on
  443 and nowhere else. See "Grafana, on the tailnet" below for why `hosts` must
  stay empty.
- **`alertmanager.alertmanagerSpec.secrets`** — mounts the Secret
  `alertmanager-telegram` (namespace `monitoring`) at
  `/etc/alertmanager/secrets/alertmanager-telegram/`. That Secret comes from
  `monitoring/configs/staging/flux-am/telegram-am-secret.enc.yaml`.
- **`alertmanager.config`** — the chart's global Alertmanager configuration:
  group by `namespace` and `alertname`, `group_wait: 30s`,
  `group_interval: 5m`, `repeat_interval: 4h`, default receiver `telegram`, and
  one route sending `alertname = "Watchdog"` to a `blackhole` receiver with no
  configuration. The `telegram` receiver reads the bot token from
  `bot_token_file: /etc/alertmanager/secrets/alertmanager-telegram/token`, posts
  to `https://api.telegram.org` with `chat_id: -5295319950`, `parse_mode: HTML`
  and `send_resolved: true`, and renders alertname, severity, `summary` and
  `description` per alert.
- **`prometheus-node-exporter.containerSecurityContext`** —
  `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`,
  `capabilities.drop: ["ALL"]`.
- **`prometheus.prometheusSpec.enableRemoteWriteReceiver`, `enableOTLPReceiver`,
  `enableFeatures: [exemplar-storage]`** — Prometheus accepts pushes as well as
  scrapes: Tempo's metrics-generator remote-writes span metrics and service graphs
  to `/api/v1/write` (with exemplars), and `alloy-receiver` forwards OTLP metrics to
  `/api/v1/otlp/v1/metrics`. See "Traces and logs datasources" below.
- **`grafana.additionalDataSources`** — `Loki` (uid `loki`) and `Tempo` (uid
  `tempo`), plus `grafana.sidecar.datasources.exemplarTraceIdDestinations` on the
  chart's own Prometheus datasource.

### Traces and logs datasources

Loki, Tempo and Alloy are separate releases next to this one
([`../loki`](../loki/README.md), [`../tempo`](../tempo/README.md),
[`../alloy`](../alloy/README.md)); this release only wires Grafana and Prometheus to
them. The datasources are linked in every direction Grafana supports:

| From | To | How |
|---|---|---|
| Loki log line | Tempo trace | `derivedFields` on the `trace_id` structured-metadata label (OTLP logs carry it) |
| Tempo span | Loki logs | `tracesToLogsV2` custom query: any stream, filtered by the span's `trace_id` and `span_id` structured metadata, ±5m |
| Tempo span | Prometheus | `tracesToMetrics`, `serviceMap` (the `traces_service_graph_*` series) |
| Prometheus exemplar | Tempo trace | `exemplarTraceIdDestinations`, label `trace_id` |

**Why a custom query rather than mapping `service.name` to `service_name`.** The
mapping is the documented default, and it broke on the first real Dagger run
(2026-09-14): spans the engine forwards through the CLI carry
`service.name=unknown_service:dagger-engine` in Tempo, while the same engine's log
records carry `service_name="dagger-engine"` in Loki, so "Logs for this span" on any
engine step queried a stream that does not exist. Matching on `trace_id` and
`span_id` — which every OTLP log record carries — works whatever the two sides call
the service. The `{service_name=~".+"}` selector matches every stream, which is
affordable only because the query is bounded to the span's time window ±5m.

The uids are load-bearing: the datasources reference each other by uid, and so does
the `dagger-ci` dashboard. `url: "$${__value.raw}"` is escaped with `$$` because
Grafana expands `${…}` in provisioning files as environment variables.

**The push receivers are unauthenticated.** Anything in the cluster that can reach
`kube-prometheus-stack-prometheus:9090` can write series. App namespaces (`asp`, `fbref`, `scraper`, `database`, `lab`, `identity`, `n8n`, `flux-system`) carry NetworkPolicies, but `monitoring` has none, so nothing restricts who reaches it; the Service is
not exposed outside the cluster.

Flux side. `clusters/staging/monitoring.yaml` and
`clusters/production/monitoring.yaml` declare a `monitoring-controllers`
Kustomization (`path: ./monitoring/controllers/<env>`, `interval: 1m0s`,
`retryInterval: 1m`, `timeout: 5m`, `prune: true`) with a `decryption` block
pointing at the `sops-age` Secret. Staging additionally declares
`monitoring-configs` (`path: ./monitoring/configs/staging`), also with
decryption. `monitoring-configs` has no `dependsOn` and reconciles straight off
the root Kustomization. `monitoring-controllers` gained one on 2026-08-22 — see
Storage below.

### Storage: 30Gi TSDB + 10Gi grafana.db on `ssd`

Both claim from `ssd` — LINSTOR/DRBD, two replicas plus a diskless tiebreaker —
defined in `infrastructure/controllers/staging/linstor-cluster/`. The history is
`longhorn-monitoring` (a two-replica class shipped from this directory because
node-1 could not place a third replica), then `ceph-block` on 2026-08-22, then
`ssd` with the storage migration in
[17-linstor-seaweedfs-migration.md](../../../../documentations/17-linstor-seaweedfs-migration.md).
No volume contents survived either move, deliberately: the TSDB is bounded by
`retention: 10d`, and every dashboard is sidecar-provisioned from git.

**The StorageClass has a different owner, and the ordering matters.** A class
owned by another Kustomization is a race where the PVC sits Pending, the pod with
it, and the HelmRelease fails its 5m timeout and rolls back. `ssd` comes from
`infrastructure-controllers`, so `monitoring-controllers` declares
`dependsOn: infrastructure-controllers`. That is **weaker than shipping the class
here**: `infrastructure-controllers` carries no `wait: true`, so it reports Ready
once applied, not once LINSTOR serves volumes. On a cold bootstrap the race can
still be lost; `retryInterval: 1m` retries it.

**Both volumes used to be `emptyDir`, and that was a bug, not a simplification.**

- The TSDB on an `emptyDir` lost the whole retention window on every chart
  upgrade, node drain and reschedule. That is why alert `activeAt` timestamps
  across this cluster could not be trusted as onset times: "firing for N days"
  repeatedly meant "the series was recreated N days ago". 30Gi against a measured
  8.7 GiB is roughly 3× headroom.
- `grafana.db` on an `emptyDir` destroyed every UI-created dashboard, user, API
  key, annotation and unified-alerting rule on each restart. Persistence is the
  prerequisite for ever alerting on SQL-datasource conditions from Grafana.

**`deploymentStrategy: Recreate` on Grafana.** An RWO volume cannot attach to two
pods, so the default RollingUpdate deadlocks: the new pod waits for the volume the
old pod holds, and the HelmRelease fails on timeout. The brief outage is
acceptable — nothing alerts through Grafana.

**Rotating the Grafana admin password.** `admin.existingSecret` is only consumed
at Grafana's *first* init against an empty database. With the PVC, editing the
Secret alone silently does not apply. Change the Secret, then either reset it in
place or delete the PVC to force a re-init:

```sh
kubectl -n monitoring exec deploy/kube-prometheus-stack-grafana -c grafana -- \
  grafana cli admin reset-admin-password '<new password>'
```

### Overlays

- **staging** — `monitoring/controllers/staging/kube-prometheus-stack/kustomization.yaml`
  sets `namespace: monitoring` and pulls in `../../base/kube-prometheus-stack/`
  plus `grafana-admin.enc.yaml`, and one JSON 6902 patch replacing
  `/spec/values/kubeEtcd` with `enabled: true` and the three control-plane IPs as
  `endpoints` — environment-specific, so not in `base/`.
  It is referenced from `monitoring/controllers/staging/kustomization.yaml`.
- **production** — the same two resources, plus one JSON 6902 patch on the
  `HelmRelease` that replaces `/spec/values/grafana/ingress/enabled` with
  `false`. The reason is that the Tailscale operator is staging-only — it is
  declared in `infrastructure/controllers/staging/tailscale-operator/` with no
  `base/` and no production copy — so `ingressClassName: tailscale` names a
  controller production does not run. The production
  `grafana-admin.enc.yaml` is a separate ciphertext from the staging one.
  The production tree is wired but not deployed.

## Why it is like this

**The `monitoring` namespace is labelled `privileged` for Pod Security.** Talos
enforces the `baseline` profile by default and node-exporter needs
`hostNetwork`, `hostPID`, `hostPath` and `hostPort` to read node metrics, all of
which `baseline` rejects. The same pattern is used on `longhorn-system`. On k3s
this was a no-op, because PSA was not enforced there.

**Grafana credentials come from a SOPS Secret per overlay, never from chart
values.** Putting `adminPassword` in `release.yaml` would put it in git in
plaintext. `existingSecret` moves it into an encrypted per-environment file that
`base/` never sees, which is the repository-wide rule that encrypted files do
not live in `base/`.

**Alertmanager is configured through the chart's global `alertmanager.config`,
not an `AlertmanagerConfig` CRD.** The cluster runs with
`matcherStrategy: OnNamespace`, which would scope a CRD-defined route to a
namespace label that a metric-derived alert may not carry.

**The Watchdog alert is routed to a `blackhole` receiver.** It is an
always-firing heartbeat and it was pure noise on the phone. The cost is that
there is now no dead man's switch at all: if Alertmanager or the whole stack
dies, silence looks exactly like health. That is a known gap, not a win — see
[14-design-decisions.md](../../../../documentations/14-design-decisions.md).

**node-exporter drops privilege escalation and all capabilities, but keeps
`hostPID` and the host mounts.** A Radar cluster audit flagged
`privilegeEscalation` on this workload. It does not need to escalate, so the
container security context above was added and verified with `helm template` to
land on the container without wiping the chart's own hardening. The
`hostPID`/host-mount finding is accepted as by-design: without it there are no
node metrics.

**Drift detection ignores one annotation.** The prometheus-operator writes
`prometheus-operator-validated` onto every `PrometheusRule` after admission. It
is not present in the rendered manifest, so with drift detection enabled Flux
would see a permanent diff and fight the operator on every reconcile.

**`kubeProxy` is disabled.** Cilium runs `kubeProxyReplacement: true` with
`cluster.proxy.disabled: true`, so there is no kube-proxy at all. The chart would
still create a Service and ServiceMonitor that scrape nothing and hold
`KubeProxyDown` permanently firing at `critical`. A permanently firing critical
trains the operator to ignore the Telegram channel where real alerts land.

### Control-plane metrics: controller-manager, scheduler, etcd

Until 2026-09 all three jobs were disabled. Talos binds kube-controller-manager and
kube-scheduler to `127.0.0.1` and etcd's metrics listener to localhost, so the
chart's scrapes reached nothing and `KubeControllerManagerDown`,
`KubeSchedulerDown` and the whole etcd rule group were either permanently firing
or structurally inert. They are now scraped, which took a node-config change and
a trade:

| Job | Talos change (`bootstraping/talconfig.yaml`) | Scrape |
|---|---|---|
| kube-controller-manager | `cluster.controllerManager.extraArgs.bind-address: 0.0.0.0` | HTTPS `:10257`, Prometheus SA bearer token, `insecureSkipVerify` (self-signed serving cert); Service selects the static pods by `component` |
| kube-scheduler | `cluster.scheduler.extraArgs.bind-address: 0.0.0.0` | HTTPS `:10259`, same |
| etcd | `cluster.etcd.extraArgs.listen-metrics-urls: http://0.0.0.0:2381` | HTTP `:2381`; etcd is a Talos host service, not a pod, so the staging overlay lists the node IPs as `kubeEtcd.endpoints` |

**The trade, accepted deliberately:** `:2381` serves etcd's metrics and `/health`
**unauthenticated and in plaintext** on every node's LAN address, a subnet that also
carries the LB-IPAM pool and the Tailscale gateway. Metrics reveal sizes, latencies
and member IDs, not keys or values. controller-manager and scheduler stay
authenticated and authorised behind their HTTPS ports.

What it buys: the chart's etcd group (`etcdNoLeader`, `etcdHighFsyncDurations`,
`etcdMembersDown`, `etcdDatabaseQuotaLowSpace`, …) and the controller-manager and
scheduler rules now evaluate real series. etcd on control planes that also run
every workload — including DRBD replication — is the most likely place for disk
latency to hurt first.

**Order of operations:** the Talos change must be live *before* this values change
reconciles, or `KubeControllerManagerDown`, `KubeSchedulerDown` and `etcdMembersDown`
fire until it is. controller-manager and scheduler pick it up without a reboot; **etcd
only after a node reboot** — Talos does not restart etcd on an `extraArgs` change. The
procedure used is in `bootstraping/README.md` ("The control-plane metrics patch").

**`KubeHpaMaxedOut` is replaced, not dropped.** The chart's rule is
`current == max`, with no test for whether the HPA can scale at all. All three
FlareSolverr HPAs are `minReplicas: 1` / `maxReplicas: 1` by design — FlareSolverr
keeps sessions in per-pod memory, so a second replica is a correctness bug — which
made `current == max` their permanent healthy state and the alert fire on all
three continuously. It was misleading, not merely noisy: three "maxed out" HPAs
read as saturation while the one autoscaler that can scale
(`keda-hpa-engine-worker`, max 6) sat idle at 1. `hpa-maxedout-rule.yaml` restates
the shipped rule verbatim — expression, `for:`, severity, annotations, runbook —
plus one clause, `and (spec_max_replicas > spec_min_replicas)`. The disable in
`release.yaml` and the replacement must move together, or the cluster ends up with
neither.

**kube-state-metrics has requests and no memory limit.** It declared neither and
ran BestEffort — the first class the kubelet evicts under memory pressure — on a
node at 193% memory-limit overcommit. Nearly every alert here derives from it, and
each restart recreates every derived alert with a fresh `activeAt`: the pod went
from 18 to 37 restarts between 29 July and 7 August 2026. This is not a proven fix
for those restarts (the last one was exit 2 with no OOMKill signature), but
BestEffort is indefensible for it either way. No memory limit, because its memory
scales with the number of cluster objects and a fixed ceiling turns growth into an
OOMKill loop in the component needed to see it. Measured 27Mi / 3m; 128Mi is ~5×
headroom.

## Upgrade 66.2.2 → 91.2.1 (2026-09)

Twenty-five chart majors in one step, done in isolation so that a failed reconcile
points at the chart and nothing else. What moved:

| Component | Before | After |
|---|---|---|
| prometheus-operator (and the CRDs) | v0.78.2 | v0.94.0 |
| Prometheus | v2.55.1 | v3.14.0, distroless |
| Alertmanager | v0.27.0 | v0.34.0 |
| Grafana (subchart) | 11.3.1, `grafana/grafana` 8.6.1 | 13.2.1 distroless, `grafana-community/grafana` 13.2.4 |
| node-exporter | v1.8.2 | v1.12.1, distroless |
| kube-state-metrics | v2.14.0 | v2.20.0 |

Checked before merging, and what to re-check on the next major:

- **Every `PrometheusRule` in the repository parses under Prometheus 3**
  (`promtool check rules --lint=all`, promtool 3.14.0). No rule matches on
  `le="…"`, whose float formatting changed in 3.0.
- **Prometheus 3 fails a scrape whose `Content-Type` is missing or invalid**
  instead of guessing. Every custom target sent a valid `text/plain; version=0.0.4`
  header except `ai-gateway`, which needs basic auth and was checked after the
  rollout instead.
- **The Grafana subchart now comes from `grafana-community`,** but it is vendored
  inside the kube-prometheus-stack package, so `repository.yaml` is unchanged.
  Grafana 13 runs with `readOnlyRootFilesystem: true`; `GF_INSTALL_PLUGINS` and
  `GF_*__FILE` no longer work. Grafana 12 removed Angular panels; the only
  repository dashboards (`fbref-grafana`) use none.
- **CRDs still ship inside the chart** (`charts/crds`), so Flux's
  `install.crds: Create` / `upgrade.crds: CreateReplace` remains the mechanism.
- **Chart 90 moved control-plane scrape auth to a Secret.** The chart now creates
  a long-lived `<prometheus-sa>-token` Secret and the `bearerTokenFile`,
  `insecureSkipVerify` and etcd-certificate values are gone. None were set here.
- **The values in `release.yaml` render unchanged** on 91.2.1 (`helm template
  --kube-version 1.36.1`), and each block was confirmed to land: node-exporter
  security context, kube-state-metrics requests, Grafana `Recreate`, `ssd` PVCs,
  the Alertmanager Secret mount, the host-less tailnet Ingress, and
  `KubeHpaMaxedOut` absent from the default rules.

## Grafana, on the tailnet

**`https://grafana.<your-tailnet>.ts.net`** — HTTPS on 443 with a MagicDNS
certificate, authenticated by tailnet identity before Grafana's own login even
appears. Not on the LAN, not on the internet.

It replaced an `Ingress` that had not worked since k3s was retired:
`ingressClassName: traefik` on `grafana-k3s.eliorion.fr`, naming a controller
this cluster no longer runs. The object existed, applied cleanly and routed
nothing, so the documented way in was `kubectl port-forward`.

**The Ingress is chart-generated, not hand-written.** `grafana.ingress` in
`release.yaml` is the whole of it — no separate `ingress-tailscale.yaml` like the
six other tailnet services in this repo, because the chart already renders the
object and a second one would register a second device contending for the same
hostname. For the same reason the Grafana `Service` must never grow
`tailscale.com/*` annotations: that is the other exposure mechanism, and running
both silently suffixes the loser `grafana-1`.

Two properties of the rendered object are load-bearing:

- **`hosts: []`**, so the chart emits a rule with no `host`. The Tailscale proxy
  forwards the original Host (`grafana.<tailnet>.ts.net`), which would never
  match `rules[0].host: grafana`.
- **no `secretName` under `tls`**, because the proxy holds the certificate.
  `tls.hosts[0]` is read as the device name, not as a matcher.

**Precondition:** HTTPS Certificates must be enabled in the Tailscale admin
console (DNS → HTTPS Certificates), or the proxy comes up with no certificate.
The same precondition every other tailnet service here carries.

**Known cosmetic limitation.** Grafana's `root_url` is not set anywhere, so it
keeps the chart default `http://localhost:3000/`. Navigation and login are
unaffected — Grafana serves those from relative paths — but a copied share link
will read `localhost:3000`. The fix, if it ever matters, is
`grafana.grafana.ini.server.root_url` in the **staging overlay**, not here: the
value contains the tailnet name, and `base/` stays environment-independent.

Deleting the old ingress orphaned `grafana-tls-secret`, whose SOPS file and
directory (`monitoring/configs/staging/kube-prometheus-stack/`) went with it.

## Traps

- **The overlay's Flux Kustomization must keep its `decryption` block.**
  `grafana-admin.enc.yaml` is the first SOPS Secret on this path. Without
  `decryption` Flux applies the manifest verbatim, the Secret's values become
  the literal `ENC[AES256_GCM,...]` string, and *nothing fails at apply time* —
  Grafana simply refuses the admin login with no error anywhere in the chain.
  The block is in `clusters/staging/monitoring.yaml` and
  `clusters/production/monitoring.yaml`.
- **`install.crds: Create` and `upgrade.crds: CreateReplace` are what put the
  monitoring CRDs in the cluster and keep them in step with the chart.** Flux
  does not update CRDs on upgrade unless told to. Every `PodMonitor`,
  `ServiceMonitor` and `PrometheusRule` in `monitoring/configs/staging/` and in
  the other tiers depends on this release having created them.
- **Every `PodMonitor`, `ServiceMonitor` and `PrometheusRule` must carry the
  label `release: kube-prometheus-stack`.** The chart's default
  `podMonitorSelector` / `serviceMonitorSelector` / `ruleSelector` match on it,
  and the value is the Helm release name, which is this `HelmRelease`'s
  `metadata.name`. An object without the label is silently ignored: no scrape,
  no rule, no error. Renaming the `HelmRelease` would orphan every existing
  monitor in the repository.
- **`chat_id: -5295319950` is numeric and unquoted.** Telegram group ids are
  negative; quoting it or losing the sign breaks delivery. The same id appears
  as a quoted string in `monitoring/configs/staging/flux-alerts/provider.yaml`,
  where the Flux notification-controller wants a string `channel`. The two paths
  are independent and nothing keeps them in sync.
- **The mount path in `bot_token_file` is derived from the Secret name.**
  `alertmanagerSpec.secrets: [alertmanager-telegram]` mounts at
  `/etc/alertmanager/secrets/alertmanager-telegram/`; renaming the Secret means
  editing both the `secrets` list and `bot_token_file`.
- **The Secret `alertmanager-telegram` is applied by the *other* Kustomization.**
  It lives in `monitoring/configs/staging/flux-am/`, and `monitoring-configs`
  has no `dependsOn` on `monitoring-controllers`. A cold bootstrap can therefore
  leave the Alertmanager pod stuck mounting a Secret that does not exist yet; it
  resolves itself once `monitoring-configs` reconciles.
- **`grafana.ingress.hosts` must stay empty.** Put a host there and the chart
  renders `rules[0].host: grafana`, which never matches the
  `grafana.<tailnet>.ts.net` Host the Tailscale proxy forwards — every request
  404s while the Ingress, the device and the certificate all look healthy. Empty
  renders a host-less rule, which matches any Host. The tailnet name belongs in
  `tls.hosts`, and only there.
- **The chart version is pinned and Renovate bumps it.** `91.2.1` here. A major
  bump of this chart moves the bundled Prometheus, Alertmanager and Grafana
  versions and can change the CRD schemas that the rest of the repository is
  written against.

## Operating it

Render and reconcile checks:

```sh
kubectl kustomize monitoring/controllers/staging
flux get kustomizations
flux get helmreleases -n monitoring
```

The workloads are all in `monitoring`:

```sh
kubectl -n monitoring get pods
kubectl -n monitoring logs alertmanager-kube-prometheus-stack-alertmanager-0
```

List the applied objects, then check what Prometheus actually loaded. The
`kubectl get` list shows a rule or monitor whether or not the `release` label
got it selected; the Prometheus UI behind the port-forward (Status → Rules,
Status → Targets) is where a missing label shows up as an absence:

```sh
kubectl -n monitoring get prometheusrule,podmonitor,servicemonitor
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090
```

Grafana is at **`https://grafana.<your-tailnet>.ts.net`**. Credentials are the
decrypted contents of the overlay's `grafana-admin.enc.yaml` (`admin-user` /
`admin-password`).

Break-glass, if the Tailscale proxy is the thing that is broken:

```sh
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```

Deeper detail:
[monitoring/configs/README.md](../../../configs/README.md) (the rules,
monitors and Telegram wiring that consume this stack),
[05-alerting.md](../../../../documentations/05-alerting.md) (both Telegram
paths, the PodMonitor/PrometheusRule contract, one-time bot setup and
troubleshooting),
[14-design-decisions.md](../../../../documentations/14-design-decisions.md)
(the observability choices above and what they cost),
[12-garage-object-storage.md](../../../../documentations/12-garage-object-storage.md)
(the outage that produced the hand-written CNPG PodMonitor).
