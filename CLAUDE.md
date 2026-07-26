# k3s cluster for learning

3-node bare-metal **Talos Linux** cluster (`Homelab_staging`:
`staging-controlplane-1/2/3` at `192.168.1.101-103`, API VIP `192.168.1.100`;
Talos `v1.13.4`, k8s `v1.36.1`, all control planes also run workloads) managed
entirely by **Flux GitOps** — never `kubectl apply` resources by hand; change
the YAML, commit, push, let Flux reconcile. (Migrated from a single-node k3s
box — the repo name is historical; see `documentations/06`–`08`.)

## Repo layout

- `bootstraping/` — Talos layer: `talconfig.yaml` (talhelper) renders the 3
  node configs to `clusterconfig/`; secrets in `talsecret.sops.yaml`
- `clusters/staging/` — Flux entrypoints (Kustomizations pointing at the dirs below)
- `infrastructure/controllers/` — operators: cilium (CNI), cert-manager, cnpg,
  ARC controller, longhorn, tailscale-operator
- `infrastructure/services/` — workloads: nexus, arc-runner-set, cloudflare,
  renovate, etcd-backup, garage-gateway
- `apps/`, `monitoring/` — application and monitoring tiers
- `documentations/` — numbered guides; `03-backups.md` (CNPG → R2/Garage),
  `04-ci-runners-cache.md` (CI stack), `05-alerting.md` (Telegram alerts),
  `06`/`07` (Talos + Longhorn migration & HA),
  `08-cilium-cni-ingress-migration.md` (Cilium CNI),
  `09-etcd-backup-dr.md` (etcd backup + disaster recovery)
- Each tier uses `base/` + `staging/` (+ `production/`) kustomize overlays

## Conventions

- Secrets: SOPS-encrypted (`*.enc.yaml`, age key, see `.sops.yaml`). Never
  commit plaintext secrets.
- Chart versions are pinned; Renovate bumps them. The two ARC charts
  (`gha-runner-scale-set-controller` and `gha-runner-scale-set`) must stay
  on the same version.
- Node config is **talhelper**-managed: edit `bootstraping/talconfig.yaml`,
  render (`SOPS_AGE_KEY_FILE=clusters/staging/age.agekey talhelper genconfig`),
  `talosctl apply-config`. Never regenerate `talsecret` (new PKI = dead cluster).
- CNI is **Cilium** `1.19.4`, kube-proxy-free (KubePrism `localhost:7445`),
  Flux-managed HelmRelease. Bare-metal LoadBalancer via Cilium **LB-IPAM**
  (pool `192.168.1.110-130`) + L2 announce; Gateway API for L7 ingress (doc 08).
- Storage is **Longhorn** (storage class `longhorn`, 3 replicas, one per node;
  doc 07). StatefulSet `volumeClaimTemplates` stay immutable — resizing means
  deleting the StatefulSet + PVC (see doc 04 troubleshooting). A daily
  `filesystem-trim` RecurringJob (`default` group) reclaims freed blocks so a
  volume's `actualSize` tracks real filesystem usage.

## CI stack (summary — full detail in documentations/04-ci-runners-cache.md)

- ARC runner scale set `self-hosted-arc` runs `Eliorion/asp` workflows,
  0→5 ephemeral pods, one job per pod.
- Runner pods use a **manual dind template** (not `containerMode: dind`)
  so dockerd gets `--insecure-registry` for the HTTP-only Nexus connectors.
- Nexus repos: `pypi-proxy` (8081), `docker-hub` proxy (5000), `ghcr`
  proxy (5001), `docker-cache` hosted (5002). Connector `httpPort`s must be
  unique or the config Job 400s and the port never opens.
- In-cluster registry host: `nexus.nexus.svc.cluster.local:500x`.

## Backups & DR (full detail in documentations/03 + 09)

- **CNPG Postgres** → S3 via the barman-cloud plugin: `keycloak-db`/`asp-db` to
  **Cloudflare R2**, `fbref-db` to **Garage**. Daily base backup + continuous WAL
  (PITR, 7d retention). The Garage ObjectStore omits SSE (Garage has no SSE-S3).
- **etcd** → Garage every 6h: `talos-backup` CronJob (ns `etcd-backup`),
  age-encrypted, using the `kubernetesTalosAPIAccess` `os:etcd:backup` role.
  Restore = `talosctl bootstrap --recover-from` (doc 09). Prometheus staleness alert.
- **Garage** is off-cluster on **Tailscale**, reached through the in-cluster
  **HAProxy gateway** `garage-s3.garage-gw.svc:3900` → operator egress → 3 nodes.
  Restore runs off-cluster, direct to a node's tailnet IP (gateway is in-cluster
  only). talos-backup is pinned to beta.3 with two workarounds — both age vars set,
  and `USE_PATH_STYLE: "false"` (inverted check) — flagged in the configmap.
- **The etcd-backup age private key is offline** — lose it and snapshots are
  unrecoverable. CNPG restore drilled 2026-07-26 (doc 03); the etcd full-restore
  drill is the operator's to run (doc 09).

## Verify changes

```bash
kubectl kustomize infrastructure/services/staging   # render check before commit
flux get kustomizations
flux get helmreleases -A
```

For Talos node-config changes (`bootstraping/talconfig.yaml`):

```bash
cd bootstraping && SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-1.yaml --mode metal
```
