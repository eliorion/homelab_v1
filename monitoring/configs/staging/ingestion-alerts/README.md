# ingestion-alerts

Alerts on the two independent pause switches that stop the asp scraping
pipeline, and on the end-to-end result of both.

This component exists because of a five-day silent outage: asp ingestion stopped
on 2026-08-08 at 19:27 and nothing alerted until it was found by hand on
2026-08-13. Every individual component was healthy the whole time — pods
Running, HelmReleases Ready, no alert firing. The pipeline was simply switched
off, and the switches were invisible.

## The two switches

They live in different databases and are **both** required to be clear for work
to flow. Nothing ever clears either one, so resume is manual in both cases — but
since 2026-08-28 they are no longer thrown by the same kind of thing. Only the
platform switch is automatic; the tenant switch is an operator's button.

| Switch | Database | Table | Set by | Stops |
|---|---|---|---|---|
| tenant | `automarket` (asp) | `worker_control` row `id = 1` | **an operator only** — admin-ui `POST /api/scraping/pause` / `/api/crawler/pause` | asp **submitting** work |
| platform | `scraper` | `domain_control` per (site, role) | the scraper platform, automatically, on block rate | the platform **serving** that site |

**asp no longer has an auto-pause.** Its inline monitor used to run error-rate
and `blocked:`-rate breakers over `scrape_queue` and write the tenant flag
itself. Those were deleted: asp only ever saw a block second-hand, reduced to a
ratio, and its flag was global and one-way across sites that fail independently
— five autoscout24 failures beside thirteen leboncoin successes read as one
pooled 27.8% and stopped healthy leboncoin for thirteen days. Judging a block
belongs beside the fetch, on the platform, which is where the surviving
automatic breaker (`domain_control`) and the anti-bot escalation ladder already
live. The consequence for these alerts: a firing `AspIngestionPaused` or
`AspSearchingPaused` now always means **a human paused it and did not resume**,
never that the pipeline stopped itself.

In the incident both fired, four minutes apart, from the same DataDome event —
`19:23:17` platform (`block rate 14.3%`), `19:27:30` tenant (`error rate
31.3%`). Only the tenant one was known, and resuming it alone would not have
helped: it would have queued 157k more URLs behind a platform still refusing to
serve them. That second, tenant-side breaker no longer exists (see above), so
this exact double-fire cannot recur — but the platform half still can, and the
tenant flag can still be left set by hand.

The platform switch is the more damaging of the two, and its blast radius is
much wider than "this site pauses":

- All three KEDA scale triggers on `engine-worker` carry
  `AND NOT EXISTS (... dc.role = 'server' AND dc.paused)`. A paused site's lanes
  stop counting as hot, so the HPA under-counts and **the fleet does not scale**.
  During the incident it read `3/4` and sat at 1 replica; clearing the pause took
  it to `6/6` within minutes.
- The same predicate gates leasing, so those lanes are never leased. 43 requests
  sat `pending` for five days with their cooldowns expired days earlier.
- With zero fetches there are zero blocks, so the anti-bot ladder never
  re-probes and never escalates. The escalation from `camoufox_warm` to
  `flaresolverr` did not fail — **it was unreachable**. On resume the lanes went
  warm at `backoff_level 0` and 31 of 32 fetches succeeded, which is what the
  ladder would have found on day one had it been able to run.

That last point is why `ScraperSiteServingPaused` spells the mechanism out in
its description. The natural read of "site paused" is "one site is idle"; the
actual behaviour is a fleet-wide scaling freeze and a frozen anti-bot ladder.

## Where the metrics come from

Neither flag was in Prometheus at all — there is no SQL exporter on this
cluster, and that absence, not a missing rule, is why no alert was possible.

Rather than deploy one, both queries ride the CNPG metrics exporter that already
runs in every database pod and already reaches Prometheus through the
`cnpg-instances` PodMonitor. The cost is one `customQueriesConfigMap` entry per
cluster and no new workload.

| Metric | From |
|---|---|
| `cnpg_asp_ingestion_scraping_paused` | `apps/staging/databases/asp/ingestion-metrics-configmap.yaml` |
| `cnpg_asp_ingestion_searching_paused` | same |
| `cnpg_asp_ingestion_seconds_since_last_listing` | same |
| `cnpg_scraper_serving_paused{site,role}` | `apps/staging/databases/scraper/serving-metrics-configmap.yaml` |
| `cnpg_scraper_serving_pending{site,role}` | same |

