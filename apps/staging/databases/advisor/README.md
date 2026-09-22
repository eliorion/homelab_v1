# advisor — staging database overlay

What this PR wires: the `advisor` namespace and the `advisor-db` CNPG Cluster (2 instances, 20Gi
`ssd`, schema owned by Flyway — see `k8s/charts/advisor` in the `asp` repo). `advisor-db-app` (the
`app` role's connection Secret) is created automatically by CNPG's `bootstrap.initdb` — nothing to
add for that one.

What is **not** wired yet, and needs the owner (source: `docs/16-advisor-homelab-handoff.md` in the
`asp` repo, section 1):

1. **The five `advisor_*` role-login Secrets** (`advisor-pub-login`, `advisor-ingest-login`,
   `advisor-seed-login`, `advisor-review-login`, `advisor-publish-login`) — basic-auth Secrets,
   sops-encrypted, one password each, referenced by `database.yaml`'s `managed.roles` already. CNPG
   will report those roles as unmanaged (Secret not found) until these exist; that is harmless and
   does not block the Cluster itself. Needed before `dbMigrate.enabled: true` is flipped in the
   chart (V3 creates the roles NOLOGIN; these give them a login).
2. **Backup wiring** — a Garage bucket `cnpg-staging-advisor`, `garage-backup-credentials.enc.yaml`
   (same shape as `apps/staging/databases/fbref/garage-backup-credentials.enc.yaml`), an
   `objectstore.yaml` and a daily `ScheduledBackup`, mirroring the fbref overlay. Gated on
   WP1.10's restore drill, not on a first deployment being visible.
3. **`ghcr-pull-secret` reflection** — add `advisor` to the two `reflection-auto-namespaces` lists in
   `infrastructure/controllers/staging/reflector/ghcr-pull-secret.enc.yaml` (one line each,
   re-encrypt with the staging age key). Without it, `advisor-api`'s pod cannot pull its private
   GHCR image once the component is enabled.

None of the three block this PR: the chart is inert until `advisor-db-migrations`' first release
writes a real image tag (see `apps/staging/advisor/README.md`).
