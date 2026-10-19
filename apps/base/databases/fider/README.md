# fider-db

The CNPG cluster of [Fider](../../fider/README.md), and the `fider` namespace (the databases tier
reconciles before the apps tier). One instance; Fider owns its schema (`./fider migrate` on every
start, no `postInit`) and stores attachments in it. No backup yet: it needs a Garage key and the
`cluster-backup-patch` / `objectstore` / `scheduledbackup` trio n8n uses.
