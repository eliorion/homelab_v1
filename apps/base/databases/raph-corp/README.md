# raph-corp database

CNPG `Cluster` `raph-corp-db` in the `raph-corp` namespace (this base also owns the namespace,
like the other stacks). CNPG writes the `raph-corp-db-app` Secret; its `uri` key is what the
raph-corp chart (asp repo, `k8s/charts/raph-corp`) reads as `DATABASE_URL`. The chart keeps
`cnpg.enabled: false` so this tier stays the only owner of the Cluster.

The schema is applied by the app itself at startup, so there is no entry in `db-migrations/`.
Staging overlay: [`../../../staging/databases/raph-corp`](../../../staging/databases/raph-corp).
