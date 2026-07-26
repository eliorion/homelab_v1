# Database Backups — CNPG → Cloudflare R2 & Garage

Every CNPG Postgres cluster ships continuous, restore-verified backups to an
S3-compatible object store — **Cloudflare R2**, or off-cluster **Garage** for
fbref. The design gives **point-in-time recovery (PITR)**: a daily physical base
backup plus continuous WAL archiving, so the database can be restored to any
moment within the retention window.

Three clusters are protected:

| Cluster | Namespace | Backend | Holds |
|---|---|---|---|
| `keycloak-db` | `identity` | Cloudflare R2 | Keycloak realms, users, sessions |
| `asp-db` | `asp` | Cloudflare R2 | Automarket scraper data |
| `fbref-db` | `fbref` | **Garage** (off-cluster, via the gateway) | fbref scraper data (~3.5 GB) |

R2 and Garage use the **same** barman-cloud plugin; only the ObjectStore endpoint
+ credentials differ. The Garage path is detailed below and in `09`.

## Components and how they interact

```mermaid
graph TD
  subgraph cluster["k3s cluster (one per environment)"]
    cm["cert-manager<br/>(issues plugin TLS cert)"]
    op["CNPG operator<br/>(cloudnative-pg)"]
    plugin["Barman Cloud Plugin<br/>(CNPG-I, ns cnpg-system)"]

    subgraph pg["CNPG Cluster (e.g. keycloak-db)"]
      primary["Postgres primary"]
      sidecar["plugin sidecar<br/>(barman-cloud)"]
    end

    os["ObjectStore CR<br/>(r2-store)"]
    sb["ScheduledBackup<br/>(daily 03:00)"]
    sec["Secret r2-backup-credentials<br/>(SOPS-encrypted)"]
  end

  r2[("Cloudflare R2 bucket<br/>asp-cnpg-&lt;env&gt;")]

  cm -- "TLS cert" --> plugin
  op -- "manages" --> pg
  op -- "injects sidecar via" --> plugin
  plugin -- "reads config from" --> os
  os -- "reads keys from" --> sec
  sb -- "triggers base backup of" --> pg
  sidecar -- "WAL stream + base backups (AES256, gzip)" --> r2
  sec -. "endpoint + access keys" .-> sidecar
```

- **cert-manager** — hard dependency of the plugin; mints the TLS cert the plugin
  uses for its gRPC endpoint to the operator.
- **CNPG operator** — manages the Postgres clusters and, when a cluster declares
  the plugin, injects the `barman-cloud` sidecar into each instance pod.
- **Barman Cloud Plugin (CNPG-I)** — installs the `ObjectStore` CRD and performs
  the actual upload/download against R2. Lives in `cnpg-system`.
- **ObjectStore CR (`r2-store`)** — per-namespace config: R2 bucket
  (`destinationPath`), endpoint, credentials ref, compression, AES256 encryption,
  retention (`7d`), and the R2 checksum-compatibility env vars.
- **Secret `r2-backup-credentials`** — SOPS-encrypted R2 access key id + secret.
  One value per environment, present in each namespace that runs a cluster.
- **Cluster `.spec.plugins`** — attaches the cluster to the plugin and marks it
  the WAL archiver; sets `serverName`, the per-cluster prefix inside the bucket.
- **ScheduledBackup** — fires a daily physical base backup via the plugin method.

## Storage layout in R2

One bucket per **environment** (isolation: a staging compromise cannot reach
production backups). Both clusters share an env bucket, separated by `serverName`:

```
asp-cnpg-staging/                 asp-cnpg-production/
├── keycloak-db/   (serverName)   ├── keycloak-db/
│   ├── base/                     │   ├── base/
│   └── wals/                     │   └── wals/
└── asp-db/                       └── asp-db/
    ├── base/                         ├── base/
    └── wals/                         └── wals/
```

- **Credentials**: one R2 API token per env, scoped Object Read & Write to that
  env's bucket only.
- **Encryption**: AES256 server-side on both base data and WAL; gzip compression.
- **Retention**: `7d` — the plugin prunes base backups + WAL older than 7 days.
- **Versioning** enabled on each bucket to guard against accidental delete.

## Backup data flow

```mermaid
sequenceDiagram
  participant PG as Postgres primary
  participant SC as barman-cloud sidecar
  participant R2 as R2 bucket
  participant SB as ScheduledBackup

  Note over PG,SC: Continuous (every WAL segment)
  PG->>SC: WAL segment ready
  SC->>R2: archive WAL (gzip, AES256) → <serverName>/wals/

  Note over SB,R2: Daily 03:00
  SB->>SC: trigger base backup (method=plugin)
  SC->>PG: take physical base backup
  SC->>R2: upload base (gzip, AES256) → <serverName>/base/
  SC->>R2: prune backups + WAL older than 7d
```

WAL archiving + base backups together enable PITR: restore the latest base
backup, then replay WAL up to the chosen target time.

## Cloudflare R2 compatibility note

