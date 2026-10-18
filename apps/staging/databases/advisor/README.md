# advisor — staging database overlay

What this PR wires: the `advisor` namespace and the `advisor-db` CNPG Cluster (2 instances, 20Gi
`ssd`, schema owned by Flyway — see `k8s/charts/advisor` in the `asp` repo). `advisor-db-app` (the
`app` role's connection Secret) is created automatically by CNPG's `bootstrap.initdb` — nothing to
add for that one.

What is **not** wired yet, and needs the owner (source: `docs/16-advisor-homelab-handoff.md` in the
`asp` repo, section 1):

1. **The other four `advisor_*` role-login Secrets** (`advisor-ingest-login`, `advisor-seed-login`,
   `advisor-review-login`, `advisor-publish-login`) — same shape as `advisor-pub-login.enc.yaml`
   (copy `advisor-pub-login.enc.yaml.exemple`, swap the role name and generate a fresh password),
   referenced by `database.yaml`'s `managed.roles` already. CNPG will report those roles as
   unmanaged (Secret not found) until these exist; that is harmless and does not block the Cluster
   itself. `advisor-pub-login` is done — that unblocks `advisor-api`'s dbRole login; the other four
   only gate the role-isolation helm test hooks and the not-yet-deployed `advisor-ingest` Job, not
   `advisor-api` itself.
2. **Backup wiring — done 2026-10-18, on the owner's request, ahead of WP1.10's restore drill.**
   Garage bucket `cnpg-staging-advisor` (created and its key imported by the `garage-config` Job,
   `infrastructure/services/staging/garage-gateway/configure/`), `garage-backup-credentials.enc.yaml`,
   `objectstore.yaml` (7d), a daily `ScheduledBackup` at 02:40 and `cluster-backup-patch.yaml`.
   The restore drill itself is still WP1.10's.

`ghcr-pull-secret` reflection is already done — `advisor` is in the plaintext
`reflection-auto-namespaces`/`reflection-allowed-namespaces` lists in
`infrastructure/controllers/staging/reflector/ghcr-pull-secret-namespaces.yaml` (no sops needed for
that file; only the credential itself lives in the sibling `.enc.yaml`).

Neither remaining item blocks this PR: the chart is inert until `advisor-db-migrations`' first
release writes a real image tag (see `apps/staging/advisor/README.md`).
