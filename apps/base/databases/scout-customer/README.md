# scout-customer

The database of what Scout's **customers** create and do (asp docs/39): their saved page layouts,
column choices and matchmaking weights, their shortlist and notes, their saved searches, the
history of their actions and their connection sessions. It is kept apart from `fbref-db` on
purpose: fbref-db holds the product data (300M+ crawled rows, heavy writes, multi-day restores, a
replica that can stall), and none of that may delay, lose or expose a customer's own data.

## How it is wired

Base (`apps/base/databases/scout-customer/`):

- `database.yaml` — CNPG `Cluster` `scout-customer` in namespace **`fbref`** (the Scout webapp's
  namespace; the namespace itself is fbref-db's base). 2 instances, synchronous replication with
  `dataDurability: preferred` (same as every cluster here), database `scout_customer` owned by
  `app`, 5Gi. Managed roles: `app` (CREATEROLE, the migrations run as it) and `scout_customer`
  (the webapp's login, password from `scout-customer-login`).

Staging (`apps/staging/databases/scout-customer/`):

- `scout-customer-login.enc.yaml` — basic-auth Secret for the `scout_customer` role. `username`
  must be the role name: that is how CNPG matches the login to the role. The webapp reads the same
  Secret (same namespace), through the fbref chart's `customer.secretName`.
- `scout-customer-garage-backup.enc.yaml` — the Garage key for bucket
  `cnpg-staging-scout-customer`, generated in git and imported into Garage by the `garage-config`
  Job (`infrastructure/services/staging/garage-gateway/configure`, line in `buckets.txt`).
- `objectstore.yaml` — ObjectStore **`scout-customer-garage-store`**, 30-day retention.
- `scheduledbackup.yaml` — daily base backup at 03:20 UTC.
- `cluster-backup-patch.yaml` — barman-cloud plugin as WAL archiver, `serverName: scout-customer`.
- `cluster-storage-patch.yaml` — `ssd-cnpg`, never on node-1 (same as advisor-db).

Memory (128Mi request / 512Mi limit) is set in `apps/staging/databases/kustomization.yaml`, never
here: base also feeds the e2e vcluster.

## Traps

- **The ObjectStore and the key Secret must not be named `garage-store` /
  `garage-backup-credentials`.** Those names belong to fbref-db in the same namespace; reusing them
  would point this cluster's WAL at fbref's bucket (and its key).
- **The Garage key is imported, not created on a node.** Rotating it = new key in the `.enc.yaml`,
  merge, let `garage-config` import it; the old key keeps its grant until denied on a node.
- **Schema is Flyway's** (asp `services/fbref/customer-postgres/migrations`, run by the fbref chart's
  customer migration hook as `app`), never a `postInit`. A migration that CREATE/ALTERs the
  `scout_customer` role must keep it NOLOGIN: CNPG owns its login.
- **Retention is a product rule, not only a backup one**: the activity history and sessions are
  personal data, purged after 13 months by the schema itself (asp docs/39). Backups keep 30 days.
