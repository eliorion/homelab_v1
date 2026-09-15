# dev — per-PR preview guardrails

The `dev` tier hosts per-PR preview environments: one namespace `preview-pr-<n>` per
pull request, each holding one [vcluster](https://www.vcluster.com/) the PR's pipeline
deploys into. At most **3** previews exist at a time.

Previews are **not** Flux objects. The Dagger pipeline creates, upgrades and deletes them
with a short-lived token for `dev-platform/preview-driver`. What this directory owns is
everything that driver must not be able to bypass or delete: the quota, limits, network
policy and RBAC every preview namespace gets, the admission rules around them, and the
reaper that deletes stale previews. Nothing here creates a preview.

Later steps build on it: the preview Gateway `dev-platform/preview` (HL-4), the canary
vcluster `preview-canary` (HL-5), Harbor pull-secret reflection (HL-6) and the human
access group `dagger-devs` (HL-8). The HTTPRoute rules and the `dagger-devs-view`
binding already name those; they are inert until the objects exist.

## How it is wired

Flux applies the directory through its own Kustomization, `dev-platform`, in
`clusters/staging/dev.yaml`: `path: ./infrastructure/services/dev`, `interval: 10m`,
`retryInterval: 1m`, `timeout: 10m`, `prune: true`, `wait: true`, sops decryption, and
`dependsOn` `infrastructure-services`, `infra-kyverno` (the policy CRDs and the `Fail`
policy webhook), `infra-cilium-config` (after Cilium, which brings the
`CiliumNetworkPolicy` CRD) and `infra-reflector` (HL-6). The directory is **not** listed in
`infrastructure/services/staging/kustomization.yaml` and must not be: two
Kustomizations would own the same objects and fight each other's prune.

| Path | What it does |
|---|---|
| `kustomization.yaml` | Lists every file below; generates `preview-reaper-script-<hash>` from `reaper/reaper.sh`. |
| `namespaces.yaml` | `dev-platform` (PSA `enforce: restricted`) and `preview-template` (PSA `restricted`, `preview.eliorion.fr/tier: template`). |
| `priorityclasses.yaml` | `platform-critical` (100000, `PreemptLowerPriority`) and `dev-preview` (-1000, `preemptionPolicy: Never`). |
| `rbac/serviceaccounts.yaml` | `preview-driver`, `preview-reader`, `preview-reaper` in `dev-platform`. |
| `rbac/preview-driver.yaml` | `preview-driver-namespaces` (ClusterRole + binding: namespaces get/list/watch/create) and `preview-driver-namespaced` (ClusterRole, bound per preview namespace; includes get/patch/delete of that Namespace). |
| `rbac/preview-vcluster.yaml` | `preview-vcluster`: the vcluster chart's own Role rules, copied. |
| `rbac/preview-reader.yaml` | `preview-kubeconfig-reader`: get Secret `vc-vcluster` and Service `vcluster`. |
| `rbac/preview-reaper.yaml` | `preview-reaper` ClusterRole + binding: namespaces get/list/watch; `preview-reaper-delete` (namespaces delete), bound per preview namespace. |
| `rbac/token-mint.yaml` | Role + RoleBinding `preview-token-mint` in `dev-platform` for the ARC runner SA. |
| `rbac/kyverno-background.yaml` | `kyverno:background-controller:preview`, aggregated into Kyverno's background controller. |
| `templates/` | The clone sources, all in `preview-template`: ResourceQuota `preview-quota`, LimitRange `preview-limits`, NetworkPolicies `default-deny` + `same-namespace`, CiliumNetworkPolicies `preview-platform-egress`, `preview-vcluster-api`, `preview-gateway-ingress`. |
| `policies/generate-guardrails.yaml` | GeneratingPolicy `preview-guardrails`: clones `templates/` into every preview namespace, synchronized. |
| `policies/generate-rbac.yaml` | GeneratingPolicy `preview-rbac`: the five RoleBindings of a preview namespace (three in `preview-canary`), synchronized. |
| `policies/namespaces.yaml` | ValidatingPolicy `preview-namespaces`: what driver and reaper may do to Namespaces. |
| `policies/workloads.yaml` | ValidatingPolicy `preview-workloads`: Pod rules. |
| `policies/services-pvcs-routes.yaml` | ValidatingPolicies `preview-services`, `preview-pvcs`, `preview-httproutes`. |
| `policies/priority.yaml` | MutatingPolicy `preview-priority`: forces every preview Pod onto `dev-preview`. |
| `policies/tests/` | `kyverno test` suites (not applied; see Verification). |
| `reaper/` | CronJob `preview-reaper` + `reaper.sh`. |

A "preview namespace" everywhere below means a namespace labelled
`preview.eliorion.fr/tier: preview`. Every policy is scoped to those namespaces with a
`namespaceSelector`, except `preview-namespaces`, which matches Namespace objects and is
scoped to the driver and reaper identities instead.

## Lifecycle of a preview

1. The pipeline, running on the default ARC scale set, uses its pod's own token to call
   `TokenRequest` on `dev-platform/preview-driver` (and reads `kube-root-ca.crt`). That is
   all `preview-token-mint` allows.
2. As `preview-driver` it creates `preview-pr-<n>` with labels
   `preview.eliorion.fr/tier: preview`, `preview.eliorion.fr/pr: "<n>"` and
   `pod-security.kubernetes.io/enforce: baseline`. `preview-namespaces` admits it only if
   the name, labels and the 3-preview cap check out.
3. The namespace CREATE reaches Kyverno's generate webhook, which queues an UpdateRequest;
   the background controller then clones the guardrails and creates the RoleBindings.
   This is **asynchronous** — seconds, not part of the CREATE response.
4. The driver polls `get resourcequota/preview-quota` and `limitrange/preview-limits`
   until both succeed — `forbidden` means `preview-rbac` has not run yet, `NotFound` means
   `preview-guardrails` has not — then installs the vcluster chart (contract below).
5. On every deploy the driver patches `preview.eliorion.fr/last-deployed` (RFC3339 UTC,
   `YYYY-MM-DDTHH:MM:SSZ`), and while e2e tests run it sets
   `preview.eliorion.fr/phase: testing` + `preview.eliorion.fr/phase-since`. Labels
   cannot change after creation; annotations can.
6. The driver deletes the namespace when the PR closes. Anything it misses, the reaper
   deletes after 24h, or sooner if more than 3 exist.

### The vcluster install contract

Rendered against chart `vcluster` **0.37.1** (loft, `https://charts.loft.sh`) at
Kubernetes 1.36. The guardrails admit the chart only with these values; every line is
a guardrail the default would trip:

| Value | Why |
|---|---|
| release name `vcluster` | `preview-kubeconfig-reader`, `preview-vcluster-api` and `preview-rbac` name `vc-vcluster` / `vcluster` / `app: vcluster, release: vcluster`. |
| `rbac.role.enabled: false`, `rbac.clusterRole.enabled: false` | The platform owns RBAC; the driver cannot create Roles and the chart install would fail. |
| `rbac.enableVolumeSnapshotRules.enabled: false` | Its `auto` default turns into `true` without private nodes and makes the chart want a ClusterRole (PVs, VolumeSnapshotClasses/Contents). Off, the chart needs no cluster-scoped RBAC at all. The value only feeds RBAC rendering; snapshot syncing is `sync.toHost.volumeSnapshots`, off by default. |
| `sync.toHost.{networkPolicies,ingresses,priorityClasses}.enabled: false`, `sync.fromHost.{nodes,storageClasses,ingressClasses}.enabled: false`, `policies.{resourceQuota,limitRange,networkPolicy}.enabled: false`, `controlPlane.distro.k8s.enabled: true`, `controlPlane.backingStore.database.embedded.enabled: true` | The shape the `preview-vcluster` rules were rendered for. Changing any of them can change the Role the chart expects. |
| `controlPlane.service.spec.type: LoadBalancer`, `.loadBalancerClass: tailscale`, `.allocateLoadBalancerNodePorts: false` | `preview-services` allows exactly one LoadBalancer, named `vcluster`, class `tailscale`. The quota sets `services.nodeports: 0`, and Kubernetes counts a LoadBalancer's ports against it unless node-port allocation is off. |
| `controlPlane.statefulSet.persistence.volumeClaim.storageClass: ssd-single` | `preview-pvcs` requires it; an empty class is defaulted to `ssd` before the policy runs. |
| `controlPlane.statefulSet.resources.limits.memory` ≤ `2Gi` | The chart default is `4Gi`; `preview-limits` caps a container at `2Gi`. |
| namespace PSA `enforce: baseline` | The syncer container runs as `runAsUser: 0` and the `kubernetes` init container sets no securityContext, so `restricted` rejects the pod. |

Workloads inside a vcluster are synced into the preview namespace as ordinary Pods,
Services and PVCs, so every rule below applies to them too: a tenant PVC must name
`ssd-single` (the vcluster syncs no storage classes), and a tenant LoadBalancer or
NodePort Service fails to sync.

## The guardrails, and why each exists

| Guardrail | What it enforces | Why |
|---|---|---|
| `preview-quota` | cpu requests 4, memory requests 6Gi / limits 16Gi, 80 pods, 40 services, 1 LoadBalancer, 0 node ports, 6 PVCs / 20Gi all on `ssd-single` (0 PVCs on `ssd` or `hdd`), 6 HTTPRoutes | Three previews at the cap cost 12 cores and 18Gi requested at most. `ssd` is the replicated LINSTOR class and `hdd` has two data nodes; a throwaway preview gets neither. |
| `preview-limits` | Container default limit 512Mi, default request 50m / 64Mi, max 2Gi; PVC max 5Gi | A quota on `requests.cpu`/`limits.memory` rejects pods that omit them; defaults let unannotated charts run. |
| `default-deny` + `same-namespace` | All ingress and egress denied except pod-to-pod inside the namespace | A preview runs unreviewed PR code. Cilium ORs every policy that selects a pod, so the CNPs below add the only exits. |
| `preview-platform-egress` | Egress to kube-dns (53, any protocol) and to Harbor's nginx pods on **8443** | DNS, and the in-cluster registry. 8443 is `harbor-nginx`'s TLS `containerPort` (Service `harbor` 443→8443, checked live); Cilium evaluates the post-DNAT port. Not 8080, which is plain HTTP. |
| `preview-vcluster-api` | The vcluster control-plane pod may reach `kube-apiserver` (6443, 443), and accepts 8443 from the `tailscale` namespace and from the Dagger engine (`app.kubernetes.io/name: dagger-helm` in `dagger`) | The syncer drives the host API; the tailnet LoadBalancer proxy and the pipeline reach the virtual API. The selector adds `vcluster.loft.sh/managed-by DoesNotExist`: the syncer copies a tenant pod's labels to the host and adds that marker, so without the exclusion a tenant pod labelled `app: vcluster, release: vcluster` would inherit apiserver egress. |
| `preview-gateway-ingress` | Ingress from Cilium's `ingress` identity | Traffic from the preview Gateway (HL-4) arrives from the Envoy the Gateway API implementation runs. |
| RoleBinding `vcluster` | `preview-vcluster` → SA `vc-vcluster` | The syncer's namespaced rights. |
| RoleBinding `preview-reader` | `preview-kubeconfig-reader` → `dev-platform/preview-reader` | Read the generated kubeconfig and the Service address, nothing else. |
| RoleBinding `dagger-devs-view` | `view` → Group `dagger-devs` | Human read access (HL-8); inert until the group exists. |
| RoleBinding `preview-driver` | `preview-driver-namespaced` → `dev-platform/preview-driver`; **not** in `preview-canary` | The driver's only write access inside a preview, and its only patch/delete on the Namespace itself. |
| RoleBinding `preview-reaper` | `preview-reaper-delete` → `dev-platform/preview-reaper`; **not** in `preview-canary` | The reaper's only delete right. |
| `preview-namespaces` | See below | The driver holds cluster-wide namespace create. |
| `preview-workloads` | No host namespaces, `hostPath`, privileged (init/ephemeral) containers, `nodeName` on create, `nodeSelector` beyond `kubernetes.io/os`/`arch`, required node affinity; `priorityClassName: dev-preview`; and on create, `preview-quota` and `default-deny` must already exist | A vcluster tenant can request any of the host-level fields and the syncer passes them through. |
| `preview-services` | LoadBalancer only for `vcluster` with class `tailscale`; no NodePort; no `externalIPs` | Nothing in a preview is reachable except through the tailnet and the preview Gateway. |
| `preview-pvcs` | `storageClassName: ssd-single` | Belt and braces with the per-class quota, with a clearer message. |
| `preview-httproutes` | At least one hostname, every hostname `pr-<n>[-<suffix>].preview.eliorion.fr` where `<n>` is the namespace's `preview.eliorion.fr/pr` label; parentRefs only Gateway `dev-platform/preview`; backendRefs only Services in the same namespace | An HTTPRoute with no hostnames matches every hostname on the shared Gateway, and one naming another PR's host hijacks it. |
| `preview-priority` | Sets `priorityClassName: dev-preview`, `priority: -1000`, `preemptionPolicy: Never` on Pod CREATE | Previews yield to everything else on a three-node cluster. |
| `preview-reaper` | TTL and cap enforcement | Pipelines crash, and a PR can be abandoned without closing. |

`preview-namespaces` rules, applied to requests from `preview-driver` or `preview-reaper`
only: the name matches `^preview-pr-[0-9]{1,6}$` on every operation; the reaper may only
DELETE; on CREATE `preview.eliorion.fr/tier=preview` and `preview.eliorion.fr/pr` equal to
the name's number are required and the PSA `enforce` label, if set, is `baseline` or
`restricted`; on UPDATE the labels are immutable; a CREATE is denied while 3 or more
non-Terminating `preview-pr-*` namespaces exist.

## Identities

| Identity | Holds | Cannot | Token |
|---|---|---|---|
| `dev-platform/preview-driver` | namespaces get/list/watch/create cluster-wide (names and labels policed by `preview-namespaces`); per preview: get/patch/delete of that Namespace, CRUD on Services, ConfigMaps, Secrets, ServiceAccounts, PVCs, StatefulSets, Deployments, ReplicaSets, HTTPRoutes; read Pods, pod logs, Events, Endpoints, ResourceQuotas, LimitRanges | patch/delete any other Namespace, RBAC objects, NetworkPolicies, CiliumNetworkPolicies, quota/limit writes, `pods/exec`, anything in `preview-canary` or outside previews | minted per run via `TokenRequest` |
| `dev-platform/preview-reader` | per preview: get Secret `vc-vcluster`, Service `vcluster` | everything else | minted by whoever consumes kubeconfigs (not wired yet) |
| `dev-platform/preview-reaper` | namespaces get/list/watch cluster-wide; delete of each preview Namespace (not `preview-canary`) | create/patch namespaces, delete any other, anything namespaced | the CronJob pod's projected token |
| `arc-runners/self-hosted-arc-gha-rs-no-permission` | in `dev-platform`: create `serviceaccounts/token` for `preview-driver`, get ConfigMap `kube-root-ca.crt` | mint any other token, read anything else | its runner pod's own token |
| `kyverno/kyverno-background-controller` (aggregated) | CRUD on ResourceQuotas, LimitRanges, NetworkPolicies, CiliumNetworkPolicies, RoleBindings everywhere; `bind` on ClusterRoles `preview-driver-namespaced`, `preview-reaper-delete`, `preview-vcluster`, `preview-kubeconfig-reader`, `view` | bind any other role | Kyverno's own |
| `preview-<n>/vc-vcluster` | `preview-vcluster` in its namespace only | anything cluster-scoped | the vcluster pod's |

The runner identity is the **default** scale set's (`self-hosted-arc`), shared by every
job that lands on it; any workflow in the repository can therefore mint a driver token.
The XL scale set cannot.

`bind` is what lets the background controller create the RoleBindings: the API server
refuses a binding to a role whose permissions the creator does not hold, unless it holds
`bind` on that role. The chart's own background-controller role already carries
ResourceQuota, LimitRange, NetworkPolicy and RoleBinding writes but no `get/list/watch` on
RoleBindings or anything on CiliumNetworkPolicies, which clone-with-sync needs cluster-wide
(it watches the kinds it generates).

Inside a preview, `preview-vcluster` holds rights the driver does not (Pods,
`pods/exec`). The driver can reach it — it creates ServiceAccounts and StatefulSets, so it
can run a pod as `vc-vcluster` — but only inside that one namespace, and every Pod it
starts still passes `preview-workloads`, the quota and the network policy.

## Why it is like this

**Namespace patch and delete are namespaced grants, not cluster-wide.** Kyverno's webhooks
carry the global `namespaceSelector` from the Kyverno release (`NotIn [kube-system, kyverno,
flux-system]`), and for a Namespace object the API server matches that selector against the
namespace's own labels. A cluster-wide `delete namespaces` would therefore let the driver
delete `flux-system` or `kyverno` without the request ever reaching `preview-namespaces`.
Instead, the only cluster-wide write is `create` (those three names already exist, and
`kubernetes.io/metadata.name` is set by the API server, so it cannot be spoofed), and patch/
delete come from `preview-driver-namespaced` and `preview-reaper-delete` through the
generated RoleBindings. For `/api/v1/namespaces/<name>` the request's namespace is `<name>`
itself, so a RoleBinding in a namespace authorizes patching or deleting exactly that
Namespace and no other. This also means the driver cannot delete a preview before
`preview-rbac` has run, and neither identity can ever delete `preview-canary`.

**CEL policy types only.** `ClusterPolicy`/`Policy` are deprecated in Kyverno 1.19 and
removed in 1.20; see the Kyverno README and `documentations/14`.

**Clone from a template namespace, synchronized.** `preview-guardrails` does
`generator.Apply(<namespace>, [resource.List(<kind>, 'preview-template'), …])` with
`synchronize` and `generateExisting` on. Listing a namespace rather than naming objects
means a new ResourceQuota, LimitRange, NetworkPolicy or CiliumNetworkPolicy dropped into
`templates/` reaches every preview with no policy change. With synchronize, Kyverno keeps a
watch on the generated objects: an edit or delete of a clone is reverted, and an edit to a
template propagates. RoleBindings are generated from data in `preview-rbac` instead,
because they are per namespace (subject `vc-vcluster` in that namespace).

**`generateExisting`** runs when the policy is created or changed (and when the
background controller starts), so previews that predate a policy, or were created while
Kyverno was down, get caught up.

**GeneratingPolicy webhooks are always `failurePolicy: Ignore`.** The CRD has no
`failurePolicy` field, and Kyverno hardcodes `Ignore` for the type. A preview namespace
created while Kyverno is down simply gets nothing generated. Two things make that fail
closed: the driver holds no rights inside a namespace until `preview-rbac` has run, and
`preview-workloads` refuses every Pod CREATE until `preview-quota` and `default-deny` exist
(one GET each per pod create). A namespace with RBAC but no guardrails therefore starts no
pods.

**`failurePolicy: Fail`, scoped.** Every validating and mutating policy fails closed, and
each is bounded so a Kyverno outage blocks only preview traffic: the Pod/Service/PVC/
HTTPRoute policies by their `namespaceSelector`, `preview-namespaces` by
`matchConditions` on `request.userInfo.username`. Kyverno copies match conditions that use
only the Kubernetes CEL environment into the webhook configuration, so the API server
evaluates them and no other identity's Namespace request is ever sent to Kyverno. A
`namespaceSelector` cannot bound a Namespace policy, which is why that one uses identities.

**`preview-namespaces` has background evaluation off.** Its rules depend on the request's
identity and operation, which a background scan does not have.

**The cap counts through the API.** `resource.List('v1', 'namespaces', '')` runs in the
admission controller, which holds `namespaces list`. The object being created is not stored
yet, and the rule also skips `request.name` so the Kyverno CLI's fake cluster (which does
list it) gives the same answer. Terminating namespaces do not count. Two concurrent CREATEs
can both see 2 and both succeed; the reaper trims back to 3 within 15 minutes. Keep preview
creation serialized in the pipeline.

