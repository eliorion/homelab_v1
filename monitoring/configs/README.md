# monitoring/configs — alert rules and notification wiring

`monitoring/controllers/` installs the `kube-prometheus-stack` HelmRelease.
`monitoring/configs/` holds everything that *uses* it: the scrape definitions
(`PodMonitor` / `ServiceMonitor`), the alert rules (`PrometheusRule`) and the
delivery path to Telegram.

There is a single overlay, `monitoring/configs/staging/`, applied by the Flux
Kustomization `monitoring-configs`
([`../../clusters/staging/monitoring.yaml`](../../clusters/staging/monitoring.yaml),
`path: ./monitoring/configs/staging`, `prune: true`, with a `decryption` block
because several `*.enc.yaml` Secrets live here). There is no `base/` and no
`production/` counterpart — `clusters/production/` does not deploy this tier —
so every directory below is referenced directly from
`monitoring/configs/staging/kustomization.yaml`.

This README documents the four alerting directories:

| Directory | What it adds |
|---|---|
| `staging/flux-alerts/` | Flux notification-controller → Telegram (event path) |
| `staging/flux-am/` | Flux metrics → Prometheus → Alertmanager → Telegram (metric path) |
| `staging/etcd-backup-alerts/` | Alerts on the `etcd-backup` CronJob |
| `staging/cnpg-alerts/` | CNPG scrape + WAL-archiving and volume alerts |

The other siblings are outside the scope of this file. `fbref-grafana/`
(dashboards + datasource) and `n8n-metrics/` are not alerting at all. The
component-specific alert directories
— `longhorn-monitoring/`, `ceph-monitoring/`, `node-capacity-alerts/`,
`control-plane-alerts/`, `ingestion-alerts/` — follow the same wiring as the four
above and document themselves **inline**: their `PrometheusRule` files carry the
metric-encoding notes and the reasoning behind each threshold and `for:`, because
that is where someone editing an expression will actually be looking.

## The label that ties everything together

Every `PodMonitor`, `ServiceMonitor` and `PrometheusRule` in this tree carries:

```yaml
labels:
  release: kube-prometheus-stack
```

The chart's default `podMonitorSelector` / `serviceMonitorSelector` /
`ruleSelector` match on `release: <helm release name>`, and the HelmRelease is
named `kube-prometheus-stack` in namespace `monitoring`
([`../controllers/base/kube-prometheus-stack/release.yaml`](../controllers/base/kube-prometheus-stack/release.yaml)).
Drop or misspell that label and the object is applied successfully, shows up in
`kubectl get`, and is silently ignored by Prometheus. There is no error
anywhere. The one-line comment on each of those labels exists to stop that.

All four directories put their objects in namespace `monitoring` (except the
Flux `Provider`/`Alert`/token, which must live in `flux-system` next to the
controller that reads them).

---

## flux-alerts — notification-controller → Telegram

### What it is

The event path of the two Telegram delivery routes. Flux's
notification-controller forwards its own `error` events to a Telegram chat. The
message carries the Helm error text (`upgrade failed: timed out waiting…`), so
it is the one worth reading while debugging. Full background, including the
one-time bot/chat-id setup, is in
[`../../documentations/05-alerting.md`](../../documentations/05-alerting.md).

### How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the three objects below. No namespace transformer — each object names `flux-system` itself. |
| `provider.yaml` | `notification.toolkit.fluxcd.io/v1beta3` `Provider` `telegram`, `type: telegram`, `channel: "-5295319950"`, `secretRef.name: telegram-bot-token`. |
| `alert.yaml` | `Alert` `helm-failures`, `providerRef: telegram`, `eventSeverity: error`. |
| `telegram-token.enc.yaml` | SOPS-encrypted Secret `telegram-bot-token` in `flux-system`, key `token`. Never open or edit it by hand — `sops -e -i` only. |

`alert.yaml` subscribes to four event sources: `HelmRelease` `*` in
`flux-system`, in `asp` and in `monitoring`, plus `Kustomization` `*` in
`flux-system`. A HelmRelease in any other namespace produces no Telegram
message on this path.

### Why it is like this

Two delivery paths exist on purpose and they are complementary, not redundant.
This one is instant and carries the real error string but has no history, no
grouping and no silences. `flux-am` below is the opposite. Both end in the same
Telegram group. WhatsApp was rejected: neither Flux nor Alertmanager has a
native provider for it, so it would need a Twilio middleman.

### Traps

