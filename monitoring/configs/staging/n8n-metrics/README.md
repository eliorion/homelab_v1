# n8n-metrics — scrape and alerts for the n8n automation host

## What it is

The monitoring half of n8n, the cluster's automation host
([`../../../../documentations/10-n8n-automation.md`](../../../../documentations/10-n8n-automation.md)).
A `ServiceMonitor` that puts n8n's `/metrics` into Prometheus, and a
`PrometheusRule` with exactly two alerts.

The alert set is deliberately narrow. Per-workflow failures are **not** alerted
on: they surface as failed executions inside n8n's own Executions view. What
this directory covers is the one gap that view cannot — n8n itself being down or
unscraped, which silences everything else.

Everything else about n8n (Deployment, Service, PVC, Tailscale Ingress, CNPG
`n8n-db`) lives under
[`../../../../apps/base/n8n/`](../../../../apps/base/n8n/) and
[`../../../../apps/staging/n8n/`](../../../../apps/staging/n8n/).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the two objects below. No namespace transformer — each object names `monitoring` itself. |
| `servicemonitor.yaml` | `ServiceMonitor` `n8n` in ns `monitoring`; `namespaceSelector.matchNames: [n8n]`, `selector.matchLabels: app: n8n`, endpoint port `http`, path `/metrics`, `interval: 60s`. |
| `prometheusrule.yaml` | `PrometheusRule` `n8n` in ns `monitoring`, group `n8n.rules`, the two alerts below. |

| Alert | Expression | `for` | Severity |
|---|---|---|---|
| `N8nDown` | `up{job="n8n"} == 0` | 10m | critical |
| `N8nMetricsMissing` | `absent(up{job="n8n"}) == 1` | 30m | warning |

Both objects carry `release: kube-prometheus-stack` — see "The label that ties
everything together" in [`../../README.md`](../../README.md).

The scrape chain, end to end:

1. `N8N_METRICS: "true"` in the `n8n-config` ConfigMap
   (`../../../../apps/staging/n8n/configmap.yaml`) makes n8n serve `/metrics`.
2. `../../../../apps/base/n8n/service.yaml` is the Service `n8n` in ns `n8n`,
   port name `http` (5678), carrying the label `app: n8n` on the **Service**.
3. This `ServiceMonitor` selects that Service by label and scrapes its `http`
   port every 60s.
4. Prometheus derives the target's `job` label from the Service name, so the
   series is `up{job="n8n"}` — the string both alert expressions hard-code.

Delivery is the shared path: Alertmanager routes to the `telegram` receiver
defined in the chart values
([`../../../controllers/base/kube-prometheus-stack/release.yaml`](../../../controllers/base/kube-prometheus-stack/release.yaml)),
described in the `flux-am` section of [`../../README.md`](../../README.md).
Nothing n8n-specific exists in the receiver.

Flux applies this directory through the `monitoring-configs` Kustomization
([`../../../../clusters/staging/monitoring.yaml`](../../../../clusters/staging/monitoring.yaml),
`path: ./monitoring/configs/staging`, `prune: true`), via the resource list in
`../kustomization.yaml`.

## Why it is like this

**`N8nDown` is the one alert that has to be a push.** Every other failure in
this stack surfaces as a failed execution in n8n's Executions view — which only
works while n8n is up. If it is down, nothing tells you and every scheduled
workflow silently stops firing. n8n's database is also the only copy of every
workflow, so a long silent outage is not a cosmetic problem.

**`N8nMetricsMissing` covers what `up == 0` structurally cannot.** `up{job="n8n"}
== 0` needs a target to exist. If the ServiceMonitor stops matching — the
Service relabelled, the `app: n8n` label dropped, the namespace renamed — the
target vanishes and the series disappears entirely instead of going to 0, so
`N8nDown` can never fire again. `absent()` is true precisely in that case.

**`for: 30m` on the absent rule, against `10m` on the down rule.** `absent()`
returns 1 whenever the series does not exist, including from the moment
Prometheus starts until n8n's first successful scrape. The 30-minute `for` is
what keeps a cold bootstrap quiet: a cluster that brings n8n up inside half an
hour never trips it. A cluster where n8n never comes up *does* page — the
opposite of `EtcdBackupStale` next door, which by design cannot fire before its
first successful run.

**Severity split.** `N8nDown` is `critical` (automations are stopped);
`N8nMetricsMissing` is `warning` (n8n may be running perfectly while monitoring
is blind).

## Traps

- **`release: kube-prometheus-stack` on both objects.** Drop or misspell it and
  the object applies successfully, shows up in `kubectl get`, and is silently
  ignored by Prometheus' `serviceMonitorSelector` / `ruleSelector`. The one-line
  comment on each label exists to stop that.
- **The ServiceMonitor selects on SERVICE labels, not on `spec.selector`.** The
  `app: n8n` label on `../../../../apps/base/n8n/service.yaml` metadata is there
  for this file alone; removing it as "redundant" (the Service's own pod
  selector already uses it) produces no scrape and no error.
- **`job="n8n"` is the Service name, hard-coded in both expressions.** Rename
  the Service and both alerts evaluate to nothing forever — which looks exactly
  like a healthy n8n.
- **Port name `http` is a contract with the Service.** A `ServiceMonitor`
  naming a port that does not exist produces no scrape and no error.
- **`namespaceSelector.matchNames: [n8n]` hard-codes the namespace.** Moving n8n
  elsewhere silently ends the scrape.
- **Turning `N8N_METRICS` off does not silence monitoring.** The endpoint stops
  answering, the scrape fails, `up` goes to 0 and `N8nDown` pages within 10
  minutes. Removing the alerting means removing these objects, not the metrics
  flag.
- **`interval: 60s` sets the resolution of both alerts.** Lengthening it past
  the `for` windows makes them unreliable.

## Operating it

```bash
# Render check before commit
kubectl kustomize monitoring/configs/staging

# The objects exist and Prometheus accepted them
kubectl -n monitoring get servicemonitor n8n
kubectl -n monitoring get prometheusrule n8n

# The series exists — empty here is exactly what N8nMetricsMissing is for
kubectl -n monitoring exec sts/prometheus-kube-prometheus-stack-prometheus -c prometheus -- \
  promtool query instant http://localhost:9090 'up{job="n8n"}'

# What n8n is actually exporting
kubectl -n n8n port-forward svc/n8n 5678:5678 &
curl -s localhost:5678/metrics | head
```

When `N8nDown` fires:

```bash
kubectl -n n8n get pods
kubectl -n n8n logs deploy/n8n
kubectl -n n8n get cluster n8n-db     # CNPG first: n8n cannot start without it
```

## Overlays

`staging/` only. There is no `base/` and no `production/` for this directory,
and `clusters/production/` deploys no monitoring-configs Kustomization at all,
so the namespace matcher, the `job` name and the thresholds are hard-coded here.
There are no Secrets in this directory, so it does not depend on the
Kustomization's `decryption` block.
