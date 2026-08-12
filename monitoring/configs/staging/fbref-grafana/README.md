# fbref-grafana — Grafana datasource and dashboards for `fbref-db`

## What it is

A Grafana-only directory: it contains no Prometheus object at all. It ships two
Grafana dashboards and the read-only Postgres datasource they query, as a Secret
and two ConfigMaps in namespace `monitoring`, loaded by the
`kube-prometheus-stack` Grafana sidecars.

Every panel here is SQL against the `fbref-db` CloudNativePG cluster
([`../../../../apps/base/databases/fbref/README.md`](../../../../apps/base/databases/fbref/README.md)).
Nothing is scraped, nothing goes through Prometheus, and nothing here can fire
an alert.

The two dashboards answer two different questions:

| Dashboard | uid | Question |
|---|---|---|
| `fbref overview` | `fbref-overview` | What is in the database, and is the crawl queue healthy? |
| `fbref data trust` | `fbref-audit` | How much of fbref.com is that, and is any of it wrong? |

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | Lists the three objects below. No `namespace:` transformer — the two ConfigMaps name `monitoring` themselves. |
| `datasource.enc.yaml` | SOPS-encrypted Secret carrying the Grafana datasource provisioning for the Postgres datasource with uid `fbref`. Never open or edit it by hand — `sops` only. |
| `dashboard.yaml` | ConfigMap `fbref-grafana-dashboard`, label `grafana_dashboard: "1"`, one key `fbref-overview.json`. |
| `dashboard-audit.yaml` | ConfigMap `fbref-grafana-dashboard-audit`, same label, one key `fbref-audit.json`. |

Flux applies this directory through the `monitoring-configs` Kustomization
([`../../../../clusters/staging/monitoring.yaml`](../../../../clusters/staging/monitoring.yaml),
`path: ./monitoring/configs/staging`, `prune: true`, `decryption.provider:
sops`), via the resource list in `../kustomization.yaml`.

Grafana itself is the chart's, installed by the `kube-prometheus-stack`
HelmRelease (chart `66.2.2`,
[`../../../controllers/base/kube-prometheus-stack/release.yaml`](../../../controllers/base/kube-prometheus-stack/release.yaml),
UI at `https://grafana-k3s.eliorion.fr`). That HelmRelease sets no
`grafana.sidecar` values, so the chart defaults apply: the sidecars watch the
release namespace, `monitoring`, which is why both ConfigMaps must live there
and not in `fbref`.

### `dashboard.yaml` — fbref overview

`schemaVersion: 39`, `time: now-6h`, `refresh: 5m`, one template variable
`$stat` (`SELECT DISTINCT stat_name FROM player_stats ORDER BY 1`,
`refresh: 2`, i.e. re-run on time-range change).

| id | Panel | Reads |
|---|---|---|
| 1 | Clubs | `count(*)` on `clubs` |
| 2 | Players | `count(*)` on `players` |
| 3 | Last scrape | `max(scraped_at)` on `players`, unit `dateTimeFromNow` |
| 4 | Queue by status | `url_queue` grouped by `status` |
| 5 | Failed queue items | `url_queue WHERE status = 'failed'`, 50 rows |
| 6 | Squad sizes | `clubs LEFT JOIN players ON players.current_club_fbref_id = clubs.fbref_id`, top 25 |
| 7 | Leaders — `$stat` | `player_stats JOIN players ON players.fbref_id = player_stats.player_fbref_id` |

### `dashboard-audit.yaml` — fbref data trust

`schemaVersion: 39`, `time: now-90d`, `refresh: 15m`, no template variables.
Every panel reads the `audit` schema, created by fbref migration **V24** in the
asp repo and populated by the `fbref-audit` CronJob. Neither the schema nor the
CronJob is defined in this repository — the CronJob ships with the fbref Helm
chart, owned by the asp repo (`k8s/charts/fbref`, synced by the `fbref`
`GitRepository` in
[`../../../../clusters/staging/sources.yaml`](../../../../clusters/staging/sources.yaml)
and released by
[`../../../../apps/staging/fbref/release.yaml`](../../../../apps/staging/fbref/release.yaml)).

