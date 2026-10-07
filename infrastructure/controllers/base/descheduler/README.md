# descheduler

The [descheduler](https://github.com/kubernetes-sigs/descheduler) moves running
pods off nodes whose resources are over-requested, so the scheduler can place them
again on a node with room. The Kubernetes scheduler only chooses a node when a pod
is created and never moves it afterwards; the descheduler is the part that does.

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Namespace `descheduler`, PodSecurity `restricted` (enforce, audit, warn). The chart's pod already satisfies it once `podSecurityContext.seccompProfile` is set. |
| `repository.yaml` | `HelmRepository` `descheduler`, `https://kubernetes-sigs.github.io/descheduler/`. |
| `release.yaml` | `HelmRelease` `descheduler`, chart `0.36.0`, as a **CronJob every 20 minutes**, one profile with one strategy, `LowNodeUtilization`. |

Flux drives it from `clusters/staging/infrastructure.yaml`, Kustomization
`infra-descheduler` (`wait: true`, 5 minute timeout, no dependencies).

## Why it is like this

**Why it exists** (2026-10-06). The rolling reboot for the etcd timing change
drained node-2 last. Everything evicted from it landed on node-1 and node-3 and
stayed there: node-1 ended at 99% of its memory requested, node-3 at 99% of its CPU,
node-2 at 30–38%. A pod rescheduled onto node-1 or node-3 then had nowhere to go,
and node-3's disk — shared by etcd — carried 2.3× node-2's writes. Every reboot,
drain or node failure produces the same skew; this undoes it within 20 minutes.

**`LowNodeUtilization` on requests, 50/80.** A node is *under*-utilized when every
one of CPU and memory is below 50% requested, and *over*-utilized when any one is
above 80%. Pods are evicted from over-utilized nodes, lowest priority and
BestEffort first, until they drop below 80% or the under-utilized nodes reach it.
It uses requests, not live usage: the scheduler places by requests, so balancing
anything else would fight it. With all three nodes between 50% and 80% it does
nothing.

**What it never touches:**

- **Pods with a PVC** (`podProtections.extraEnabled: PodsWithPVC`). Every CNPG
  instance, Dagger, Nexus, Harbor, Loki, Prometheus, AzuraCast. Their volumes are
  node-local or have their own failover, and moving them is a storage operation,
  not a scheduling one.
- **DaemonSet pods, static pods, bare pods and system-critical pods** — the
  evictor's defaults. That covers the storage and network DaemonSets and the
  control plane.
- **Pods younger than 30 minutes** (`minPodAge`), so a pod just placed is not
  evicted again on the next run.
- **Pods that would not fit elsewhere** (`nodeFit: true`).
- **Excluded namespaces**: the platform (`kube-system`, `flux-system`,
  `piraeus-datastore`, `seaweedfs`, `cnpg-system`, `cert-manager`, `tailscale`,
  `descheduler`), CI (`arc-systems`, `arc-runners`, `dagger`, `nexus`, `registry`,
  `renovate` — an evicted runner or Renovate pod fails its job), the dev platform
  (`dev-platform`, whose pods belong to the vcluster syncer), and the public or
  single-replica front ends (`identity`, `cloudflare`, `azuracast`, `fbref`, `asp`,
  `advisor`), where an eviction is a visible outage.

What remains movable is mostly the scraper (engine-workers and solvers — the bulk
of the skew), kyverno, keda, the database tools, ai-gateway, n8n's renderer and
similar stateless pods.

**`emptyDir` pods are evictable** (`defaultDisabled: PodsWithLocalStorage`). The
scraper's workers use `emptyDir` scratch space; protecting them would leave nothing
worth moving. An `emptyDir` is lost on eviction by definition.

**A PodDisruptionBudget is respected.** Evictions go through the Eviction API, so a
workload with a PDB is never taken below it.

**Only `LowNodeUtilization`.** The chart's default profile also enables
`RemoveDuplicates` (spreads replicas of one owner one-per-node — with 15 scraper
workers on three nodes it would evict forever), `RemovePodsHavingTooManyRestarts`
(would evict crash-looping pods instead of letting them be seen), and the affinity,
taint and topology strategies. None of them addresses a problem this cluster has.

## Traps

- **The chart version must track the Kubernetes minor.** Descheduler `0.N` is built
  and tested against Kubernetes `1.N`. Bump it with the Talos/Kubernetes upgrade,
  not on its own.
- **`dry-run: true` was the first rollout.** The first run only logged what it
  would evict; it was removed once the log matched expectations. Re-enable it to
  preview a policy change.
- **The thresholds are percentages of allocatable**, which the kubelet's
  `kubeReserved` and eviction thresholds shrink (`bootstraping/README.md`). A
  change there moves every node's percentages.
- **`limits.cpu: null` is deliberate.** The chart defaults to a 500m CPU limit; the
  pod runs for seconds and is throttled for nothing.
- **A namespace added later is evictable by default.** If a new workload must
  never move, give it a PVC, a PDB, or add its namespace to `exclude`.

## Operating it

```bash
# what did the last run do?
kubectl -n descheduler logs job/$(kubectl -n descheduler get jobs -o name --sort-by=.metadata.creationTimestamp | tail -1 | cut -d/ -f2)
# run it now instead of waiting for the schedule
kubectl -n descheduler create job --from=cronjob/descheduler descheduler-manual-$(date +%s)
# requested resources per node, which is what it balances
kubectl describe nodes | grep -A6 'Allocated resources'
```

An eviction logs `"Evicted pod" pod="ns/name" reason="..."`; a dry run logs the
same line with `dryRun=true`.
