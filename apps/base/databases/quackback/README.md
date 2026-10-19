# quackback-db

The CNPG cluster of [Quackback](../../quackback/README.md), and the `quackback` namespace (the
databases tier reconciles before the apps tier). One instance. Quackback owns its schema (its
migrations run on every start); `postInitApplicationSQL` creates the two extensions it requires,
`vector` and `pg_trgm` (both in the CNPG `system` image), because the owning role `app` may not.
Uploads are not here: they go to the SeaweedFS bucket `quackback`.

**Backup: Garage, off-site** (owner, 2026-10-19), never the in-cluster SeaweedFS: the staging
overlay attaches the Barman Cloud plugin (WAL archive + a daily base backup at 03:40 UTC, 7 days
kept) to the Garage bucket `cnpg-staging-quackback`. Its key is generated in git (Garage format,
sops, `garage-backup-credentials` in this namespace) and imported + granted by the `garage-config`
Job (`infrastructure/services/staging/garage-gateway/configure/`: `buckets.txt` + `rbac.yaml`).
