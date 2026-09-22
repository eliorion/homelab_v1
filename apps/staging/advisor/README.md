# advisor — staging release

`HelmRelease advisor` installs `k8s/charts/advisor` from the `asp` repo (source `advisor` in
`clusters/staging/sources.yaml`). Environment overrides only — image tags live in the chart's
own `values.yaml` and arrive via CI's `bump-chart` job.

**Currently inert.** Every image tag in the chart is empty and `dbMigrate.enabled` /
`components.advisor-api.enabled` are both `false` (WP1.9's first release has not shipped yet), so
this release installs no workload today — only the HelmRelease object itself, waiting on the
chart. It will start doing something the moment `advisor-db-migrations` and `advisor-api` cut
their first tagged release and a follow-up asp-repo commit flips those flags on (the same pattern
`webapp.enabled` / `adminUi.enabled` followed for asp and fbref).

See `apps/staging/databases/advisor/README.md` for the database-tier owner follow-ups (role-login
Secrets, backups, `ghcr-pull-secret` reflection) — none of them block this release either.
