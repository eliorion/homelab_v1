# Cluster health, October 2026 — etcd, node-1 memory, write amplification

A read-only health check on 2026-10-06 traced most of the week's noise to two
causes, and a third that made the first worse:

1. **etcd lost its leader 311–445 times in 7 days**, none before 10-01 23:00 UTC.
   Every leader-elected controller restarted when its lease ran out: linstor-csi
   632 times, linstor-controller 154, cnpg 155, keda 152, kyverno 50–90 each.
   WAL fsync p99 was 15 ms on node-1's NVMe and 64–95 ms on node-2/3, whose
   single Samsung 840 SATA SSD carries both `EPHEMERAL` (etcd) and the LINSTOR
   pool.
2. **The Talos OOM controller fired 1346 times on node-1 in 7 days** and killed
   the storage stack instead of the workloads using the memory. Talos ranks
   victims with `memory_max.hasValue() ? 0.0 : <QoS weight> * memory_current`,
   so every cgroup with a memory limit is immune. Dagger, the scraper's workers
   and the CI builds all have limits; LINSTOR, SeaweedFS, cilium-envoy and
   node-exporter were BestEffort.
3. **fbref-db and asp-db wrote every commit twice to each 840.** Two CNPG
   instances, each on a two-replica DRBD volume, all replicas on node-2/3.

Public endpoints stayed at 99.9–100% throughout; the damage was internal.

## What changed

| Area | Change | Where |
|---|---|---|
| etcd | `heartbeat-interval: 500`, `election-timeout: 5000` (defaults 100/1000) | `bootstraping/talconfig.yaml`, why in `bootstraping/README.md` |
| OOM immunity | Namespace `LimitRange` (32Mi request / 256Mi limit) in `piraeus-datastore` and `seaweedfs`, explicit sizes for the JVMs, volume servers, S3, filer, mount, `seaweedfs-db`; limits on cilium-envoy and node-exporter | `infrastructure/controllers/base/{linstor,seaweedfs}/README.md` |
| Kubelet | `evictionSoft memory.available: 2Gi` (30s), `evictionHard: 1Gi` (all five signals kept), `kubeReserved memory: 1Gi`; kube-apiserver requests 2Gi | `bootstraping/talconfig.yaml` |
| Write amplification | `ssd-cnpg` class (one local replica); fbref-db and asp-db moved to it, pinned to node-2/3, one instance per node | `infrastructure/controllers/base/linstor/README.md`, `apps/base/databases/fbref/README.md` |
| CPU requests | Lowered to measured use (below) | this document |
| CI placement | Soft `topologySpreadConstraints` on both ARC runner pools | `infrastructure/services/staging/arc-runner-set/README.md` |

Dagger and the scraper were left unchanged on purpose.

## CPU requests: why they were lowered

node-2 and node-3 sat at 93% and 95% of their CPU requested, so the scheduler
put every new pod on node-1 — the node already short of memory. Usage was a small
fraction of the requests. Each request was set to roughly the 7-day p95 of
`rate(container_cpu_usage_seconds_total[5m])`, rounded up, with a 10m floor.
Requests only steer scheduling; none of these containers gained a CPU limit.

| Workload | Node | Request before → after | 7-day p95 |
|---|---|---|---|
| seaweedfs worker | node-2 | 500m → 10m | 0m |
| ARC controller | node-2 | 500m → 10m | 2m |
| keycloak ×2 | node-2, node-3 | 500m → 50m | 1m |
| keycloak-operator | node-3 | 300m → 20m | 2m |
| paperclip | node-3 | 500m → 100m | 47m |
| nexus | node-1 | 500m → 50m | 4m |
| harbor trivy | node-3 | 200m → 10m | 0m |
| nextcloud | node-2 | 200m → 20m | 2m |
| n8n | node-2 | 200m → 20m | 4m |
| n8n svg-render | node-2 | 100m → 10m | 0m |
| ai-gateway (bifrost) | node-3 | 200m → 20m | 3m |
| kyverno admission ×3 | node-2 | 100m → 20m | 8m |
| kyverno background ×2, cleanup ×2 | node-2/3 | 100m → 10m | 4m |
| keda operator, metrics server, webhooks | node-2 | 100m → 10m | 3m |