**Pod autogen is off** (`autogen.podControllers.controllers: []`) on `preview-workloads` and
`preview-priority`. With the default, Kyverno would also validate Deployment/StatefulSet
templates — which never carry `priorityClassName: dev-preview`, because the mutation
happens on the Pod — and would rewrite the templates of objects Helm owns.

**Priority is set as three fields at once.** The Priority admission plugin runs before
webhooks and has already resolved `spec.priority` from the original class. Rewriting only
`priorityClassName` would store a pod whose class says -1000 while the scheduler reads the
old integer.

**The `preview-vcluster` rules are a copy, not a reference.** Rendered with:

```bash
helm template vcluster vcluster --repo https://charts.loft.sh --version 0.37.1 \
  --namespace preview-pr-1 --kube-version 1.36.1 \
  --set rbac.role.enabled=true --set rbac.enableVolumeSnapshotRules.enabled=false \
  --set sync.toHost.networkPolicies.enabled=false --set sync.toHost.ingresses.enabled=false \
  --set sync.toHost.priorityClasses.enabled=false --set sync.fromHost.nodes.enabled=false \
  --set sync.fromHost.storageClasses.enabled=false --set sync.fromHost.ingressClasses.enabled=false \
  --set policies.resourceQuota.enabled=false --set policies.limitRange.enabled=false \
  --set policies.networkPolicy.enabled=false --set controlPlane.distro.k8s.enabled=true \
  --set controlPlane.backingStore.database.embedded.enabled=true \
  --show-only templates/role.yaml
```

