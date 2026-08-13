# glpi

GLPI is an IT asset-management and helpdesk application. This directory holds a
two-part base: the PHP application (`app/`, image `glpi/glpi:11.0.1`) and a
dedicated MariaDB (`database/`, image `library/mariadb:11.8`), both single
replicas in the `glpi` namespace, each with its own `ReadWriteOnce` PVC. The
base is complete and renders nine objects, but **no overlay currently deploys
it** — `apps/staging/glpi/` and `apps/production/glpi/` both carry
`resources: []`. It is scaffolding carried over from the k3s cluster and never
migrated; see
[`documentations/06-k3s-retirement.md`](../../../documentations/06-k3s-retirement.md).

## How it is wired

The Flux `apps` Kustomization (`clusters/staging/apps.yaml`, `path:
./apps/staging`, `prune: true`, `dependsOn: db-migrations`, SOPS decryption)
builds `apps/staging/kustomization.yaml`, which lists `glpi/` explicitly. That
overlay renders nothing today, so Flux applies no GLPI object.
`clusters/production/apps.yaml` points a single `apps` Kustomization at
`./apps/production` (`dependsOn: infra-cnpg-plugin`, no `databases` /
`db-migrations` split), but that cluster does not exist and `apps/production/`
has no `kustomization.yaml` of its own — see
[`clusters/production/README.md`](../../../clusters/production/README.md).

Base (`apps/base/glpi/kustomization.yaml` → `namespace.yaml`, `app/`,
`database/`):

- `namespace.yaml` — `Namespace` `glpi`. Every base object also hardcodes
  `namespace: glpi` in its own metadata; the overlays additionally set
  `namespace: glpi` at the kustomization level.

Application (`app/kustomization.yaml` → `deployment.yaml`, `storage.yaml`,
`service.yaml`, `configmap.yaml`):

- `deployment.yaml` — `Deployment` `glpi`, `replicas: 1`, image
  `glpi/glpi:11.0.1`, `containerPort: 80`. `envFrom` pulls the whole
  `glpi-configmap` ConfigMap and the `glpi-secret` Secret. The PVC
  `glpi-config-pvc` mounts at `/var/glpi`. A second volume named `glpi-secret`
  (from Secret `glpi-secret`) is declared but no container mounts it — the
  Secret reaches the pod through `envFrom`, not through that volume.
- `service.yaml` — `ClusterIP` Service `glpi`, `port: 8080` →
  `targetPort: 80`, selector `app: glpi`.
- `storage.yaml` — PVC `glpi-config-pvc`, `ReadWriteOnce`, `1Gi`, no
  `storageClassName`, so it lands on the cluster default (Longhorn).
- `configmap.yaml` — ConfigMap `glpi-configmap`: `TIMEZONE: Europe/Paris`,
  `GLPI_DB_HOST: glpi-db`, `GLPI_DB_PORT: "3306"`, `GLPI_DB_NAME: glpi_db`,
  `GLPI_DB_USER: glpi`. These four database values are the contract with
  `database/`.

Database (`database/kustomization.yaml` → `configmap.yaml`, `service.yaml`,
`statfulset.yaml`, `storage.yaml`):

- `statfulset.yaml` — despite the filename, this declares a **`Deployment`**
  named `glpi-db`, `replicas: 1`, image `library/mariadb:11.8`,
  `containerPort: 3306`. `envFrom` pulls `glpi-db-configmap` and the
  `glpi-db-secret` Secret; the PVC `glpi-db-data-pvc` mounts at
  `/var/lib/mysql`. As on the app side, a `glpi-db-secret` volume is declared
  and never mounted.
- `service.yaml` — Service `glpi-db`, `port: 3306`, selector `app: glpi-db`,
  no explicit `type` (so `ClusterIP`). Its name is what
  `GLPI_DB_HOST` resolves.
- `configmap.yaml` — ConfigMap `glpi-db-configmap`:
  `MARIADB_RANDOM_ROOT_PASSWORD: "yes"` (the image generates a throwaway root
  password at first initialisation), `MARIADB_DATABASE: glpi_db`,
  `MARIADB_USER: glpi`.
- `storage.yaml` — PVC `glpi-db-data-pvc`, `ReadWriteOnce`, `1Gi`, default
  storage class.

## Why it is like this