| id | Panel | Reads |
|---|---|---|
| 1 | Last audit | `audit.latest_run.status`, `coalesce(…, 'never')` |
| 2 | Audit ran | `audit.latest_run.finished_at` |
| 3 | Failing checks | `audit.latest_finding WHERE status = 'fail'` |
| 4 | Unevaluated checks | `audit.latest_finding WHERE status = 'unknown'` |
| 5 | Index pages errored | `sum(audit.site_totals.pages_errored)` |
| 6 | How much of fbref.com we hold | `audit.coverage` (`have_pct`, `usable_pct`) |
| 7 | Entity rollup | `audit.summary` |
| 8 | Coverage over time | `audit.finding JOIN audit.run`, `check_name = 'site_coverage_pct'` |
| 9 | Fields missing data | `audit.field_completeness WHERE status <> 'ok'` |
| 10 | What the last audit found wrong | `audit.latest_finding WHERE status <> 'ok'`, 100 rows |
| 11 | Index pages measured | `audit.site_totals` |

Panel 8 is the **only** one that applies `$__timeFilter`. The other ten always
show the latest state regardless of the picker, so the `now-90d` default range
exists for that single panel.

## Why it is like this

**Two ConfigMaps rather than extra panels on one dashboard.** Coverage and
correctness are a different question from content, they are read by different
people at different moments, and the audit dashboard's data can be entirely
absent (no audit run yet) without that saying anything about the overview.

**Panels read `audit.*` views, not the underlying tables.** The expensive
anti-joins are computed once per audit run and stored in `audit.finding`;
`player_stats` is a ~49.5M-row EAV table (26GB on disk per the `fbref-db`
README) and a dashboard on a 15-minute refresh must never scan it. The one
deliberate exception is panel 9, whose own description marks
`audit.field_completeness` as live rather than cached.

**Status is rendered as text plus colour, never colour alone.** The value
mappings on panels 1, 7, 9 and 10 print `ok` / `warn` / `FAIL` / `unknown` /
`error` / `running` / `NEVER RUN` as words, so the dashboards stay readable in
greyscale and to a colourblind reader. `fail` is uppercased on purpose.

**`unknown` is a first-class status, not a pass.** A check the audit could not
run (statement timeout, fbref.com unreachable) is counted separately in panel 4
and coloured purple everywhere, because folding it into `ok` would report a
green dashboard for a database nobody actually checked. Same reasoning behind
panel 5: any non-zero `pages_errored` means every site total is a floor and
every percentage a ceiling.

**Read-only by construction.** Grafana connects as the CNPG managed role
`grafana_ro`, created NOLOGIN by Flyway V1 and flipped to LOGIN by CNPG using
the password in `fbref-grafana-ro.enc.yaml`
([`../../../../apps/staging/databases/fbref/`](../../../../apps/staging/databases/fbref/)).
The dashboards cannot write to `fbref-db` even if a panel's SQL tried to.

## Traps

- **The uid `fbref` is the contract between `datasource.enc.yaml` and every
  panel in both dashboards.** Each target hard-codes
  `"datasource": { "type": "postgres", "uid": "fbref" }`. Renaming the
  datasource or provisioning it without that uid leaves both dashboards loading
  fine and every panel erroring at query time.
- **`grafana_dashboard: "1"` on both ConfigMaps is what makes them dashboards.**
  Without the label the ConfigMap applies cleanly, `kubectl get cm` shows it,
  and Grafana never learns it exists. There is no error anywhere. The one-line
  comment on each label exists to stop that.
- **Namespace `monitoring`, not `fbref`.** The sidecars only search the Grafana
  release namespace. A dashboard ConfigMap next to the database is invisible.
- **`datasource.enc.yaml` is SOPS ciphertext** and depends on the `decryption`
  block of the `monitoring-configs` Kustomization. Without it Flux applies the
  literal `ENC[AES256_GCM,…]` string as the datasource definition, with no
  failure at apply time.