`--kube-version` matters: the `pods/resize` rule is only rendered for Kubernetes ≥ 1.35.
With `enableVolumeSnapshotRules` left at `auto` the chart also renders a ClusterRole and a
`volumesnapshots` Role rule; the contract turns it off so no ClusterRole is needed.

**No `.sops.yaml` rule for `dev/`.** Nothing here is secret. `sops --encrypt` on a path no
rule matches fails loudly ("no matching creation rules found"), so the gap cannot produce a
plaintext commit; add a rule before the first `*.enc.yaml`. The Flux Kustomization already
has its `decryption` block (see Traps).

**The reaper.** `alpine/k8s:1.36.4` (sh, kubectl, jq; kubectl within one minor of the
cluster). busybox `date` cannot parse RFC3339, so timestamps are parsed by jq's
`fromdateiso8601`, which accepts only `YYYY-MM-DDTHH:MM:SSZ`; anything else falls back to
`creationTimestamp` and is logged as such. Pass 1 deletes previews whose last deploy is
older than `TTL_SECONDS` (86400) unless `phase: testing` with `phase-since` younger than
`LEASE_SECONDS` (7200). Pass 2 counts the non-Terminating survivors (leased ones included)
and, above `MAX_PREVIEWS` (3), deletes the oldest by last deploy, skipping leased ones.
Every decision is one log line. `preview-canary` never matches the name filter and is also
refused explicitly. Deletes use `--wait=false`; the Job has `activeDeadlineSeconds: 300`.

