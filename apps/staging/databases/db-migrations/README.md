# db-migrations

`db-migrations` is the Flyway tier of the databases stack: one Kubernetes `Job`
per project (`asp`, `fbref`, `scraper`) that runs `flyway migrate` against the
CNPG-generated `<cluster>-app` Secret of the matching Postgres cluster. Those
clusters (`apps/base/databases/<project>/`, overlaid in
`apps/<env>/databases/<project>/`) create the database; the Flyway Jobs own its
schema. The Jobs are applied by their own Flux Kustomization, which sits between
`databases` and `apps` so a schema change lands before the application images
that need it, and a failed migration stops the apps tier from rolling. This
README covers the `db-migrations` component and the aggregating
`apps/<env>/databases/kustomization.yaml`; each Postgres cluster has its own
README under `apps/base/databases/<project>/`
([`asp`](../../../base/databases/asp/README.md),
[`fbref`](../../../base/databases/fbref/README.md),
[`n8n`](../../../base/databases/n8n/README.md),
[`scraper`](../../../base/databases/scraper/README.md)).

## How it is wired

There is no `base/` for this component: the Jobs exist only in the staging
overlay, `apps/staging/databases/db-migrations/`.

| File | What it declares |
|---|---|
| `apps/staging/databases/kustomization.yaml` | the databases tier — the CNPG clusters and their secrets/backups: `asp/`, `fbref/`, `n8n/`, `scraper/`. `db-migrations/` is deliberately absent |
| `db-migrations/kustomization.yaml` | lists `asp/`, `fbref/`, `scraper/` |
| `db-migrations/asp/kustomization.yaml` | `namespace: asp`, resource `asp-db-migrations-job.yaml` |
| `db-migrations/asp/asp-db-migrations-job.yaml` | Job `asp-db-migrate`, image `ghcr.io/eliorion/asp-db-migrations:db-migrations-v0.6.0`, pod label `app.kubernetes.io/name: db-migrations` |
| `db-migrations/fbref/kustomization.yaml` | `namespace: fbref`, resource `fbref-db-migrations-job.yaml` |
| `db-migrations/fbref/fbref-db-migrations-job.yaml` | Job `fbref-db-migrate`, image `ghcr.io/eliorion/fbref-db-migrations:fbref-db-migrations-v0.3.0`, pod label `app.kubernetes.io/name: fbref-db-migrations` |
| `db-migrations/scraper/kustomization.yaml` | `namespace: scraper`, resource `scraper-db-migrations-job.yaml` |
| `db-migrations/scraper/scraper-db-migrations-job.yaml` | Job `scraper-db-migrate`, image `ghcr.io/eliorion/scraper-db-migrations:scraper-db-migrations-v0.5.0`, pod label `app.kubernetes.io/name: scraper-db-migrations` |

The three Jobs are identical apart from namespace, Job name, pod label, image
and Secret name:

- `args: ["migrate"]`, `backoffLimit: 3`, `restartPolicy: Never`, no
  `ttlSecondsAfterFinished`.
- `imagePullSecrets: [ghcr-pull-secret]` — the images are private GHCR
  packages. The Secret is not defined in this component; the central reflector
  source (`infrastructure/controllers/staging/reflector`) mirrors one
  `ghcr-pull-secret` into `asp`, `fbref`, `lab` and `scraper`.
- Pod security context `runAsNonRoot: true`, `runAsUser: 101`,
  `seccompProfile.type: RuntimeDefault`; container security context
  `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`,
  `readOnlyRootFilesystem: false`.
- `FLYWAY_URL`, `FLYWAY_USER` and `FLYWAY_PASSWORD` read `jdbc-uri`, `username`
  and `password` from the CNPG-generated `<cluster>-app` Secret — `asp-db-app`,
  `fbref-db-app`, `scraper-db-app`.
- `FLYWAY_BASELINE_ON_MIGRATE: "true"`, `FLYWAY_BASELINE_VERSION: "0"`,
  `FLYWAY_CONNECT_RETRIES: "10"`.
