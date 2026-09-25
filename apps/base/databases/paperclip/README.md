# paperclip-db

`paperclip-db` is the CloudNativePG Postgres cluster behind the Paperclip agent
control plane ([`../../paperclip/README.md`](../../paperclip/README.md)). It
lives in the `paperclip` namespace and runs two instances. Its schema is not
owned by Flyway: Paperclip runs its own migrations on every boot, so a fresh
cluster comes up empty and the first Paperclip pod creates the whole schema.
Every company, agent, issue and run record is in this database and nowhere
else. The Garage backup resources are written and staged but commented out of
the staging overlay until a bucket and key exist.

## How it is wired

Base (`apps/base/databases/paperclip/`):

- `namespace.yaml` — the `paperclip` Namespace. It ships here because the
  `databases` Flux Kustomization reconciles before `apps`.
- `database.yaml` — CNPG `Cluster` `paperclip-db`, a copy of `n8n-db`: 2
  instances, `imageName: ghcr.io/cloudnative-pg/postgresql:18.3-system-trixie`,
  synchronous replication with `dataDurability: preferred`, the same
  `postgresql.parameters`, `bootstrap.initdb` database `paperclip` owned by
  `app`, `storage.size: 5Gi`. CNPG generates the `paperclip-db-app` Secret whose
  `uri` key the Deployment uses as `DATABASE_URL`.

Staging (`apps/staging/databases/paperclip/`):

- `cluster-storage-patch.yaml` — PVCs on the LINSTOR `ssd` class.
- `objectstore.yaml`, `scheduledbackup.yaml`, `cluster-backup-patch.yaml` —
  Barman Cloud plugin → Garage bucket `cnpg-staging-paperclip`, 30-day
  retention, daily base backup at 03:20 (after asp/fbref 03:00 and n8n 03:10).
  **Commented out** in `kustomization.yaml`.
- `garage-backup-credentials.enc.yaml.exemple` — plaintext template for the
  Garage key Secret.

## Why it is like this

Same shape as `n8n-db` on purpose: an app that owns its schema, one database
per app, one namespace per app. See
[`../n8n/README.md`](../n8n/README.md) for the reasoning behind the
replication settings and the Garage ObjectStore.

## Traps

- Enable backups in one commit: the three resources **and** the
  `cluster-backup-patch.yaml` entry, and only once the real Garage key is in.
  With placeholder credentials the WAL archiver fails and degrades the cluster,
  and `databases` reconciles with `wait: true`, stalling the whole app tier.

## Operating it

Enable backups:

```bash
garage bucket create cnpg-staging-paperclip
garage key create paperclip-cnpg-staging
garage bucket allow --read --write cnpg-staging-paperclip --key paperclip-cnpg-staging

cd apps/staging/databases/paperclip
cp garage-backup-credentials.enc.yaml.exemple garage-backup-credentials.enc.yaml
# fill in ACCESS_KEY_ID / ACCESS_KEY_SECRET
sops -e -i garage-backup-credentials.enc.yaml
grep -q 'ENC\[' garage-backup-credentials.enc.yaml && echo SAFE || echo PLAINTEXT
# then uncomment the backup block in kustomization.yaml
```

### Overlays

Staging only, wired into `apps/staging/databases/kustomization.yaml`.