## Traps

- **Re-render `preview-vcluster` on every vcluster chart bump** (command above) and diff it
  against `rbac/preview-vcluster.yaml`. A missing rule shows up as a syncer stuck
  `forbidden` inside previews, not as a Flux error. Re-check the install contract too.
- **CEL policy types only.** Never add a `ClusterPolicy`/`Policy`.
- **Keep `UPDATE` in the generating policies' operations.** With synchronize on, Kyverno
  sends every UPDATE of a trigger to the background controller, and an UPDATE the policy
  does not match counts as "the trigger stopped matching": it **deletes every generated
  object** for that namespace. A CREATE-only rule would wipe a preview's quota, network
  policy and RBAC the first time the driver annotates it.
- **Deleting or renaming a template deletes it from every preview.** The clones are
  synchronized with their source. Pruning `templates/` in git is a fleet-wide change.
- **The tier label is what grants access.** Any namespace named
  `preview-pr-<n>` that someone labels `preview.eliorion.fr/tier: preview` gets the
  guardrails and the `preview-driver` binding, whoever created it. The generating policies
  ignore other names (`^preview-(pr-[0-9]{1,6}|canary)$`), and the driver cannot label
  anything but its own namespaces, so only a cluster admin can make this mistake.
- **`preview-template` must never carry `tier: preview`.** It would clone into itself and
  get a `preview-driver` binding.