- Requests `50m` CPU / `128Mi` memory, limits `500m` CPU / `512Mi` memory.

Flux, in [`clusters/staging/apps.yaml`](../../../../clusters/staging/apps.yaml),
declares the chain:

1. `databases` — `path: ./apps/staging/databases`, `dependsOn`
   `infra-cnpg-plugin` and `infra-reflector`, `wait: true`, SOPS decryption.
2. `db-migrations` — `path: ./apps/staging/databases/db-migrations`,
   `dependsOn: databases` (it needs the clusters and their `-app` Secrets),
   `interval: 1m0s`, `retryInterval: 1m`, `timeout: 5m` (chosen to exceed
   `backoffLimit: 3` times the migration runtime), `prune: true`, `force: true`,
   `wait: true`. It carries no `decryption` block.
3. `apps` — `path: ./apps/staging`, `dependsOn: db-migrations`.

`apps/staging/kustomization.yaml` lists the application directories explicitly
so the `apps` Kustomization never picks up `databases/`.

## Why it is like this

**The gate.** Ordering is `databases` → `db-migrations` → `apps`. On a release
the running pods keep their previous image tags while the migration Job runs;
the new tags only apply once the Job completes. A failed Job leaves
`db-migrations` NotReady, so the apps tier never rolls — this is the edge doc 01
records as "schema migrations land before new application images roll out".

**`force: true`.** A Job is immutable, so an image-tag bump can only be applied
by deleting and recreating it. `wait: true` then makes the Kustomization Ready
only when the Job actually completes; a failed Job surfaces as NotReady instead
of silently leaving the schema behind. The same recipe is used for the Keycloak
realm import Job in `clusters/staging/infrastructure.yaml`.

**No `ttlSecondsAfterFinished`.** Flux owns the Job lifecycle through `force`. A
TTL would delete the completed Job, and every later reconcile would re-create
and re-run it for nothing.

**Baselining.** `FLYWAY_BASELINE_ON_MIGRATE` with `FLYWAY_BASELINE_VERSION: "0"`
exists because these databases predate Flyway: `asp-db` was bootstrapped from
`db-init-configmap.yaml` and `fbref-db` from a `postInit` bootstrap that has
since been retired. An existing database is baselined at 0, the idempotent
V-files then re-run as no-ops and the history table is populated; a fresh
cluster comes up empty and gets V1 onward.

**Connection details from CNPG.** `FLYWAY_URL` uses the `jdbc-uri` key of the
cluster's generated `<cluster>-app` Secret, which points at the cluster's
bootstrap database — `automarket` for `asp-db`, `fbref` for `fbref-db`,
`scraper` for `scraper-db`. The asp Job carried a commented-out fallback for the
case where `jdbc-uri` resolves to the wrong database: a literal
`FLYWAY_URL` against the CNPG read-write Service, written there as
`jdbc:postgresql://staging-rw.asp.svc:5432/automarket`.

**Running non-root.** The pods run as UID 101 with `runAsNonRoot: true` because
the flyway image's files are world-readable and running `migrate` as a non-root
user was verified. `readOnlyRootFilesystem` stays `false` because flyway writes
temporary files under `/flyway`.

**Image tags are bumped by hand.** The asp and scraper manifests recorded that
Renovate does not bump them. `renovate.json` scopes the kubernetes manager to
`/apps/.+/db-migrations/.+\.yaml$/` and teaches it the release-please tag scheme
`<component>-vX.Y.Z` for `ghcr.io/eliorion/scraper-db-migrations` and
`ghcr.io/eliorion/fbref-db-migrations` only — `ghcr.io/eliorion/asp-db-migrations`
is not listed — and every tag bump in this directory so far arrived as a manual
`fix(db-migrations): bump …` commit.

**A stale pin is invisible.** The `apps` gate cannot catch it: application image
tags live in the asp repo's charts and reach the cluster on their own
GitRepository, never through this Kustomization. The already-completed Job
satisfies `wait: true` in about 46ms while the schema sits behind the code. That
is how the asp pin sat on `v0.1.0` for 47 days while releases reached `v0.6.0`.

