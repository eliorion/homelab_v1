# Retiring the k3s staging cluster

> **✅ RETIREMENT COMPLETE — 2026-06-11.** The Talos cluster
> (`staging-controlplane-1`, 192.168.1.41) is the staging cluster, Flux path
> `clusters/staging/`. The k3s VM is deleted. Kept for reference: the
> migration order, the WAL/seeding gotchas, and the scraper proxy path.
> R2 finalized 2026-06-11: the k3s history and the transitional
> `asp-db-talos` prefix were both deleted; the live cluster archives under
> the canonical `serverName: asp-db` with a fresh post-rename base backup.
> No leftovers remain.

Migration checklist: move everything from the k3s node (`192.168.1.50`,
Debian, Flux path `clusters/staging`) to the Talos node
(`staging-controlplane-1`, `192.168.1.41`, Flux path `clusters/talos-staging`).
Longhorn replaces `local-path` as the storage class on Talos (single replica,
no volume-expansion limitation, snapshots/backups built in).

Work top to bottom. Stateless controllers (steps 1–2) are **copied** to
`clusters/talos-staging/` and stay on k3s until decommission — the live k3s
databases still need cert-manager and the CNPG operator for backups. Stateful
or singleton workloads (steps 3+) are genuine moves.

⚠️ **Operational constraint (discovered 2026-06-10): only ONE cluster can run
at a time** — k3s and Talos never coexist. R2 (and local dump files) are the
only data channels between them. Singleton concerns (duplicate ARC scale
sets, duplicate tunnel) are moot; cutover = "boot the other node". Each k3s
boot is purely a data-extraction window.

## Prerequisites (before moving anything)

- [ ] Longhorn verified on Talos (PVC bind, write, reboot survival — done
      during bootstrap).
- [ ] Recreate the SOPS age secret on Talos — required by any Kustomization
      with `decryption.provider: sops`:
      ```bash
      export KUBECONFIG=bootstraping/kubeconfig
      kubectl create secret generic sops-age -n flux-system \
        --from-file=age.agekey=clusters/staging/age.agekey
      ```
      (the age key + .envrc live in `clusters/staging/`, local + gitignored)