boto3 ≥ 1.36 sends S3 data-integrity checksums that R2 rejects
(`XAmzContentSHA256Mismatch`) — this breaks both archiving and restore
(upstream `plugin-barman-cloud` issue #411). The fix is baked into every
`ObjectStore` under `instanceSidecarConfiguration.env`:

```yaml
env:
  - name: AWS_REQUEST_CHECKSUM_CALCULATION
    value: when_required
  - name: AWS_RESPONSE_CHECKSUM_VALIDATION
    value: when_required
```

Because of this history, a **restore drill is mandatory** after enabling backups
in an environment — a backup that cannot restore is worthless.

## Second backend: Garage (fbref)

`fbref-db` backs up to an **off-cluster Garage** cluster instead of R2. Same
plugin, different ObjectStore (`garage-store`, `apps/staging/databases/fbref/`):

- **Endpoint**: the in-cluster HAProxy gateway
  `http://garage-s3.garage-gw.svc.cluster.local:3900`, which fails over across
  three Garage nodes reached over Tailscale (operator egress). Full gateway
  architecture in `documentations/09-etcd-backup-dr.md`.
- **No server-side encryption**: Garage has no SSE-S3/AES256 (SSE-C only), unlike
  R2 — the ObjectStore sets `wal`/`data` `compression: gzip` and **omits**
  `encryption:`. Setting AES256 would fail every upload.
- **Bucket**: `cnpg-staging-fbref` (barman layout `fbref-db/base|wals/`), key
  scoped to it (`garage-backup-credentials.enc.yaml`).
- Same defensive boto3 checksum-compat env as R2.

## Flux deployment order

The plugin installs the `ObjectStore` **CRD**; the `ObjectStore` **CRs** live in
other Kustomizations. Flux applies a Kustomization atomically, so a CR sharing a
Kustomization with its own CRD would deadlock (`no matches for kind ObjectStore`).
The CRD provider is therefore isolated and gated:

```mermaid
graph LR
  A["infra-certmanager<br/>(cert-manager ready)"]
  B["infra-cnpg-plugin<br/>(installs ObjectStore CRD,<br/>health-gated on HelmRelease)"]
  C["infrastructure-controllers<br/>(keycloak ObjectStore + Cluster)"]
  D["apps<br/>(asp ObjectStore + Cluster)"]

  A --> B
  B --> C
  B --> D
```

- `infra-certmanager` → `base/cert-manager` (cert-manager HelmRelease).
- `infra-cnpg-plugin` → `base/cnpg/plugin` (OCI chart `plugin-barman-cloud` from
  `oci://ghcr.io/cloudnative-pg/charts`). `dependsOn: infra-certmanager`,
  `wait: true`, health-gated on the `plugin-barman-cloud` HelmRelease.
- `infrastructure-controllers` and `apps` both `dependsOn: infra-cnpg-plugin`, so
  the CRD always exists before any `ObjectStore` is applied.

The CNPG **operator** install stays in `base/cnpg` (separate from the plugin) so
the already-running operator is never churned by this layering.

## File map

| Concern | Path |
|---|---|
| cert-manager | `infrastructure/controllers/base/cert-manager/` |
| Plugin (OCI HelmRelease + source) | `infrastructure/controllers/base/cnpg/plugin/` |
| CNPG operator | `infrastructure/controllers/base/cnpg/` |
| keycloak backup CRs | `infrastructure/controllers/<env>/keycloak/database/` |
| asp backup CRs | `apps/<env>/asp/` (`objectstore.yaml`, `scheduledbackup.yaml`, `cluster-backup-patch.yaml`, `r2-backup-credentials.enc.yaml`) |
| Flux ordering | `clusters/<env>/infrastructure.yaml`, `clusters/<env>/apps.yaml` |

## Operations

Trigger an on-demand backup (instead of waiting for 03:00):

```sh
kubectl cnpg backup keycloak-db -n identity \
  --method=plugin --plugin-name=barman-cloud.cloudnative-pg.io
```

Check archiving / backup status:

```sh
kubectl -n identity get cluster keycloak-db \
  -o jsonpath='{.status.conditions}'        # ContinuousArchiving=True
kubectl -n identity get scheduledbackup,backup
```

Restore drill (PITR) — recover into a throwaway cluster, verify, tear down:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: keycloak-db-restore-test
  namespace: identity
spec:
  instances: 1
  bootstrap:
    recovery:
      source: keycloak-db
      recoveryTarget:
        targetTime: "2026-06-02 02:30:00+00"   # any point within 7d
  externalClusters:
    - name: keycloak-db
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: r2-store
          serverName: keycloak-db
```

### Restore drill — performed 2026-07-26 (fbref-db ← Garage)

From-scratch bootstrap-recovery of `fbref-db` out of Garage
(`cnpg-staging-fbref`, `serverName fbref-db`) into a throwaway
`fbref-restore-test` cluster (`bootstrap.recovery`, **no** `spec.plugins` so the
test cluster cannot archive back onto the source's chain):

- Reached `Cluster in healthy state` in **~2.5 min**.
- Restored DB matched the source **exactly**: **3488 MB**, 10 public tables,
  `player_stats` ~9.7M rows, `url_queue` ~275K, `players` ~30K.
- Source `fbref-db` stayed 2/2 healthy throughout; test cluster + PVC deleted after.

Confirms the Garage bucket can rebuild a fresh cluster end-to-end. Re-run after
any change to the Garage gateway/egress path. (etcd snapshot restore is a
separate drill — see `09-etcd-backup-dr.md`.)

Rotate the R2 token periodically: mint a new scoped token, update the SOPS secret
(`sops -e -i`), commit, then revoke the old token.
