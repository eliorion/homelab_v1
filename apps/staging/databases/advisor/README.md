# advisor — staging database overlay

What this PR wires: the `advisor` namespace and the `advisor-db` CNPG Cluster (2 instances, 100Gi
`ssd-cnpg`, one per node and never on node-1 (kept for the Dagger engine) since 2026-10-28, schema owned by Flyway — see `k8s/charts/advisor` in the `asp` repo). `advisor-db-app` (the
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

## Moving the instances onto `ssd-cnpg` (2026-10-28)

The storage patch moves nothing by itself: each instance is re-cloned onto the new class, one at a
time (procedure: `apps/base/databases/fbref/README.md`, "Operating it").

1. Delete the stuck replica: `kubectl -n advisor delete pvc advisor-db-1 --wait=false && kubectl -n advisor delete pod advisor-db-1`.
   CNPG clones `advisor-db-3` from the primary onto node-2.
2. When `advisor-db-3` is ready, CNPG restarts the primary `advisor-db-2` in place on its own (the
   new affinity is a pod spec change, `primaryUpdateMethod: restart`): a short write outage, no
   data loss, it stays on node-3 with its volume. Wait for it to be ready again.
3. Switch over to `advisor-db-3` (`targetPrimary`), then delete `advisor-db-2`'s PVC and pod; CNPG
   clones `advisor-db-4` onto node-3. Do this only with a recent completed backup and
   `ContinuousArchiving=True`.