- **The overview dashboard hard-codes the fbref application schema**: tables
  `clubs`, `players`, `player_stats`, `url_queue` and columns including
  `scraped_at`, `current_club_fbref_id`, `player_fbref_id`, `stat_name`,
  `stat_value`, `last_error`. That schema is owned by Flyway in the asp repo,
  not by this repo, so a migration that renames a column breaks a panel here and
  nothing in this repository fails a render or a reconcile.
- **Panel 7 filters `stat_value ~ '^[0-9.]+$'` before casting to numeric.**
  `stat_value` is text (EAV); dropping the regex makes the panel fail on the
  first non-numeric stat rather than skipping it.
- **The `$stat` variable query is a `SELECT DISTINCT` over `player_stats`.**
  It is the one expensive query on the overview dashboard; leave `refresh: 2`
  (on time-range change) rather than moving it to on-dashboard-load.
- **Grafana grants, not just the connection, decide what renders.** A panel
  pointed at a table or view `grafana_ro` cannot `SELECT` fails at query time
  only — the dashboard still loads.
- **Editing a panel in the Grafana UI does not come back here.** These
  ConfigMaps are the source of truth; the sidecar reloads them and any
  UI-side change is lost. Change the JSON in git.
- **The audit dashboard is empty before fbref migration V24 and before the
  first audit run.** Panel 1 renders `NEVER RUN` by design; the rest error on a
  missing `audit` schema. That is the expected state on a fresh database, not a
  fault of these manifests.
- **`datasource.enc.yaml` has not been touched since 2026-06-09** (commit
  `8ac0470`), whose message records the datasource host as
  `fbref-db-rw.fbref.svc`. The `fbref-db` README describes Grafana as one of the
  analytics readers on the `fbref-db-ro` replica endpoint. One of the two is
  stale — decrypt the Secret and check before quoting either.

## Operating it

Render check before committing, and validate the embedded JSON (a malformed
dashboard applies as a perfectly valid ConfigMap and silently loads as nothing):

```bash
kubectl kustomize monitoring/configs/staging/fbref-grafana

sed -n '/fbref-overview.json: |/,$p' monitoring/configs/staging/fbref-grafana/dashboard.yaml \
  | tail -n +2 | jq -e . > /dev/null
sed -n '/fbref-audit.json: |/,$p' monitoring/configs/staging/fbref-grafana/dashboard-audit.yaml \
  | tail -n +2 | jq -e . > /dev/null
```

Push and check what Grafana actually picked up:

```bash
flux reconcile kustomization monitoring-configs -n flux-system
kubectl -n monitoring get cm -l grafana_dashboard=1
kubectl -n monitoring logs deploy/kube-prometheus-stack-grafana -c grafana-sc-dashboard --tail=20
```

Read the datasource back, or re-encrypt it after a change:

```bash
sops -d monitoring/configs/staging/fbref-grafana/datasource.enc.yaml
sops -e -i monitoring/configs/staging/fbref-grafana/datasource.enc.yaml
```

Check the queries themselves against the database (as the same read-only role
the dashboards use):

```bash
kubectl -n fbref exec fbref-db-1 -c postgres -- psql -U postgres -d fbref \
  -c '\dv audit.*'
kubectl -n fbref exec fbref-db-1 -c postgres -- psql -U postgres -d fbref \
  -c 'select status, started_at, finished_at from audit.latest_run'
```

## Overlays

`staging/` only. There is no `base/` and no `production/` for this directory,
and `clusters/production/` deploys no monitoring-configs Kustomization at all,
so the dashboards hard-code their staging values (datasource uid, namespace,
schema names). A second environment means splitting a `base/` out first.

`datasource.enc.yaml` is matched by the `(^|/)staging/.*\.enc\.ya?ml$` rule in
[`../../../../.sops.yaml`](../../../../.sops.yaml), which encrypts only `data` /
`stringData` under the staging age key.