- **Clones keep the templates' labels,** including Flux's
  `kustomize.toolkit.fluxcd.io/name: dev-platform`. Flux garbage-collects by inventory, not
  label, so it does not prune them, but `flux trace` and label selectors will claim them.
- **`failurePolicy: Fail` means a Kyverno outage blocks** preview Pod/Service/PVC/HTTPRoute
  writes and driver/reaper Namespace writes. Nothing outside previews. Keep it that way:
  any new `Fail` policy needs a `namespaceSelector` on the tier label or identity
  `matchConditions`.
- **Never grant `patch`, `update` or `delete` on `namespaces` through a ClusterRoleBinding**
  to the driver, the reaper or anything a pipeline can impersonate. Kyverno never sees
  those requests for `kube-system`, `kyverno` or `flux-system` (see "Why"). If the Kyverno
  HelmRelease is removed, every policy goes with its CRDs and the driver can still create
  arbitrary namespaces, but gets no rights inside them.
- **Terminating namespaces do not count** toward the cap, in the policy or the reaper. A
  namespace stuck Terminating on a finalizer lets a fourth preview in.
- **`services.nodeports: "0"` rejects any LoadBalancer Service** that does not set
  `allocateLoadBalancerNodePorts: false`, with a quota error rather than a policy message.
- **Names are load-bearing across files:** `vc-vcluster`/`vcluster` (reader role, rbac
  policy, CNP selector), `preview-quota`/`default-deny` (the pod guard), `dev-preview`
  (PriorityClass, mutation, validation), the ARC SA name (renaming the scale set silently
  breaks token minting), and the ClusterRole list in `rbac/kyverno-background.yaml`, which
  must cover every `roleRef` in `policies/generate-rbac.yaml`.
