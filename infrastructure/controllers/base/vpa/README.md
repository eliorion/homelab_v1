# vpa

The Fairwinds [Vertical Pod Autoscaler](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
chart, installed **recommender only**. It watches real container usage and writes a
suggested request per container into `VerticalPodAutoscaler` objects. It changes
nothing in the cluster.

**VPA recommends; Git controls; Flux applies.** A request only changes through a PR
to this repo (or the asp repo for its charts).

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Namespace `vpa`, PodSecurity `restricted`. |
| `repository.yaml` | `HelmRepository` `fairwinds`, `https://charts.fairwinds.com/stable`. Shared with `infrastructure/services/base/goldilocks`, which references it from `flux-system`. |
| `release.yaml` | `HelmRelease` `vpa`, chart `5.1.0`. CRDs installed and upgraded (`CreateReplace`). |

Flux drives it from `clusters/staging/infrastructure.yaml`, Kustomization `infra-vpa`
(`wait: true`). `infrastructure-services` depends on it, because Goldilocks creates
`VerticalPodAutoscaler` objects and fails without the CRD.

## Why it is like this

- **Updater and admission controller are off.** They are the two components that can
  evict a pod or rewrite its request. With neither deployed, nothing here can touch a
  workload, whatever a VPA object says. Every VPA object is also `updateMode: Off`
  (Goldilocks' default).
- **metrics-server is off**: it already exists in the cluster.
- **History is in memory plus checkpoint CRs.** The recommender does not read
  Prometheus. After a restart it rebuilds from the `VerticalPodAutoscalerCheckpoint`
  objects. The cadvisor label mapping needed for Prometheus history is fragile, so it
  is not wired.
- **Floors** (`pod-recommendation-min-*` 15m / 100Mi) stop it recommending below what a
  process needs to start.
- **Scope is every namespace**, observe only (Goldilocks `on-by-default`).

## Reading the recommendations

```bash
export KUBECONFIG=<staging kubeconfig>
kubectl get vpa -A -o json | jq -r '
  .items[] | . as $v | .status.recommendation.containerRecommendations[]? |
  [$v.metadata.namespace, $v.spec.targetRef.name, .containerName,
   .target.memory, .upperBound.memory, .target.cpu] | @tsv'
```

`target` is the suggested request, `upperBound` the level above which the container
has almost never needed more. The Goldilocks dashboard (tailnet host `goldilocks`)
shows the same, per namespace, with ready-to-paste YAML.

## Review process (nothing is applied automatically)

1. **Wait for a 7–14 day baseline.** Earlier numbers are noise: a pod that has not yet
   seen its weekly peak is under-estimated.
2. **Compare with peaks, OOM kills and restarts** (Prometheus), not with VPA alone.
   Treat critical and stateful workloads conservatively.
3. **Memory request = VPA `target`; memory limit at or above `upperBound`.** Set limits
   separately from requests. **No CPU limit.**
4. **Keep a 15–20% memory reserve per node**: requests on any node stay at about 82%
   or less of allocatable.
5. **Raises must be net-neutral against trims.** Many workloads are under-requested
   (the scheduler believes nodes are emptier than they are); raising them without
   trimming others would overcommit the scheduler's view and leave pods Pending.
6. **One namespace per PR, about 3 workloads at most.** Watch OOMKilled and restarts
   for 48 h. Rollback is `git revert`.

## Do not apply recommendations to

- CNPG database pods: sized with the cluster spec and hibernation, not by a ratio.
- `solver-*` (FlareSolverr) pods: 2560Mi on purpose, one session per pod.
- dagger engine: already sized deliberately (10Gi request).
- `kube-system`, LINSTOR, SeaweedFS: stateful or node-critical.