- **`channel` is a quoted string here and a bare number in the chart values.**
  `Provider.spec.channel` is typed `string`, so `"-5295319950"` must keep its
  quotes; `alertmanager.config…chat_id` in
  [`../controllers/base/kube-prometheus-stack/release.yaml`](../controllers/base/kube-prometheus-stack/release.yaml)
  is typed as a number and must not have them. The comment on the key records
  the sign convention (group ids negative, DM ids positive) because dropping the
  `-` produces a valid-looking id that belongs to someone else.
- **The chat id is duplicated in two files** — `provider.yaml` and the chart
  values. Changing one and not the other silently halves the alerting.
- **`secretRef.name: telegram-bot-token` is a contract with
  `telegram-token.enc.yaml`.** Renaming the Secret makes the Provider fail to
  send with nothing wrong visible on the Alert.
- **The Alert's `eventSources` are an explicit allowlist of namespaces.** New
  workload namespaces are not covered until they are added here.

---

## flux-am — Flux metrics → Alertmanager → Telegram

### What it is

The metric path. Prometheus scrapes the Flux controllers, a `PrometheusRule`
fires when a `HelmRelease` or `Kustomization` has been non-Ready for 5 minutes,
and Alertmanager delivers to the same Telegram group. The message is label-only,
but it comes with Grafana history, grouping, inhibition and silences.

### How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the three objects below. |
| `podmonitor.yaml` | `PodMonitor` `flux-system` in ns `monitoring`; `namespaceSelector.matchNames: [flux-system]`, `selector.matchLabels: app.kubernetes.io/part-of: flux`, endpoint port `http-prom` (8080). Without it Prometheus holds zero `gotk_*` series. |
| `prometheusrule.yaml` | `PrometheusRule` `flux-helmrelease-failed`, group `flux.rules`, alerts `FluxHelmReleaseFailed` and `FluxKustomizationFailed`, both `severity: critical`, both `for: 5m`. |
| `telegram-am-secret.enc.yaml` | SOPS-encrypted Secret in ns `monitoring` holding the same bot token under key `token`. Never open or edit it by hand. |

Both rules evaluate
`max by (exported_namespace, name) (gotk_reconcile_condition{type="Ready", status="False", kind=…}) == 1`.

The receiver end is **not** in this directory. `alertmanagerSpec.secrets:
[alertmanager-telegram]` mounts that Secret at
`/etc/alertmanager/secrets/alertmanager-telegram/token`, and the chart-level
`alertmanager.config` defines the `telegram` receiver
(`bot_token_file` pointing at that path, `parse_mode: HTML`,
`send_resolved: true`) plus a `blackhole` receiver that swallows the
always-firing `Watchdog`. All of that lives in
[`../controllers/base/kube-prometheus-stack/release.yaml`](../controllers/base/kube-prometheus-stack/release.yaml).

### Why it is like this

The receiver is defined through the chart's global `alertmanager.config` rather
than an `AlertmanagerConfig` CRD. The cluster runs the operator's
`matcherStrategy: OnNamespace`, which would force a CRD-defined route to match a
namespace label that a metric-derived alert does not necessarily carry.

Alertmanager reads the token from a mounted file rather than an inline value, so
the token never appears in Git in plaintext. The chat id is inline: low
sensitivity, and duplicating a secret across two encrypted files is worse.

### Traps