- **Add a `.sops.yaml` rule before the first `*.enc.yaml` here,** and never remove the
  `decryption` block from `clusters/staging/dev.yaml`: without it Flux applies ciphertext
  with no error (`clusters/README.md`).
- **`PriorityClass` `value` and `preemptionPolicy` are immutable.** Changing either needs
  the object deleted; Flux cannot patch it.

## Verification

### Offline

```bash
kubectl kustomize infrastructure/services/dev            # render
kyverno test infrastructure/services/dev/policies/tests  # CLI v1.19.1: 54 results
```

The suites cover: namespace names, labels, PSA label, cap (with and without a Terminating
namespace), reaper-only-delete, other identities skipped; every Pod rule including the
missing-guardrails guard; Services, PVCs and HTTPRoutes; the priority mutation (exact
patched Pod); the cloned guardrails and the RoleBinding set for a PR namespace and for
`preview-canary` (the CLI fails a generated object that is not in the expected file, so
the canary's 3-binding file proves the driver and reaper bindings are absent).

Two CLI 1.19.1 behaviours shape the suites:

- **A resource the `namespaceSelector` excludes reports `Excluded` and satisfies any
  expected result.** Namespace scoping is therefore not asserted; run with
  `--detailed-results` and check the REASON column after editing a suite. Suites for
  policies with a `namespaceSelector` pass `variables: values.yaml` listing the namespaces,
  which is what the CLI matches the selector against (`clusterResources` alone leaves
  everything `Excluded`).
- The fake cluster behind `resource.List` also contains the resources under test, and
  kinds the CLI does not know need a CRD under `tests/crds/` (minimal stubs).

The UPDATE label-immutability rule is not covered: the CLI's UPDATE uses the same object as
old and new.

Schema check, from CRDs rendered out of the pinned chart (`helm template kyverno
kyverno/kyverno --version 3.9.1`) and the live `ciliumnetworkpolicies.cilium.io`, converted
with kubeconform's `openapi2jsonschema.py`:

```bash
kubectl kustomize infrastructure/services/dev \
  | kubeconform -strict -kubernetes-version 1.36.0 -schema-location default \
      -schema-location '<dir>/{{ .ResourceKind }}_{{ .ResourceAPIVersion }}.json' -summary
```

### Live, once #179 (Kyverno) is deployed

Before merging: the server-side dry-run below. After Flux has applied `dev-platform`: the
negative tests. Every command runs as the driver unless noted; each must be refused
(Kyverno message or RBAC `forbidden`), except where it says allowed.

```bash
D=--as=system:serviceaccount:dev-platform:preview-driver
R=--as=system:serviceaccount:dev-platform:preview-reaper

kubectl apply --server-side --dry-run=server -k infrastructure/services/dev

# --dry-run=server still runs authorization and admission; keep it on every delete of a real namespace.
kubectl $D create namespace foo                                     # name
kubectl $D create namespace preview-pr-1                            # labels
kubectl $D delete namespace asp --dry-run=server                    # RBAC forbidden
kubectl $D delete namespace flux-system --dry-run=server            # RBAC forbidden (webhook-excluded)
kubectl $D label namespace kyverno foo=bar --dry-run=server         # RBAC forbidden (webhook-excluded)
kubectl $R delete namespace flux-system --dry-run=server            # RBAC forbidden
kubectl $R create namespace preview-pr-2                            # RBAC forbidden

cat <<'EOF' | kubectl $D apply -f -                                  # allowed
apiVersion: v1
kind: Namespace
metadata:
  name: preview-pr-1
  labels: {preview.eliorion.fr/tier: preview, preview.eliorion.fr/pr: "1", pod-security.kubernetes.io/enforce: baseline}
EOF
kubectl -n preview-pr-1 get resourcequota,limitrange,networkpolicy,ciliumnetworkpolicy,rolebinding  # 5 RoleBindings
kubectl $D -n preview-pr-1 delete resourcequota preview-quota       # RBAC forbidden
kubectl $D label namespace preview-pr-1 preview.eliorion.fr/pr=2 --overwrite   # immutable

kubectl $D -n preview-pr-1 create deployment priv --image=busybox -- sleep 1d  # allowed; then:
kubectl $D -n preview-pr-1 patch deployment priv --type=json -p \
  '[{"op":"add","path":"/spec/template/spec/containers/0/securityContext","value":{"privileged":true}}]'
kubectl -n preview-pr-1 get events --field-selector reason=FailedCreate     # privileged denied
# repeat the patch with a hostPath volume, and with nodeSelector kubernetes.io/hostname

kubectl $D -n preview-pr-1 create service loadbalancer lb --tcp=443:8443       # no tailscale class
kubectl $D -n preview-pr-1 apply -f - <<'EOF'                                  # other PR's host
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: steal}
spec:
  parentRefs: [{name: preview, namespace: dev-platform}]
  hostnames: [pr-2.preview.eliorion.fr]
EOF
kubectl $D -n preview-pr-1 apply -f - <<'EOF'                                  # class ssd
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: fast}
spec: {storageClassName: ssd, accessModes: [ReadWriteOnce], resources: {requests: {storage: 1Gi}}}
EOF
# create preview-pr-2 and preview-pr-3 the same way, then preview-pr-4    # cap
```

Network, from a pod in `preview-pr-1` (e.g. the `priv` Deployment without the patch):
`wget -T3 https://kubernetes.default` times out; so does any Service in another namespace
and `harbor-core.registry:80`; `nslookup kubernetes.default` and a same-namespace Service
answer; `wget https://harbor.registry` (443→8443) gets as far as TLS (a certificate error,
not a timeout). Then check kubelet probes still
pass on a pod with a readiness probe, delete the test namespaces as the driver, and confirm
a reaper run: `kubectl -n dev-platform create job --from=cronjob/preview-reaper reaper-test`.

## Operating it

```bash
flux get kustomizations dev-platform
kubectl get validatingpolicies,mutatingpolicies,generatingpolicies
kubectl get updaterequests -n kyverno                  # pending/failed generation
kubectl -n kyverno logs deploy/kyverno-background-controller | grep preview-
kubectl get ns -l preview.eliorion.fr/tier=preview -L preview.eliorion.fr/pr
kubectl -n dev-platform logs job/<latest preview-reaper job>
```

A preview without its guardrails (Kyverno was down at creation): restart the background
controller, which re-runs `generateExisting`, or delete and recreate the namespace.
