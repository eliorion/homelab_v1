# dev-platform — one long-lived vcluster for e2e runs and development

One [vcluster](https://www.vcluster.com/) in the host namespace `dev-platform` is the platform
every asp e2e run deploys onto. It is shaped like staging where behaviour depends on it: the
host's Cilium enforces the charts' NetworkPolicies, volumes are LINSTOR `ssd-single`, and KEDA
and CloudNativePG run inside it at **the same chart versions as staging, from the same bases**.

Runs are not Flux objects. The asp pipeline creates `e2e-<pr>-asp`, `e2e-<pr>-fbref` and
`e2e-<pr>-scraper` inside the vcluster, installs main's charts and released images, upgrades
the stacks the PR changed, checks, and deletes the namespaces. This directory owns the
platform and the fence around it; it never creates a run. Design and the run lifecycle:
[`documentations/19-dev-platform.md`](../../../../documentations/19-dev-platform.md).

## How it is wired

Flux Kustomization `dev-platform` (`clusters/staging/dev.yaml`) applies this directory to the
host, `timeout: 20m`, `wait: true`, after `infrastructure-controllers` (CNPG's HelmRepository),
`infra-keda`, `infra-kyverno`, `infra-cilium-config` and `infra-reflector`.

| Path | Applied to | What it does |
|---|---|---|
| `namespace.yaml` | host | Namespace `dev-platform` (PSA `baseline`, label `eliorion.fr/tier: dev`); PriorityClass `dev` (-1000, `Never`). |
| `guardrails.yaml` | host | ResourceQuota `dev-quota`, LimitRange `dev-limits` (container default limit 500m CPU / 512Mi, max 2Gi, PVC max 5Gi). |
| `network.yaml` | host | CiliumNetworkPolicies `dev-host-boundary`, `dev-platform-dns-api`, `dev-vcluster-api`. |
| `rbac.yaml` | host | `kyverno:admission-controller:dev`: lets `policies/workloads.yaml` read CiliumNetworkPolicies. |
| `runner-access.yaml` | host | Role `e2e-runner-kubeconfig`: the `self-hosted-arc-e2e` runner SA may get Secret `vc-e2e-runner`, nothing else. |
| `policies/` | host | Kyverno `dev-workloads`, `dev-services`, `dev-pvcs` (validating), `dev-pods` (mutating). `tests/` is not applied. |
| `vcluster/release.yaml` | host | HelmRepository `loft`, HelmRelease `vcluster` 0.37.1. |
| `addons/` | host → vcluster | HelmReleases `keda` and `cnpg` built from `infrastructure/controllers/base/{keda,cnpg}` with `spec.kubeConfig`. |
| `virtual-sync.yaml` | host | Flux Kustomization `dev-platform-virtual`, in `dev-platform` because `spec.kubeConfig` reads a Secret from its own namespace. |
| `virtual/` | vcluster | Namespace `e2e-system`, StorageClass `ssd-single` (default), RBAC for `e2e-runner` and the reaper, ValidatingAdmissionPolicy `e2e-runner-scope`, ConfigMap `e2e-db-templates`, CronJob `e2e-reaper`. |

Inside the vcluster the stacks see: namespaces of their own, KEDA's CRDs and external metrics
API, the CNPG operator, a default `ssd-single` StorageClass. On the host there are only plain
pods, services, PVCs and NetworkPolicies in `dev-platform`, named `<name>-x-<namespace>-x-vcluster`.

## Network

The boundary is built from **deny** rules, not from a default-deny NetworkPolicy. The vcluster
syncs each chart's NetworkPolicies into this one namespace (`sync.toHost.networkPolicies`), and
NetworkPolicies add up: a namespace-wide "allow same namespace" would silently cancel every
chart restriction. Cilium deny rules take precedence over any allow, so:

- `dev-host-boundary` (every synced pod) denies egress to `world`, `host`, `remote-node`,
  `kube-apiserver`, `ingress`, `health`, `unmanaged` and every other namespace, and ingress from
  every other namespace. `enableDefaultDeny: false` is **load-bearing**: a policy that selects a
  pod puts it into default-deny even when it holds only deny rules.
- A pod no chart policy selects stays open inside the namespace, as on staging. A pod a chart
  policy selects is restricted by that policy, as on staging.
- `dev-platform-dns-api` adds DNS and API reachability. Chart policies allow port 53 and
  443/6443, but the vcluster's CoreDNS listens on **1053** and its API on **8443**, and Cilium
  matches ports after DNAT. This is the one place the platform widens a chart policy.
- `dev-vcluster-api` fences the control plane pod: egress to the host API and this namespace
  (webhooks, the KEDA metrics APIService, CoreDNS); ingress on 8443 from this namespace, the
  Dagger engine and Flux's helm and kustomize controllers.

The Dagger engine reaches the vcluster API but not the run pods; the harness port-forwards
through the virtual API.

## Identity

| Identity | Where | Can |
|---|---|---|
| `vc-vcluster` (host Secret) | admin certificate | Flux only (`addons/`, `dev-platform-virtual`). Nothing else has RBAC on Secrets here. |
| `vc-e2e-runner` (host Secret) | token for virtual SA `kube-system/e2e-runner` | create/delete run namespaces and bind itself `admin` + `e2e-run-crds` inside them; read `e2e-db-templates`; list Deployments (preflight). |
| `e2e-system/e2e-reaper` | in-vcluster SA | delete run namespaces. |

`e2e-runner-scope` (native ValidatingAdmissionPolicy, no Kyverno inside) confines both SAs'
writes to namespaces matching `^e2e-[0-9]{1,6}-(asp|fbref|scraper)$` and pins every RoleBinding
the runner creates to `admin`/`e2e-run-crds` bound to itself. Reads are not admission-checked;
the ClusterRole grants no reads beyond namespaces and Deployments.

**The runner token is long-lived.** vcluster mints `exportKubeConfig.additionalSecrets` tokens
with a ten-year expiry and never rotates them. The alternative — the virtual API server trusting
host-issued ServiceAccount JWTs — does not work here: the host API refuses anonymous requests
(`401` on `/.well-known/openid-configuration` and `/openid/v1/jwks`), so the authenticator cannot
fetch the signing keys. The mitigation is scope (above) and who can read the Secret: the
`self-hosted-arc-e2e` runner scale set (`runner-access.yaml`, at most two pods) and cluster
admins. Any workflow that targets that scale set can read it, so the repository must keep
fork PRs off self-hosted runners (asp `.github/CI-CUTOVER.md`, known scope gaps). Rotate:

```bash
kubectl --kubeconfig <vcluster admin> -n kube-system delete serviceaccount e2e-runner
kubectl -n dev-platform delete pod vcluster-0     # re-creates the SA and rewrites vc-e2e-runner
```

Deleting the SA invalidates every token minted for it. The SA sits in `kube-system` because
vcluster writes `additionalSecrets` in order at first boot and stops at the first failure: a
namespace created later by `virtual/` would block the export.

## Pods

`dev-pods` mutates **run pods** only — synced pods (`vcluster.loft.sh/managed-by`) whose virtual
namespace is not `kube-system`, `keda`, `cnpg-system` or `e2e-system`:

- priority `dev` (-1000, never preempts). The control plane and the operators keep the default
  priority: evicting them first would break every run at once.
- `imagePullSecrets` replaced with `harbor-e2e-pull`, a **host** Secret (see Registry). The
  charts run with `imagePullSecrets: []`; nothing inside the vcluster can read the registry
  credential. `imagePullSecrets` is an atomic list, so this is a JSONPatch —
  ApplyConfiguration refuses it, and with `failurePolicy: Fail` the refusal blocks the pod sync.
  The vcluster value `sync.fromHost.secrets` was rejected: it renders cluster-wide `secrets
  list/watch` for the syncer.

`dev-workloads` refuses host access, node pinning, privileged containers and, for run pods, any
priority other than `dev`, and refuses pods until `dev-quota` and `dev-host-boundary` exist.

## Registry

Nodes pull images through containerd over HTTPS, so a run's images must be in a registry; the
Dagger engine's build cache is not one. Every image a run deploys comes from one private Harbor
project, `registry.eliorion.fr/e2e`:

- **PR-built services**: the asp `build-scan` job builds, scans (trivy) and only then pushes to
  `e2e/<image>:pr-<n>-<sha12>`, and hands the digest to the e2e job. The scanned image is the
  deployed image; the e2e job never builds.
- **Unchanged services**: main's released tags, copied from GHCR into `e2e/<image>:<tag>` once
  per tag (skipped when present). GHCR packages are private and the nodes hold no GHCR
  credential; copying keeps one pull secret instead of two.

Pull credential: Secret `harbor-e2e-pull` (`kubernetes.io/dockerconfigjson`, robot
`robot$e2e+pull`, pull only), mirrored into this namespace by reflector from `registry` and
injected by `dev-pods`. The project, both robots and that Secret are declared as code with Harbor:
[`../../base/harbor/README.md`](../../base/harbor/README.md#harbor-objects-as-code). The push robot
`robot$e2e+ci` reaches only GitHub (`HARBOR_E2E_ROBOT` / `HARBOR_E2E_PUSH_TOKEN`). Until the
Secret exists, run pods referencing a private image fail with `ImagePullBackOff`; public images
still pull.

## Quota

Measured on a throwaway vcluster (2026-09-15) and from `helm template` of the three charts:

| | pods | requests.cpu | requests.memory | limits.cpu | limits.memory | PVCs |
|---|---|---|---|---|---|---|
| platform (control plane, CoreDNS, KEDA ×3, CNPG operator) | 6 | 620m | ~0.9Gi | ~6 | ~7.2Gi | 1 |
| one run: asp + fbref + scraper workloads | 12 | 1.32 | 2.05Gi | 7.5 | 5.95Gi | — |
| one run: CNPG, 1 instance each, 2 for fbref (LimitRange defaults) | 4 | 0.2 | ~0.3Gi | 2 | 2Gi | 4 |
| one run: migration hooks, helm tests, fixtures (transient) | ~5 | ~0.3 | ~0.4Gi | ~2.5 | ~2.5Gi | — |

`dev-quota` covers the platform plus two concurrent runs: 60 pods, 7 CPU and 12Gi requested,
30 CPU and 36Gi of limits, 16 PVCs, 40Gi `ssd-single`. Because the quota caps `limits.cpu`,
`dev-limits` gives every container without a CPU limit a 500m default; the vcluster control plane
sets its own 2 CPU so the API server is not throttled. The asp lane runs at most two
at once (its runner scale set). Free requests on the cluster at measurement: ~18 CPU, ~37Gi.

## Traps

- **Chart bumps.** `exportKubeConfig`, `sync.*` and `rbac.enableVolumeSnapshotRules` keys have
  moved between vcluster minors; check `helm show values` before a bump. The distro image tag
  pins Kubernetes **1.36** to match staging; move it with Talos upgrades.
- **`addons/` follows staging.** A value added to the KEDA or CNPG base that needs something the
  vcluster lacks (a CRD, a namespace) breaks this platform on the same commit. Patch it off in
  `addons/kustomization.yaml`, as done for CNPG's PodMonitor and Grafana dashboard.
- **`storageNamespace`.** Without it a remote HelmRelease stores its release Secret in the
  HelmRelease's namespace, which does not exist in the vcluster.
- **LimitRange.** A container limit above 2Gi is rejected; the control plane is set to 2Gi.
- **`e2e-db-templates`** is generated from `apps/base/databases/*`. Renaming those files breaks
  this build; `kubectl kustomize` needs `--load-restrictor LoadRestrictionsNone` locally.

## Verification

```bash
kubectl kustomize infrastructure/services/dev/dev-platform
kustomize build --load-restrictor LoadRestrictionsNone infrastructure/services/dev/dev-platform/virtual
(cd infrastructure/services/dev/dev-platform/policies/tests && kyverno test .)

flux -n dev-platform get helmreleases          # vcluster, keda, cnpg Ready
flux -n dev-platform get kustomizations         # dev-platform-virtual Ready
kubectl -n dev-platform get secret vc-vcluster -o jsonpath='{.data.config}' | base64 -d > /tmp/vc.yaml
# reach the API: kubectl -n dev-platform port-forward svc/vcluster 18443:443, then point /tmp/vc.yaml at it
```

What the throwaway proof covered (same values, namespace `e2e-spike`, since deleted):

- a chart-shaped egress NetworkPolicy allowed its target namespace and blocked another;
- world egress stayed blocked even where that policy allowed `0.0.0.0/0:443`;
- the host API, a staging pod and Service, and Harbor were blocked from synced pods, and an
  outside pod was blocked from reaching them;
- removing `dev-host-boundary` restored world egress (`301`) and outside ingress (`200`);
- removing `dev-platform-dns-api` broke DNS for a policy-restricted pod;
- KEDA's external metrics APIService was `Available`; a 2-instance synchronous CNPG cluster became
  healthy with its `-app` Secret (`uri`, `jdbc-uri`, `username`, `password`); a `postgresql`
  ScaledObject scaled 0→1 in ~10s and back in ~45s;
- the Dagger engine reached the virtual API; `port-forward` and `exec` through it worked;
- `e2e-runner-scope` passed 15/15 allow/deny cases;
- the pod mutation landed on the host pod, and the syncer did not fight it.