- **`exported_namespace`, not `namespace`.** The scrape target already supplies
  a `namespace` label (the Flux pod's own namespace, `flux-system`), so
  Prometheus renames the metric's `namespace` label to `exported_namespace`.
  Rewriting the expression or the annotations to use `namespace` makes every
  alert report `flux-system` regardless of which HelmRelease broke. The
  troubleshooting entry in
  [`../../documentations/05-alerting.md`](../../documentations/05-alerting.md)
  that suggests swapping the label is speculative and inverted; it does not
  describe this rule.
- **Port name `http-prom` is a contract with the Flux controller Deployments.**
  A `PodMonitor` naming a port that does not exist produces no scrape and no
  error.
- **The token exists twice, once per namespace** (`telegram-bot-token` in
  `flux-system`, `alertmanager-telegram` in `monitoring`). Rotating the bot means
  re-encrypting both files.
- **`monitoring-configs` must keep its `decryption` block.** Without it Flux
  applies the Secrets verbatim and their values become the literal
  `ENC[AES256_GCM,…]` string, with no failure at apply time.

---

## etcd-backup-alerts — the etcd snapshot CronJob

### What it is

Two alerts covering
[`../../infrastructure/services/base/etcd-backup/`](../../infrastructure/services/base/etcd-backup/),
the `talos-backup` CronJob that ships an age-encrypted etcd snapshot to Garage
every 6 hours. Recovery procedure:
[`../../documentations/09-etcd-backup-dr.md`](../../documentations/09-etcd-backup-dr.md).

### How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists `prometheusrule.yaml`. |
| `prometheusrule.yaml` | `PrometheusRule` `etcd-backup` in ns `monitoring`, group `etcd-backup.rules`. |

| Alert | Expression | `for` | Severity |
|---|---|---|---|
| `EtcdBackupJobFailed` | `max by (namespace, job_name) (kube_job_status_failed{namespace="etcd-backup"}) > 0` | 5m | critical |
| `EtcdBackupStale` | `time() - max by (namespace, cronjob) (kube_cronjob_status_last_successful_time{namespace="etcd-backup", cronjob="etcd-backup"}) > 32400` | 15m | critical |

Both series come from kube-state-metrics, which ships with
kube-prometheus-stack. Nothing in the backup job itself exports metrics.

### Why it is like this

`EtcdBackupJobFailed` only catches a Job that ran and returned non-zero.
`EtcdBackupStale` is the one that matters: it catches Garage being unreachable,
credentials expiring, and the CronJob being suspended or deleted — none of which
produce a failed Job, and all of which are otherwise completely silent. A backup
system that fails quietly is worse than no backup system, because it is trusted.

`kube_cronjob_status_last_successful_time` is **absent** until the first
successful run, and `time() - absent` yields no series rather than a large
number, so the alert cannot fire on a freshly bootstrapped cluster. That is a
deliberate accepted gap: a cluster that never once backed up is not detected by
this rule.

### Traps

- **`32400` (9 hours) is derived from the CronJob schedule.** The CronJob is
  `schedule: "0 */6 * * *"` — 9h is one missed cycle plus margin. Changing the
  schedule in
  [`../../infrastructure/services/base/etcd-backup/cronjob.yaml`](../../infrastructure/services/base/etcd-backup/cronjob.yaml)
  without changing this threshold either makes the alert unfireable or makes it
  flap.
- **The namespace and cronjob names are hard-coded string matchers**
  (`namespace="etcd-backup"`, `cronjob="etcd-backup"`). Renaming either object
  leaves a rule that evaluates to nothing forever, which looks exactly like a
  healthy backup.

### Operating it

```bash
# Is the rule loaded and does the series exist?
kubectl -n monitoring get prometheusrule etcd-backup
kubectl -n etcd-backup get cronjob etcd-backup

# Force a run rather than waiting 6h
kubectl -n etcd-backup create job --from=cronjob/etcd-backup manual-test-1
kubectl -n etcd-backup logs job/manual-test-1
```

---

## cnpg-alerts — CNPG WAL archiving and volume usage

### What it is

The scrape and the rules that were missing during the 2026-08-10 `ai-gateway`
outage, written up in
[`../../documentations/12-garage-object-storage.md`](../../documentations/12-garage-object-storage.md).
`ai-gateway-db` never archived a single WAL segment from the day it was created;
`pg_wal` grew until the 10Gi volume was 9.94Gi full, CNPG shut the primary down,
the `-rw` Service lost its only endpoint, and the Bifrost gateway crash-looped
for two days. Backup monitoring stayed green throughout — the base backups
really were succeeding — so the archiving failure ran three days unseen. Nothing
watched the archive, and nothing watched the disk.

### How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the two objects below. |
| `podmonitor.yaml` | `PodMonitor` `cnpg-instances` in ns `monitoring`; `namespaceSelector.any: true`, `selector.matchLabels: cnpg.io/podRole: instance`, endpoint port `metrics` (9187, plain HTTP, no auth). |
| `prometheusrule.yaml` | `PrometheusRule` `cnpg-alerts` in ns `monitoring`, groups `cnpg-wal-archiving.rules` and `cnpg-storage.rules`. |

| Alert | Expression | `for` | Severity |
|---|---|---|---|
| `CNPGWALArchivingFailing` | `increase(cnpg_pg_stat_archiver_failed_count[15m]) > 0` | 15m | critical |
| `CNPGWALArchiveBacklog` | `cnpg_collector_pg_wal_archive_status{value="ready"} > 0` | 15m | critical |
| `CNPGVolumeFillingUp` | `kubelet_volume_stats_used_bytes{persistentvolumeclaim=~".+-db-[0-9]+"} / kubelet_volume_stats_capacity_bytes > 0.80` | 30m | warning |
| `CNPGVolumeAlmostFull` | same ratio `> 0.90` | 10m | critical |

The scrape covers every CNPG instance in the cluster: `keycloak-db`,
`asp-db`, `fbref-db`, `scraper-db`, `n8n-db`, `dbtools-db`, `ai-gateway-db`, and
anything added later, with no per-cluster wiring.

### Why it is like this

**One hand-written PodMonitor instead of `enablePodMonitor: true` on each
Cluster.** The Clusters leave `enablePodMonitor` at its default `false`, so
before this file no `cnpg_*` series existed in Prometheus at all. Flipping the
flag would not have been enough: the PodMonitor the CNPG operator generates
carries no `release: kube-prometheus-stack` label and the CRD exposes no field
to add one, so `podMonitorSelector` would drop it anyway. A single PodMonitor
with `namespaceSelector.any: true` is both correct and less wiring.

**No role filter on the archiver rules.** `cnpg_pg_stat_archiver_*` is exported
by primaries only — the collector's queries are primary-scoped — so a replica
simply contributes no series. The series carry `namespace` and `pod`, which is
what the annotations interpolate.

**A failing `archive_command` is an availability problem, not a backup
problem.** Postgres cannot recycle a segment it has not archived, so every
archiving failure is also the disk filling up. That is why both archiving alerts
are `critical` rather than `warning`.

**Two volume thresholds.** CNPG stops the instance on its own low-disk check, so
reaching 100% is a hard outage rather than a degradation: 80% for 30m is the
"look at this" warning, 90% for 10m is the "act now" page.

### Traps

- **`CNPGWALArchiveBacklog` must stay on
  `cnpg_collector_pg_wal_archive_status{value="ready"}`, not on
  `seconds_since_last_archival`.** That was the first attempt and it was wrong:
  `archive_timeout` (300s) forces a segment switch only when there *is* WAL to
  switch, so a quiet database legitimately archives nothing for days. `asp-db`
  sat 47h past its last archive with nothing pending and nothing wrong, which
  the time-since rule reported as an outage while saying nothing about whether
  anything was actually stuck. The `.ready` count is the direct measure: each
  file is a finished segment Postgres may not recycle, so a sustained backlog
  *is* the disk filling up. It covers both failure shapes — never archived at
  all (`ai-gateway-db` was sitting at 119 waiting) and archived fine then
  stopped.
- **`for: 15m` on the backlog rule is load-bearing.** A brief non-zero right
  after a segment switch is normal; shortening this makes the alert flap on
  every healthy database.
- **The PVC regex `.+-db-[0-9]+` encodes CNPG's naming**
  (`<cluster>-<instance-number>`), which is what keeps the volume alerts out of
  every other PVC in the cluster. It only works because every CNPG Cluster in
  this repo is named `*-db`. A Cluster named otherwise gets no volume alerting
  and nothing says so.
- **The `release: kube-prometheus-stack` label on both objects** — see "The
  label that ties everything together" above. This whole directory exists
  because that label was missing from the operator-generated PodMonitor.

### Operating it

```bash
# The scrape works if this returns series, not empty
kubectl -n monitoring exec sts/prometheus-kube-prometheus-stack-prometheus -c prometheus -- \
  promtool query instant http://localhost:9090 'cnpg_collector_pg_wal_archive_status'

# What Postgres itself thinks, from a primary
kubectl -n <ns> exec <cluster>-1 -c postgres -- \
  psql -U postgres -c 'select archived_count, failed_count, last_failed_time from pg_stat_archiver'

# When archiving is failing, the error is in the plugin sidecar
kubectl -n <ns> logs <pod> -c plugin-barman-cloud | grep -i error
```

Resizing a CNPG volume means bumping `storage.size` on the Cluster; Longhorn
expands online.

---

## Overlays

`staging/` is the only directory in this tree: there is no `base/` and no
`production/`, and `clusters/production/` deploys no monitoring-configs
Kustomization. Every manifest here therefore hard-codes its staging values —
chat ids, thresholds, namespace matchers — directly. Adding a second environment
means splitting a `base/` out first.

The `.enc.yaml` files here are matched by the `(^|/)staging/.*\.enc\.ya?ml$`
rule in [`../../.sops.yaml`](../../.sops.yaml), which encrypts only `data` /
`stringData` under the staging age key.

Render check before committing:

```bash
kubectl kustomize monitoring/configs/staging
flux reconcile kustomization monitoring-configs -n flux-system
flux get kustomizations
```