kyverno's reports controller (p95 76m) kept its 100m. A workload that starts
slowly after this (Keycloak's Quarkus boot is the likely one) competes for idle
CPU like any other; raise its request only if it measurably misses a probe.

## Rollout order, and what needs a reboot

1. etcd timing: rendered and applied to all three nodes with `--mode=no-reboot`.
   **It is inert until each node reboots** — Talos stores the new `EtcdSpec` but
   never restarts etcd for it. Reboot one node at a time with the procedure in
   `bootstraping/README.md` ("How it was rolled out").
2. Flux: memory limits, CPU requests, ARC spread, the `ssd-cnpg` class and the
   fbref/asp patches. The affinity change rolls both instances of each cluster
   with a switchover. The SeaweedFS CSI mount and node pods are `OnDelete` and
   need a manual, per-node restart (`infrastructure/controllers/base/seaweedfs/README.md`).
3. Kubelet and apiserver: `apply-config --mode=no-reboot`, one node at a time.
   Kubelet restarts; the apiserver on that node restarts (~30 s).
4. fbref-db and asp-db re-clone onto `ssd-cnpg`, one instance at a time,
   **after the etcd reboots** — a re-clone writes the whole dataset (fbref 107G)
   to one 840. Procedure in `apps/base/databases/fbref/README.md`.

## Rollout log, 2026-10-06

- **13:55–14:25 memory limits.** All 36 pods in `piraeus-datastore` and
  `seaweedfs` came up Burstable with limits. The operator-generated LINSTOR pods
  only pick up the `LimitRange` when recreated, so they were deleted one at a
  time; the SeaweedFS CSI mount and node pods node by node (node-2, node-1 with
  the two lab pods, node-3 with AzuraCast, ~1 min of stream).
- **SeaweedFS rolled back once.** `seaweedfs-db`'s new resources rolled the
  database with a switchover while the filer restarted; the filer died in
  `LoadConfiguration`, Helm marked it failed and rolled back. Flux's retry
  succeeded. Trap recorded in `infrastructure/controllers/base/seaweedfs/README.md`.
- **Harbor rolled back until `Recreate`.** Lowering trivy's request rolled
  jobservice, whose RWO volume could not attach on its new node. Fixed with
  `updateStrategy.type: Recreate` plus a one-time strategy patch
  (`infrastructure/services/base/harbor/README.md`).
- **CPU requests:** node-2 93% → 66%, node-3 95% → 66%.
- **Kubelet/apiserver:** applied 14:50, no pod rejected on admission; node-1
  allocatable 28.5 GiB against 26.8 GiB requested.
- **Reboots 14:52–15:28**, node-1, node-3, node-2. Cordoning a node makes CNPG
  switch every primary on it to a ready replica elsewhere within a minute, so no
  manual `targetPrimary` patch was needed. Clusters with **both** instances on the
  node being cordoned (paperclip-db, seaweedfs-db on node-3; nextcloud-db on
  node-2 — replicas recreated while another node was cordoned) need the replica
  pod deleted first so it reschedules. A `targetPrimary` patch with an empty
  value makes CNPG restart the primary in place: paperclip-db and seaweedfs-db
  were down ~5 s at 15:04:44 because of one.
- **The e2e-0 vcluster stacks did not survive the reboots**: their CNPG
  instances ended `Completed` and the apps cannot reach the database. The nightly
  rebuild redeploys them (`documentations/19-dev-platform.md`).
- **fbref-db and asp-db affinity (15:31–15:35)** restarted each primary in place
  (`primaryUpdateMethod: restart`, the CNPG default) instead of switching over;
  both primaries were on node-1, outside the new node pin, so writes stopped for
  ~3 minutes while they were rescheduled.
- **Re-clones onto `ssd-cnpg`**: asp-db 15:35–15:52, about 8 minutes per 16G
  instance; fbref-db 15:53–17:24, about 45 minutes per 107G instance, each
  switchover ~25 s. Zero etcd leader changes throughout, with WAL fsync p99 at
  1.1–1.5 s on node-2/3 under the clone load. While fbref-db ran one instance,
  the `databases` Kustomization (`wait: true`) held `db-migrations` and `apps`.

## How to tell it worked

```promql
increase(etcd_server_leader_changes_seen_total[24h])        # flat after the reboots
histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m]))
increase(kube_pod_container_status_restarts_total{namespace=~"piraeus-datastore|cnpg-system|keda|kyverno"}[24h])
```

```bash
talosctl -n 192.168.1.101 get oomactions | wc -l             # stops growing
kubectl get pods -n piraeus-datastore -o custom-columns=N:.metadata.name,QOS:.status.qosClass
```

## Not done here

Backups for the CNPG clusters without one (seaweedfs-db first), the Talos
1.13.10 upgrade, node-1's thin pool, asp-db's size, the AzuraCast `Errno 28`
(it comes from supervisord writing `icecast.log` and `liquidsoap.log` onto the
SeaweedFS mount), dagger's and the scraper's memory requests.