**Nothing is deployed.** Both overlays hold `resources: []`;
`apps/production/glpi/kustomization.yaml` still carries the real list in
comments, the staging one no longer does. Doc 06 records the state after the
k3s → Talos migration: the `audiobookshelf`/`glpi`/`linkding`/`keycloak`
overlays "render no workloads yet (scaffolding) — same as on k3s, nothing
migrated". The base is kept intact, so enabling GLPI means restoring the
resource list, not rewriting the manifests.

**App and database are separate directories.** `app/` and `database/` are
independent kustomize dirs under one base so the two halves can be enabled,
patched or replaced separately; the staging and production overlays mirror the
same split (`glpi/app/` and `glpi/database/`, each holding only its own SOPS
Secret).

**A sidecar MariaDB rather than CNPG.** GLPI needs MySQL/MariaDB; the cluster's
CloudNativePG operator only manages Postgres, so this app carries its own
database container. The cost is stated in
[`documentations/03-backups.md`](../../../documentations/03-backups.md): "GLPI's
MariaDB StatefulSet has no backup of any kind either" — with no Longhorn
`backupTarget` configured, none of that data survives a full-cluster rebuild.

**The commented-out security contexts.** Both pod specs previously carried, in
comments, a pod-level `securityContext` (`fsGroup` / `runAsUser` /
`runAsGroup`: `33` — `www-data`, the same uid `linkding` uses — for the app,
`999` for MariaDB) and a container-level `allowPrivilegeEscalation: false`.
Neither was ever enabled. They are recorded here instead of in the YAML;
`linkding` and `audiobookshelf` carry the equivalent blocks uncommented in
their bases, though neither of those is deployed either.

## Traps

- **Four values must match across `app/configmap.yaml` and
  `database/configmap.yaml` + `database/service.yaml`**: `GLPI_DB_HOST`
  (`glpi-db`) is the database Service name, `GLPI_DB_PORT` (`3306`) its port,
  `GLPI_DB_NAME` (`glpi_db`) is `MARIADB_DATABASE` and `GLPI_DB_USER` (`glpi`)
  is `MARIADB_USER`. Change one side and the app cannot connect. A marker in
  `app/configmap.yaml` points at this.
- **Two unrelated SOPS Secrets hold the same password.** `glpi-secret` (app
  overlay) supplies GLPI's database password; `glpi-db-secret` (database
  overlay) supplies MariaDB's password for user `glpi`. They are encrypted in
  different files and nothing enforces that they agree.
- **`statfulset.yaml` is a `Deployment`, not a StatefulSet.** The filename is
  a typo that predates this README; `database/kustomization.yaml` lists it by
  that exact name, so renaming the file means editing the kustomization too.
- **Both workloads use the default `RollingUpdate` strategy on a
  `ReadWriteOnce` PVC.** With one replica and no `strategy.type: Recreate`, an
  update creates the new pod before the old one is gone and the replacement
  cannot attach the volume until it is. Deleting the pod is the reliable way
  to roll either of them.
- **No backup path exists.** Neither PVC is covered by CNPG (Postgres only)
  nor by a Longhorn backup target. Enabling GLPI with real data means adding a
  backup first.
- **`MARIADB_RANDOM_ROOT_PASSWORD: "yes"`** means no root password is stored
  anywhere; the generated one is only printed in the container's first-start
  log. Administration goes through the `glpi` user.

## Operating it

Render checks (both are expected to be empty until the overlay is re-enabled):

```bash
kubectl kustomize apps/staging/glpi      # currently renders nothing
kubectl kustomize apps/base/glpi         # 9 objects
flux get kustomizations apps
```

To deploy GLPI on staging, put these three entries back into
`apps/staging/glpi/kustomization.yaml` under `resources:`, replacing the empty
list:

```yaml
resources:
  - ../../base/glpi/
  - app/
  - database/
```

`apps/production/glpi/kustomization.yaml` takes the same three entries.

### Overlays

- `apps/staging/glpi/` — `namespace: glpi`, `resources: []`. Subdirectories
  `app/` and `database/` each hold a kustomization whose only resource is a
  SOPS-encrypted Secret (`glpi-secret.enc.yaml`, `glpi-db-secret.enc.yaml`).
  Because the parent lists no resources, those subdirectories are not built
  either.
- `apps/production/glpi/` — the same shape: same empty parent, same two
  subdirectories with the same two encrypted Secret names (the `app/` and
  `database/` kustomizations are identical to staging's; the parent
  `kustomization.yaml` differs only in the comments it carries). There is no
  staging/production divergence in this component.
