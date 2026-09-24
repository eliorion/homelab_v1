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

**Relevance stage's model call (WP2.4).** `advisor-pipeline`'s `score` command classifies a forum post
through the homelab ai-gateway (Bifrost), never with a raw vendor key (see the asp repo's
`services/advisor/pipeline/src/relevance/client.rs`). Three things, all standard ai-gateway
"Connecting a project" steps (`infrastructure/services/base/ai-gateway/README.md`):

1. Create a virtual key in the ai-gateway dashboard, on a routing-rule alias pointed at a free-tier
   provider (no cost).
2. Store it as `advisor-ai-gateway-token.enc.yaml`, from the `.exemple` here.
3. Run `advisor-pipeline score` with `LLM_BASE_URL` = the gateway's `/anthropic` path, `LLM_MODEL` =
   that alias, `LLM_API_KEY` from the Secret's `AI_GATEWAY_TOKEN` key.

Not blocking: `advisor-pipeline` has no deployed component yet (WP2.5 gives it one) — today it runs as a
one-off CLI, reached from outside the cluster the same way as any other one-off job here, e.g.
`kubectl -n ai-gateway port-forward svc/ai-gateway 18081:8080` and `LLM_BASE_URL=http://127.0.0.1:18081/anthropic`.
When it becomes a deployed component, its chart wiring needs an egress rule to the `ai-gateway`
namespace (selected by the label `name: ai-gateway`, not by name) on port 8080, mirroring the
`objectStore`/`scraperApi` pattern already in `k8s/charts/common`.