- [ ] Configure Longhorn `backupTarget` → Cloudflare R2 (same bucket family as
      CNPG barman). Longhorn data lives on the Talos EPHEMERAL partition via
      the `/var/lib/longhorn` bind mount: it survives reboots and upgrades but
      NOT `talosctl reset` / wipe-reinstall, and replica count is 1 — backups
      are the only redundancy.
      ⚠️ Never add a Talos `UserVolumeConfig` for Longhorn while the
      `/var/lib/longhorn` kubelet bind exists (mount masking,
      siderolabs/talos#13069).

## Order of moves

Dependency-ordered; each block is one commit/PR.

1. **cert-manager** (`infra-certmanager`) — no state, copy to talos-staging
   (do NOT remove from k3s: pruning deletes its CRDs and breaks the barman
   plugin certificates there). ✅ done 2026-06-10
2. **CNPG plugin + operator + ARC controller** (`infra-cnpg-plugin`,
   `infrastructure-controllers`, `infra-arc-controller`) — stateless, copy;
   needs `sops-age` (decryption) on Talos first. ✅ done 2026-06-10
   **Monitoring moved here too** (originally step 8): cnpg's chart needs the
   PodMonitor CRD + monitoring namespace from kube-prometheus-stack. The
   monitoring namespace needs privileged PSA labels on Talos (node-exporter).
   ✅ done 2026-06-10
3. **Databases (the only real data migration)** ✅ done 2026-06-10 —
   asp-db seeded on Talos via barman recovery from the k3s archive
   (`serverName: asp-db`), now archiving to its own path
   (`serverName: asp-db-talos`), first backup completed; row counts verified
   (listings=22800). fbref-db had zero rows on k3s → fresh initdb on Talos,
   nothing migrated. Gotcha hit: after freezing writers, the end-of-backup
   checkpoint WAL segment was never archived (no traffic → no segment
   switch) — recovery fails with "could not locate required checkpoint
   record" until you run `CHECKPOINT; SELECT pg_switch_wal();` on the source.
   Original per-cluster steps, kept for production reference (historical: the
   production tree was deleted 2026-09-15 and no production migration is planned):
   - [ ] Trigger + verify a fresh barman-cloud backup to R2 on k3s
         (`kubectl get backups.postgresql.cnpg.io`, check R2 object timestamps).
   - [ ] Scale app writers down on k3s (avoid writes after the backup).
   - [ ] Deploy the CNPG cluster on Talos with `bootstrap.recovery` from the
         R2 backup (see doc 03 for barman object store layout). PVCs land on
         Longhorn automatically (default class).
   - [ ] Verify row counts / latest timestamps match before deleting the k3s
         cluster resources.
4. **Apps** (`apps`, `db-migrations` + GitRepository sources,
   ghcr pull secrets) — after their databases are on Talos.
   ✅ done 2026-06-10 — db-migrations/apps reuse the ./apps/staging paths;
   Flyway ran clean against the recovered asp-db. `asp-deploy-key` was
   recreated out-of-band on Talos (k3s secret unreachable) — its public key
   must be a read-only deploy key on the asp repo.
   audiobookshelf/glpi/linkding/keycloak overlays render no workloads yet
   (scaffolding) — same as on k3s, nothing migrated.
5. **Nexus** ✅ done 2026-06-10 — fresh deploy on Longhorn (80Gi), chart
   value `persistence.storageClass` flipped local-path → longhorn in base.
   Caches re-fill from upstream; first CI runs slow.
6. **ARC runner set** ✅ done 2026-06-10 — plain move (single-cluster
   constraint: no scale-set name conflict possible).
7. **Cloudflare tunnel** ✅ done 2026-06-10 — plain move, connected from
   Talos (k3s off, no overlap).
8. **Monitoring** — already copied at step 2 (CRD dependency). Both clusters
   alert to the same Telegram group until k3s is decommissioned.
9. **Renovate** ✅ done 2026-06-10 — hourly CronJob scheduled on Talos.

## Scraper proxy path (tailscale lane) — fixed 2026-06-11

The leboncoin "tailscale" proxy lane (`apps/staging/asp/release.yaml`,
`http://100.100.98.5:8888` = tinyproxy on rbp-asp, a tailnet member) needs a
LAN→tailnet path. The chain, end to end:

- **Talos machine config** (`bootstraping/controlplane.yaml`,
  `machine.network.interfaces`): static route `100.64.0.0/10` via
  `192.168.1.200` (the Proxmox **host**, which runs the only tailscaled +
  advertises `192.168.1.0/24`; `net.ipv4.ip_forward=1` there).
- **rbp-asp** (proxy host): `sudo tailscale up --accept-routes --hostname=rsp-asp --ssh`
  — without accept-routes it has no return route to `192.168.1.x` and SYNs
  blackhole (symptom: playwright `Page.goto: Timeout`).
- **tinyproxy** on rbp-asp: `Allow 192.168.1.0/24` in
  `/etc/tinyproxy/tinyproxy.conf` (symptom otherwise:
  `NS_ERROR_PROXY_FORBIDDEN` / `403 Access denied`). Gotcha: a failed
  `systemctl restart` can leave the OLD process holding the port
  (`Could not create listening sockets`, status=71) — `pkill tinyproxy`
  then restart.

## Decommission k3s

- [x] All entrypoints moved (2026-06-11).
- [x] R2 backups: Talos asp-db archives to `asp-db-talos`; the k3s history
      stays under `asp-db` in the same bucket. NOTE: nothing manages the old
      `asp-db` path anymore — its objects linger until manually pruned from
      R2 (keep until confident, then delete).
- [x] `clusters/staging/` deleted from the repo (2026-06-11). Local
      `age.agekey` + `.envrc` moved to `clusters/talos-staging/`; the k3s
      kubeconfig backed up to `~/k3s-staging-kubeconfig.bak`.
- [x] k3s VM deleted from Proxmox (2026-06-11).
- [x] GitHub `homelab_v1` deploy keys: stale k3s key deleted 2026-06-11 via
      API (matched by public key — titles lie after the rename: the LIVE key
      is still titled `...talos-staging`). A `./clusters/production` key from
      2026-06-02 remains — review whether production is still planned.
      (2026-09-15: it is not; the production tree was deleted from the repo,
      and that deploy key is no longer registered on `homelab_v1`.)
- [x] GitHub `asp` deploy keys: only the live Talos key exists.
- [x] `~/k3s-staging-kubeconfig.bak` deleted (2026-06-11).

## Afterwards

✅ Renamed `clusters/talos-staging` → `clusters/staging` (2026-06-11) without
re-bootstrapping: `git mv` + edit the path in `gotk-sync.yaml` + patch the
in-cluster `flux-system` Kustomization to the new path before/with the push
(otherwise Flux loses its own path and can never read the fix). The existing
deploy key keeps working — only its title still says `talos-staging`
(cosmetic). The `apps/talos-staging/` overlay dir intentionally keeps its
name (renaming it into `apps/staging/` would collide with the k3s-era
databases overlay still there — separate cleanup).