Both are attached by a `cluster-metrics-patch.yaml` in the same directory.

## Why it is like this

**Both queries are `primary: true`.** They read cluster-wide application state,
not per-instance state, so running them on replicas would emit duplicate series
that differ only by pod. The alert expressions still wrap everything in `max()`,
so a future topology change cannot turn one paused site into three firing
alerts.

**`ScraperSiteServingPaused` requires `pending > 0`.** `e2e-live-check` is
parked `paused=t` deliberately and permanently. Alerting on the pause flag alone
would fire on it forever, and this repo already has a documented problem with
permanently-firing alerts training the operator to ignore the Telegram channel
(see the `kubeProxy`/`kubeControllerManager` note in
`monitoring/controllers/base/kube-prometheus-stack/release.yaml`). Gating on a
real backlog encodes the actual failure — *work is queued and nothing will serve
it* — instead of the mere presence of a switch. The rejected alternative was
filtering site names in the query, which would have hardcoded a test fixture's
name into a production metric.

**`AspNoNewListings` does not reference either flag.** It is the backstop: it
fires on the outcome regardless of cause, so a stall that neither pause explains
— platform outage, StallBreaker, DB trouble — is still caught. It is the only
`critical` here because it is the only one that means data is actually being
lost; a pause with a short backlog is recoverable at leisure.

**6h, and `for: 15m`.** Recurring searches run on a 2h default interval, so 6h
is three missed cycles — comfortably past normal quiet periods without waiting a
whole day. The 30m `for:` on the pause alerts is deliberately longer than any
legitimate operator pause-and-fix window.

**`-1` for an empty `listings` table.** `max(scraped_at)` over no rows is NULL,
and a NULL would drop the series entirely, making the alert inert exactly when
the pipeline has never worked. `-1` keeps the series present and safely below
the threshold.

## Traps

- **The rules and the metrics ship in two different tiers.** These rules are in
  `monitoring/configs/staging/`; the queries that produce their metrics are in
  `apps/staging/databases/{asp,scraper}/`. Removing or renaming a query silently
  makes rules here inert — no error, no `absent()` guard, just an alert that can
  never fire. Change both together.
- **The Cluster patches must restate `cnpg-default-monitoring`.** A strategic
  merge on a CRD list replaces it rather than appending. Dropping that first
  entry removes every default CNPG metric — replication lag, backends,
  checkpointer — cluster-wide.
- **`target_databases` is not optional here.** It defaults to `postgres`, where
  neither `worker_control` nor `domain_control` exists. Wrong value means the
  query errors on every scrape and the metric never appears.
- **Resume order is platform first, then tenant.** Clearing the tenant flag
  first lets asp submit into lanes nothing will serve, growing the backlog
  behind a closed door.
- **`worker_control` has more than one row and only `id = 1` is real.** Both the
  asp engine and the admin BFF read `WHERE id = 1`. Aggregating over the table
  would read an inert row from 2026-06-05 and report the wrong state.

## Operating it

```sh
kubectl kustomize monitoring/configs/staging/ingestion-alerts

# metrics present? (empty result = the CNPG half did not land)
kubectl -n monitoring exec prometheus-kube-prometheus-stack-prometheus-0 -c prometheus \
  -- wget -qO- 'http://localhost:9090/api/v1/query?query=cnpg_scraper_serving_paused'
```

Resuming, platform first:

```sh
kubectl -n scraper exec deploy/scraper-backend -- python -c \
  "import urllib.request as u; \
   print(u.urlopen(u.Request('http://localhost:8080/v1/control/asp/leboncoin/server/resume', \
   method='POST', data=b'')).read())"

kubectl -n asp exec deploy/admin-ui -- node -e \
  "require('http').request({host:'localhost',port:8080,path:'/api/scraping/resume', \
   method:'POST',headers:{'Content-Type':'application/json'}},r=>r.pipe(process.stdout)).end('{}')"
```

Neither surface has authentication and neither has an ingress; both are reached
in-cluster or by port-forward only.
