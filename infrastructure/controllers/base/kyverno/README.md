# kyverno

Kyverno is the cluster's admission policy engine. It exists for one consumer that
does not exist yet: the guardrails of the upcoming `dev` tier, where preview
namespaces get per-namespace quotas, RBAC and admission limits generated and
enforced automatically, and later (Phase 6) image signature verification. This
directory installs **the controller and its CRDs only** — there is no policy here,
and the `kyverno-policies` chart is deliberately not installed.

Chart `kyverno` `3.9.1` (Kyverno `v1.19.1`) from the upstream
`https://kyverno.github.io/kyverno/` repository, installed as a Flux `HelmRelease`
into the `kyverno` namespace.

**Policy rule for everything that follows: CEL policy types only.** Write
`policies.kyverno.io/v1` objects — `ValidatingPolicy`, `MutatingPolicy`,
`GeneratingPolicy`, `ImageValidatingPolicy` (and their `Namespaced*` variants,
`DeletingPolicy`, the `policies.kyverno.io` `PolicyException`). **Never add a
`ClusterPolicy` or `Policy`.** Upstream deprecated them in v1.19 and removes them
in v1.20, together with `CleanupPolicy`/`ClusterCleanupPolicy` and the legacy
`kyverno.io` `PolicyException`. The decision record is in
[`documentations/14-design-decisions.md`](../../../../documentations/14-design-decisions.md#kyverno-with-cel-policy-types-only-for-the-preview-guardrails).

## How it is wired

| File | What it does |
|---|---|
| `kustomization.yaml` | `namespace.yaml`, `repository.yaml`, `release.yaml`. |
| `namespace.yaml` | The `kyverno` namespace, labelled PSA `enforce`/`audit`/`warn: restricted`. |
| `repository.yaml` | `HelmRepository/kyverno` in `flux-system`, 24h interval. |
| `release.yaml` | `HelmRelease/kyverno` in `flux-system`, `targetNamespace: kyverno`, `releaseName: kyverno`, chart pinned to `3.9.1`, 30m reconcile / 12h chart interval, `install.createNamespace: false`, `install.crds: Create`, `upgrade.crds: CreateReplace`, install and upgrade `remediation.retries: 3` (upgrade `strategy: rollback`). Values: replicas, the admission PDB, ServiceMonitors off, webhook namespace exclusions. |

Flux applies it through its own Kustomization, `infra-kyverno`, in
`clusters/staging/infrastructure.yaml`: `path: ./infrastructure/controllers/base/kyverno`,
`interval: 1h`, `retryInterval: 1m`, `timeout: 10m`, `prune: true`, `wait: true`,
health-gated on the `kyverno-admission-controller` and
`kyverno-background-controller` Deployments in `kyverno`. No `decryption` block:
nothing here is a secret. It hangs off the root `flux-system` Kustomization with no
`dependsOn` (see below).

What the release creates, from `helm template` of the pinned chart with these values:

| Deployment | Replicas | Requests / limit (chart defaults) | PDB |
|---|---|---|---|
| `kyverno-admission-controller` | 3 | 100m, 128Mi / 384Mi | `minAvailable: 1` |
| `kyverno-background-controller` | 2 | 100m, 64Mi / 128Mi | `minAvailable: 1` |
| `kyverno-cleanup-controller` | 2 | 100m, 64Mi / 128Mi | `minAvailable: 1` |
| `kyverno-reports-controller` | 2 | 100m, 64Mi / 128Mi | `minAvailable: 1` |

That is 900m CPU and 768Mi memory requested in total. Plus 22 CRDs, the `kyverno`
and `kyverno-metrics` ConfigMaps, and three hook Jobs: `kyverno-migrate-resources`
(post-upgrade, rewrites stored objects to the current CRD storage version) and
`kyverno-rm-webhooks` / `kyverno-scale-to-zero` (pre-delete). The chart renders
**no** webhook configuration: the admission and cleanup controllers register their
own at runtime, and with zero policies they are:

| Configuration | failurePolicy | Matches |
|---|---|---|
| `kyverno-policy-validating-webhook-cfg`, `kyverno-exception-…`, `kyverno-cel-exception-…`, `kyverno-global-context-…`, `kyverno-cleanup-validating-webhook-cfg` | `Fail` | Kyverno's own policy, exception and global-context CRs only |
| `kyverno-policy-mutating-webhook-cfg` | `Fail` | Kyverno policy CRs only |
| `kyverno-verify-mutating-webhook-cfg` | `Ignore` | objects labelled `app.kubernetes.io/name: kyverno` |
| `kyverno-ttl-validating-webhook-cfg` | `Ignore` | objects carrying the `cleanup.kyverno.io/ttl` label |
| `kyverno-resource-validating-webhook-cfg`, `kyverno-resource-mutating-webhook-cfg` | — | **empty** until a policy exists |

Images: `reg.kyverno.io/kyverno/*:v1.19.1` for the controllers and the migration
hook, `ghcr.io/kyverno/readiness-checker` for the pre-delete hooks. `reg.kyverno.io`
has no Harbor mirror in `bootstraping/talconfig.yaml`, so those pulls go direct.

### Overlays

None. Neither `infrastructure/controllers/staging/kustomization.yaml` nor the
production one lists `kyverno/`; `infra-kyverno` points at the base, and
`clusters/production/infrastructure.yaml` does not declare it at all.

## Why it is like this

**Why Kyverno, and why CEL types only.** The dev tier needs three things from an
admission engine: validate objects in preview namespaces, *generate* per-namespace
objects (ResourceQuota, LimitRange, RoleBinding, NetworkPolicy) when a preview
namespace appears, and later verify image signatures. Native
`ValidatingAdmissionPolicy` covers the first only. Kyverno's CEL types cover all
three with the same CEL expression language VAP uses, and they are the only types
upstream will still ship after v1.20. The `policies.kyverno.io` types have served
`v1` since Kyverno 1.17; in 1.19 their storage version is still `v1beta1` and moves
to `v1` in 1.20 (see Upgrading). The background controller's default ClusterRole
already grants create/update/delete on `resourcequotas`, `limitranges`, `roles`,
`rolebindings` and `networkpolicies`, so those generating policies need no extra
RBAC values; a RoleBinding that grants more than the controller holds still needs
RBAC escalation rights, which is the consuming PR's problem.

**Why `3.9.1` / `v1.19.1`, and the Kubernetes 1.36 gap.** It is the newest stable
chart, and the only minor line whose code targets Kubernetes 1.36. Kyverno's
published compatibility matrix (`kyverno.io/docs/installation/releases`) still lists
**1.33–1.35** for v1.19, and most of its conformance CI runs on kind 1.33–1.35.
What does target 1.36, all in the `v1.19.1` tag: kyverno/kyverno#16703 (milestone
1.19.0) bumps `k8s.io/*` to the 1.36 line (`v0.36.3` in `go.mod`), adds
`MutatingAdmissionPolicy` `v1` discovery — the API that went GA in 1.36 and made
Kyverno 1.18 exit at startup on 1.36 clusters (kyverno/kyverno#16262) — and adds
two conformance jobs pinned to kind `v1.36.1`. v1.18 is therefore not an option on
this cluster, and v1.19 is supported on 1.36 in code but not yet on paper. Re-check
the matrix before bumping.

**Why the namespace is `restricted`.** The Talos default is
`enforce: baseline` with `warn`/`audit: restricted`, so a `baseline` label would
change nothing. Every pod the chart renders — the four Deployments, the three hook
Jobs and the five `helm test` Pods — sets `runAsNonRoot`, `allowPrivilegeEscalation:
false`, `capabilities.drop: [ALL]` and `seccompProfile: RuntimeDefault` at container
level, uses only `emptyDir`/`configMap`/`secret`/`projected` volumes, and no host
namespaces or ports. That was checked against the rendered templates, then proven
by a full install and upgrade into a `restricted`-labelled namespace on a scratch
k3d cluster with no admission rejection. The v1.19.1 controllers mint no pods of
their own from templates outside git (the cleanup controller source creates no
CronJobs, although upstream's HA guide still says it does), which is the condition
`keda`'s namespace sets for opting in. If a future version starts minting pods,
re-check before bumping.

**Why `install.createNamespace: false`.** `namespace.yaml` is the only place the PSA
labels exist. If the namespace is ever missing, the install should fail loudly
rather than let Helm create an unlabelled namespace.

**Why `releaseName: kyverno`.** Without it Flux names the release `kyverno-kyverno`,
and the chart's `fullname` — which names the `kyverno` ConfigMap, the metrics
ConfigMap and the hook Jobs — follows it, so every upstream troubleshooting command
(`kubectl -n kyverno get cm kyverno`) would name the wrong object. The Deployment
names are built from the chart name and do not depend on it.

**Why these replica counts.** They are upstream's HA install
(`admissionController.replicas=3`, background, cleanup and reports at 2). The
admission controller serves webhooks active-active, and three is upstream's minimum
supported HA count; the chart's *preferred* pod anti-affinity asks for one per node
here, but does not guarantee it. The background and reports controllers are leader-elected, so their
second replica is a warm standby, not throughput; the cleanup controller serves its
own webhook and scales out. The admission PDB is set explicitly because the chart
only creates PDBs implicitly when `replicas > 1`, which its own values file calls
non-declarative behaviour it would like to remove; the other three PDBs still come
from that implicit rule. `minAvailable: 1` lets a single node drain proceed.

**Why no `dependsOn`.** Kyverno needs nothing another Kustomization provides: it
mints its own CA and serving certificates into Secrets in `kyverno` (cert-manager
integration is off by default and not used), claims no storage, and with the
ServiceMonitors off it needs no CRD from the monitoring tier. Its images do not come
through the in-cluster Harbor. The dependency runs the other way: the future policy
Kustomization must declare `dependsOn: infra-kyverno`, because policies need these
CRDs and are validated by a `Fail` webhook that rejects them while the admission
controller is down.

**Why the ServiceMonitors are off.** The chart renders `monitoring.coreos.com/v1`
ServiceMonitors with no capability check. The CRD comes from kube-prometheus-stack,
which sits downstream of `infrastructure-controllers`; inside this `wait: true`
Kustomization a ServiceMonitor would fail `no matches for kind` on every cold
bootstrap until the monitoring tier exists. The chart defaults are already `false`;
`release.yaml` states them so nobody flips one. Scraping, when wanted, is a
`PodMonitor` under `monitoring/configs/staging/`, the way `cilium-metrics` and
`cert-manager` do it. The metrics Services exist already.

**Why these webhook exclusions, and why two settings.** Two independent layers skip
`kube-system`, `kyverno` and `flux-system`:

- `config.webhooks.namespaceSelector` lands in the `kyverno` ConfigMap `webhooks`
  key, and Kyverno merges it into every resource webhook it registers — including the
  per-policy webhooks of the CEL types (`resolveNamespaceSelector` in
  `pkg/controllers/webhook/validating.go`). The API server evaluates it, so for those
  namespaces **no AdmissionReview is ever sent** and a dead Kyverno cannot block
  them. Verified on the scratch cluster: a `v1` `ValidatingPolicy` denied a labelled
  ConfigMap in an ordinary namespace and admitted the same object in `flux-system`
  and `kube-system`. The chart appends its own `NotIn [kyverno]` expression
  (`excludeKyvernoNamespace: true`), so the rendered selector carries `kyverno`
  twice; the redundancy is harmless and keeps the full set readable in one place.
- `config.resourceFiltersIncludeNamespaces` appends `[*/*,flux-system,*]` to the
  in-engine `resourceFilters` (which already hold `kube-system` and the `kyverno`
  namespace). That covers work that does not arrive through a webhook —
  generating/mutate-existing processing in the background controller.

`kube-system` holds the control plane and the CNI. `kyverno` must be able to
restart its own pods. `flux-system` is the recovery path: if a Kyverno outage could
block Flux's own objects, the fix would sit in a repository Flux cannot apply — the
shape of the 2026-06-12 Cilium incident in
[`documentations/08`](../../../../documentations/08-cilium-cni-ingress-migration.md).
The exclusion covers objects **in** `flux-system`, not objects Flux applies into
other namespaces; those are judged by their own namespace, which is the point.

## Blast radius

A validating or mutating webhook with `failurePolicy: Fail` turns a Kyverno outage
into an admission outage for everything it matches. Today, with no policies, that
is only Kyverno's own CRs. Each policy added later widens it by its own match:

- **CEL policy types default to `failurePolicy: Fail`** (observed: a
  `ValidatingPolicy` with no `failurePolicy` registered `vpol.validate.kyverno.svc-fail`).
  Preview policies are meant to fail closed and must say so explicitly *and* scope
  themselves with a `namespaceSelector` to the preview namespaces. Anything
  broader sets `failurePolicy: Ignore`.
- **`namespaceSelector` cannot exclude cluster-scoped objects** other than
  `Namespace` itself. A `Fail` policy matching ClusterRoles, CRDs, Nodes or CSRs is
  enforced cluster-wide regardless of the exclusions above, and a policy matching
  Nodes or CSRs can stop a rebooted node from registering while Kyverno's own pods
  cannot schedule (`features.excludeBootstrapResources` exists for that and is off).
- **Latency.** Every matched request pays a round trip to the admission
  controller, 10s webhook timeout. No policy means no resource webhook, so this PR
  adds none.

## Upgrading

- Renovate bumps the chart. Read the Kyverno release notes and
  `kyverno.io/docs/installation/upgrading` for the target version before merging,
  and re-check the compatibility matrix against the cluster's Kubernetes version.
- **v1.20 is a breaking line for policy authors**: `ClusterPolicy`, `Policy`,
  `CleanupPolicy`, `ClusterCleanupPolicy` and the `kyverno.io` `PolicyException`
  are removed, and the `policies.kyverno.io` storage version moves from `v1beta1` to
  `v1`. The chart's `kyverno-migrate-resources` post-upgrade hook rewrites stored
  objects (`crds.migration.enabled`, default on); confirm it completed before the
  following bump drops `v1beta1`. Also watch for `v1alpha1` removal — manifests must
  already be `v1`.
- **CRDs are templates, not a `crds/` directory.** From 1.19 they ship in the
  `kyverno-api` subchart (the `policies.kyverno.io` group) and the `crds` subchart,
  both under `templates/`. Helm upgrades them as ordinary manifests on every
  release, so they always track the chart. `install.crds: Create` and
  `upgrade.crds: CreateReplace` only govern a chart's `crds/` directory; they are
  set for consistency with the other controllers and are no-ops for this chart.
- **The Helm release record is at ~92% of the Secret size limit.** The rendered
  manifest is ~5.9 MB, almost all CRD schema. Measured on the scratch cluster, the
  release Secret for this chart and these values is 960,916 bytes at install and
  961,144 at upgrade, against Kubernetes' 1,048,576-byte cap. A chart bump that adds
  CRDs, or values that switch on extra rendered content (`grafana.enabled`,
  `openreports.installCrds`, `reportsServer.enabled`), can cross it, and the
  install then fails with `Secret "sh.helm.release.v1.kyverno.vN" is invalid: data:
  Too long` (kyverno/kyverno#14378). Before a bump, render with these values and
  compress: `helm template … | gzip -9 | wc -c` gave 627,842 bytes for the 960,916
  stored, so anything above ~680 KB is over the cap. The way out if it is crossed is
  `crds.install: false` with the CRDs applied by their own Kustomization ahead of
  this one.

## Traps

- **Deleting this HelmRelease deletes every Kyverno policy in the cluster.** The
  CRDs are part of the Helm release, so an uninstall — removing the directory,
  removing `infra-kyverno` (`prune: true`), or a release rename — deletes them, and
  the API server cascades that to every object of those kinds. The pre-delete hooks
  remove the webhooks first, so nothing blocks; things just silently stop being
  enforced.
- **Do not change `releaseName: kyverno` after install.** helm-controller treats a
  rename as uninstall-then-install, which is the trap above.
- **`resourceFiltersExcludeNamespaces` is the opposite of what it sounds like.** It
  *removes* matching entries from `resourceFilters`, so listing `kube-system` there
  would make the engine process `kube-system`. Exclusions go in
  `resourceFiltersIncludeNamespaces` and `config.webhooks.namespaceSelector`.
- **`config.webhooks` replaces the chart default as a whole.** Its
  `matchExpressions` list is a list, and Helm does not merge lists: drop
  `kube-system` from `release.yaml` and it is no longer excluded.
- **Never enable a chart `serviceMonitor`** (any of the four controllers): see
  "Why the ServiceMonitors are off".
- **The `infra-kyverno` health checks name `kyverno-admission-controller` and
  `kyverno-background-controller` in `kyverno`.** Renaming via `nameOverride` breaks
  both and the Kustomization never goes Ready.
- **`config.preserve: true` (chart default) marks the `kyverno` ConfigMap
  `helm.sh/resource-policy: keep`.** An uninstall leaves it behind; a reinstall
  adopts it.
- **Watch the 128Mi memory limit on the reports and background controllers** once
  policies exist: report volume scales with matched resources, not with policy
  count. Raise the limit in `release.yaml` if either is `OOMKilled`.

## Operating it

Render and reconcile:

```sh
kubectl kustomize infrastructure/controllers/base/kyverno
flux get kustomizations infra-kyverno
flux get helmreleases -n flux-system kyverno
```

Controllers and disruption budgets:

```sh
kubectl -n kyverno get deploy,pods,pdb -o wide
kubectl -n kyverno logs deploy/kyverno-admission-controller
```

Webhooks — with no policies the two `resource` configurations report 0 webhooks:

```sh
kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations | grep kyverno
kubectl get validatingwebhookconfiguration kyverno-resource-validating-webhook-cfg \
  -o jsonpath='{.webhooks[*].namespaceSelector}'
kubectl -n kyverno get cm kyverno -o jsonpath='{.data.webhooks}{"\n"}'
```

CRDs — the CEL types must list `v1` among their served versions:

```sh
kubectl get crd | grep policies.kyverno.io
kubectl get crd validatingpolicies.policies.kyverno.io \
  -o jsonpath='{.spec.versions[*].name}{" storage="}{.status.storedVersions}{"\n"}'
```

Release record size (see Upgrading):

```sh
kubectl -n kyverno get secret -l owner=helm,name=kyverno \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.data.release}{"\n"}{end}' \
  | while read -r n d; do printf '%s %s\n' "$n" "$(printf %s "$d" | base64 -d | wc -c)"; done
```
