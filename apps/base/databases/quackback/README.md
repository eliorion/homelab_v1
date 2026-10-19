# quackback-db

The CNPG cluster of [Quackback](../../quackback/README.md), and the `quackback` namespace (the
databases tier reconciles before the apps tier). One instance. Quackback owns its schema (its
migrations run on every start); `postInitApplicationSQL` creates the two extensions it requires,
`vector` and `pg_trgm` (both in the CNPG `system` image), because the owning role `app` may not.
Uploads are not here: they go to the SeaweedFS bucket `quackback`. No backup yet: it needs a Garage
key and the `cluster-backup-patch` / `objectstore` / `scheduledbackup` trio n8n uses.
