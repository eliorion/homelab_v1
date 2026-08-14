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
| `kustomization.yaml` | Lists `namespace.yaml`, `repository.yaml`, `release.yaml`. |
| `namespace.yaml` | Namespace `monitoring`, carrying `pod-security.kubernetes.io/enforce`, `/audit` and `/warn` all set to `privileged`. |
| `repository.yaml` | `HelmRepository/kube-prometheus-stack` in namespace `monitoring`, `https://prometheus-community.github.io/helm-charts`, `interval: 24h`. |
| `release.yaml` | `HelmRelease/kube-prometheus-stack` in namespace `monitoring`, chart `kube-prometheus-stack` pinned to `66.2.2`, `interval: 30m` with a `12h` chart interval, `install.crds: Create`, `upgrade.crds: CreateReplace`, drift detection enabled, plus the values described below. |

The `HelmRelease` sets no `targetNamespace` and no `releaseName`: the object,
the Helm release and every workload it creates all land in `monitoring`.

Values in `release.yaml`, block by block:

- **`grafana.admin`** — `existingSecret: grafana-admin`, `userKey: admin-user`,
  `passwordKey: admin-password`. The Secret itself is not in `base/`; each
  overlay supplies its own `grafana-admin.enc.yaml`.
- **`grafana.ingress`** — enabled, `ingressClassName: traefik`, host
  `grafana-k3s.eliorion.fr`, TLS from secret `grafana-tls-secret`. That Secret
  is created by `monitoring/configs/staging/kube-prometheus-stack/grafana-tls-secret.enc.yaml`,
  which belongs to the other Flux Kustomization.
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

Flux side. `clusters/staging/monitoring.yaml` and
`clusters/production/monitoring.yaml` declare a `monitoring-controllers`
Kustomization (`path: ./monitoring/controllers/<env>`, `interval: 1m0s`,
`retryInterval: 1m`, `timeout: 5m`, `prune: true`) with a `decryption` block
pointing at the `sops-age` Secret. Staging additionally declares
`monitoring-configs` (`path: ./monitoring/configs/staging`), also with
decryption. Neither has a `dependsOn`, so both reconcile straight off the root
Kustomization with no ordering relative to each other or to the infrastructure
tiers.

### Overlays

- **staging** — `monitoring/controllers/staging/kube-prometheus-stack/kustomization.yaml`
  sets `namespace: monitoring` and pulls in `../../base/kube-prometheus-stack/`
  plus `grafana-admin.enc.yaml`. No patches; the base values apply as written.
  It is referenced from `monitoring/controllers/staging/kustomization.yaml`.
- **production** — the same two resources, plus one JSON 6902 patch on the
  `HelmRelease` that replaces `/spec/values/grafana/ingress/enabled` with
  `false`. The reason is that `monitoring/configs/production/` does not exist
  and `clusters/production/monitoring.yaml` declares no `monitoring-configs`
  Kustomization, so `grafana-tls-secret` is never created there and the ingress
  would reference a Secret that cannot appear. The production
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

### Four control-plane scrape jobs off, and etcd back on

`kubeProxy`, `kubeControllerManager` and `kubeScheduler` are disabled because
they cannot exist here. Talos binds the controller-manager and the scheduler to
`127.0.0.1`, and Cilium runs `kubeProxyReplacement: true` with
`cluster.proxy.disabled: true`, so there is no kube-proxy DaemonSet at all. The
chart still creates a Service and ServiceMonitor for each, each scrapes nothing
forever, and that held `KubeProxyDown`, `KubeControllerManagerDown` and
`KubeSchedulerDown` permanently firing at `severity: critical` — three of the
cluster's six firing criticals — plus two `TargetDown` warnings. Turning them off
removes no coverage, because there was never any data behind them.

**`kubeEtcd` was disabled for the same reason and has been turned back on**,
which is a reversal of an earlier decision rather than a new one. The note it
replaced argued that scraping etcd meant "publishing unauthenticated plaintext
etcd metrics onto a subnet that also carries the LB-IPAM pool and the Tailscale
gateway", and deferred it "until that trade is made deliberately in its own
change window". This is that window. The blind spot turned out to cost more than
the exposure.

**What it cost.** On 2026-08-12 the apiserver logged `etcdserver: no leader` at
15:40, 15:43, 18:29 and 18:48. Over six hours that produced:

| | |
|---|---|
| apiserver 504 terminations | 256 |
| 500s on `postgresql.cnpg.io/clusters` | 193 |
| 500s / 504s on `leases` | 38 / 36 |
| lease PUTs over 1s | 245 of 135,729 |

Every controller-runtime operator lost its leader-election lease, and a
controller that loses its lease **exits** — `plugin-barman-cloud` carries 109
restarts, `source-controller` 11, `cainjector` 6. Nothing alerted, and nothing
could: no `wal_fsync`, no `backend_commit`, no `leader_changes`, no failed
heartbeats existed. The entire diagnosis had to be rebuilt from apiserver logs
and node-exporter.

The old note also claimed etcd was "not unmonitored in practice", because the
6-hourly `talos-backup` CronJob and `EtcdBackupStale` cover it. **That was
wrong**, and this is the counter-example: those cover *losing recoverable
state*. They say nothing about etcd being unhealthy *while running*, which is
what happened, four times, unseen.

**On the exposure**, which was the real objection and is still true in kind:
`2381` is etcd's dedicated metrics listener. It serves `/metrics` and `/health`
only — no key material, no read or write path into the keyspace — and the client
port keeps its mTLS on `2379`. What lands on the subnet is operational
telemetry, not data. That is a materially smaller exposure than the original
note implied, and it buys back visibility of the whole storage layer.

Re-enabling the job also restores all 15 rules in the chart's etcd group, which
the chart gates on `kubeEtcd.enabled`.

`monitoring/configs/staging/control-plane-alerts/` is the complement, and stays
regardless: it detects the same condition from **apiserver** metrics, so the
coverage survives this etcd target being broken, misconfigured, or disabled
again — which is exactly the state that kept the problem silent.

## Traps

- **`kubeEtcd: true` depends on a Talos change Flux does not apply.** The scrape
  targets port `2381`, which only exists once
  `cluster.etcd.extraArgs.listen-metrics-urls` in `bootstraping/talconfig.yaml`
  has been rendered with `talhelper genconfig` and pushed to all three nodes with
  `talosctl apply-config`. Nothing in this repository can do that for you, and
  nothing detects the mismatch in advance — the symptom is every etcd target
  down and `KubeEtcdDown` firing.
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
- **`ingressClassName: traefik` names a controller this cluster no longer
  runs.** Traefik was retired with k3s; L7 ingress is now Cilium Gateway API.
  The Grafana `Ingress` object is created in staging and is inert. It is one of
  the three stale `traefik` references tracked in
  [14-design-decisions.md](../../../../documentations/14-design-decisions.md)
  and [08-cilium-cni-ingress-migration.md](../../../../documentations/08-cilium-cni-ingress-migration.md).
- **The chart version is pinned and Renovate bumps it.** `66.2.2` here. A major
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

Reach Grafana without the inert ingress:

```sh
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```

The admin credentials are the decrypted contents of the overlay's
`grafana-admin.enc.yaml` (`admin-user` / `admin-password`).

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