**Supersession.** The asp chart has its own Flyway pre-upgrade hook
(`dbMigrate.enabled`); once that is switched on it supersedes the
`asp-db-migrate` Job here.

**No Job for n8n.** n8n runs its own TypeORM migrations on boot, so `n8n-db` has
no entry in `db-migrations/` — see
[`../../../../documentations/10-n8n-automation.md`](../../../../documentations/10-n8n-automation.md).

**`db-migrations/` is not in the databases kustomization.** It has its own Flux
Kustomization with different settings (`force: true`, no SOPS decryption) and a
`dependsOn` on `databases`. Listing it under `apps/staging/databases/` would
apply the Jobs in the same pass as the clusters and destroy the ordering.

The tier survived the k3s → Talos move unchanged: doc 06 records that on
2026-06-10 `db-migrations` and `apps` reused the `./apps/staging` paths and
Flyway ran clean against the recovered `asp-db`
([`../../../../documentations/06-k3s-retirement.md`](../../../../documentations/06-k3s-retirement.md)).

## Traps

- A Job is immutable. The `db-migrations` Kustomization must keep `force: true`,
  or an image-tag bump is rejected and the migration never runs.
- Never add `ttlSecondsAfterFinished` to these Jobs. Flux owns their lifecycle;
  a TTL turns every reconcile into a re-run.
- The image tags are bumped by hand and a stale pin does not fail anything: the
  completed Job satisfies `wait: true` immediately. Bump the tag in the same
  change as the migration it applies.
- `FLYWAY_URL` must resolve to the cluster's bootstrap database
  (`automarket` / `fbref` / `scraper`). `jdbc-uri` comes from CNPG; if it ever
  points elsewhere, replace the `secretKeyRef` with a literal URL against the
  cluster's `-rw` Service.
- `readOnlyRootFilesystem` must stay `false` — flyway writes temp files under
  `/flyway`.
- Do not add `db-migrations/` to `apps/staging/databases/kustomization.yaml`,
  and do not add the databases directories to `apps/staging/kustomization.yaml`.
  Both would break the `databases` → `db-migrations` → `apps` ordering.
- The `db-migrations` Kustomization has no `decryption` block, unlike
  `databases` and `apps`. A SOPS-encrypted file placed in this directory would
  not be decrypted.
- The migrations create roles, so the `app` role of `asp-db` and `fbref-db` must
  keep `createrole: true` in its `managed.roles` block — see
  [`asp/README.md`](../../../base/databases/asp/README.md) and
  [`fbref/README.md`](../../../base/databases/fbref/README.md).
- `ghcr-pull-secret` is not defined here. The whole app chain is gated on
  `infra-reflector` precisely so the mirrored Secret exists before these Jobs
  pull their private images.

## Operating it

```bash
kubectl kustomize apps/staging/databases/db-migrations   # render check before commit
kubectl kustomize apps/staging/databases

flux get kustomizations                    # databases → db-migrations → apps Ready
flux reconcile kustomization db-migrations --with-source

kubectl -n asp get job asp-db-migrate
kubectl -n asp logs job/asp-db-migrate
kubectl -n fbref logs job/fbref-db-migrate
kubectl -n scraper logs job/scraper-db-migrate
```

To ship a migration: bump the image tag in the project's
`*-db-migrations-job.yaml`, commit and push. Flux deletes and recreates the Job,
and `apps` stays blocked until it completes.

### Overlays

Staging only. `apps/base/databases/` holds the four CNPG clusters but no
`db-migrations` base — the three Jobs are written directly in
`apps/staging/databases/db-migrations/`. `apps/production/databases/` lists only
`asp/` and has no `db-migrations` directory, and `clusters/production/apps.yaml`
declares a single `apps` Kustomization on `./apps/production`, so the
`databases` → `db-migrations` → `apps` chain exists on the staging cluster only.

See also
[`../../../../documentations/01-architecture.md`](../../../../documentations/01-architecture.md)
for the full Flux dependency graph.
