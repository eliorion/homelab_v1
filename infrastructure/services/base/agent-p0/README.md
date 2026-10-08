# agent-p0

The agent platform's **Phase 0 test bed**. It is throwaway. It exists to answer six questions
before the platform is built on the answers:

1. Does in-place memory resize hold under gVisor?
2. Does ACP work for both CLIs?
3. Does the subscription token work behind Anthropic-only egress?
4. Does Cilium isolate the sandboxes?
5. Does suspend/resume keep the workspace?
6. What does a sandbox cost?

The tests themselves, with their pass criteria and results tables, live in the asp repo at
`services/agent-platform/phase0/README.md`, together with the scripts that drive them.
This directory holds only the objects they act on.

Teardown: delete the `infra-agent-p0` Kustomization from `clusters/staging/infrastructure.yaml`,
this directory and `../../staging/agent-p0/`. Flux prunes the namespace, and with it the PVCs. Then remove `agent-p0` from
`../../base/openbao/config/eso-namespaces.txt`, from the descheduler excludes and from the
reflector lists.

## How it is wired

| File | What it does |
|---|---|
| `namespace.yaml` | `agent-p0`, PodSecurity `restricted`. |
| `quota.yaml` | 24Gi memory, 4 CPU, 8 pods, 20Gi storage. Sized for test 1's 20Gi resize request, so that request is judged by a *node*, not refused here. |
| `api.yaml` | `p0-api`, the agent-api stand-in. It runs the box image on runc and does nothing (`sleep infinity`). It holds the token in its env, the way the broker will. |
| `sandbox-a.yaml`, `sandbox-b.yaml` | `Sandbox p0-a` and `p0-b` (`agents.x-k8s.io/v1beta1`). Each is the box image on `runtimeClassName: gvisor`, 1Gi memory with `resizePolicy NotRequired`, and a 2Gi `ssd` workspace. Each pod is named after its Sandbox. |
| `warmpool.yaml` | `SandboxTemplate p0-box` plus `SandboxWarmPool p0-box` (1 replica), for test 5's warm-claim timing. |
| `network.yaml` | Three CiliumNetworkPolicies, below. |
| `kustomization.yaml` | The files above, `namespace: agent-p0`. |

The staging overlay, `../../staging/agent-p0/`, adds what is environment-specific:
- `externalsecret.yaml`: `claude-subscription` from OpenBao `kv/agent-p0/claude-subscription`.
  **Write a fresh `claude setup-token` there by hand. Never Paperclip's.**
- the `openbao` consumer component (`../../base/openbao/consumer`); `agent-p0` is listed in
  `eso-namespaces.txt`.

Flux: the overlay is **not** listed in `../../staging/kustomization.yaml`. It has its own
Kustomization, `infra-agent-p0` (`clusters/staging/infrastructure.yaml`), the same way
`infra-harbor-config` and `infra-openbao-config` sit outside the aggregate. In the aggregate,
the `Sandbox` objects would make `infrastructure-services` depend on the agent-sandbox
controller, and its CRDs would gate the whole tier. `infra-agent-p0` runs with `prune: true` and
**no `wait`**. A box that fails to
start is a Phase 0 result, not a reconcile failure. It depends on:
- `infra-agent-sandbox` (CRDs);
- `infra-gvisor` (RuntimeClass);
- `infra-cilium`;
- `infra-reflector` (`ghcr-pull-secret`);
- `infrastructure-services` (OpenBao and ESO).

### Network

These are the first `toFQDNs` policy and the first default-deny on this cluster.

| Policy | Selects | Allows |
|---|---|---|
| `p0-box` | `app=p0-box` | Ingress: only from `app=p0-api`, to `:8080`/`:9090` (sandboxd). Egress: DNS through Cilium's DNS proxy, and `api.anthropic.com:443`. |
| `p0-box-browser` | `app=p0-box`, `browser=on` | Egress: `0.0.0.0/0` on 80/443, except RFC1918, CGNAT (the tailnet) and link-local. |
| `p0-api` | `app=p0-api` | Egress: the boxes' sandboxd ports, DNS, and `registry.npmjs.org:443` (the probe's `npm ci`). |

## Why it is like this

**`networkPolicyManagement: Unmanaged` on the template is load-bearing.** By default a
`SandboxTemplate` makes the agent-sandbox controller create a NetworkPolicy. When the template
gives no rules, that policy is "Secure Default", and it **allows all public egress**. Cilium
takes the union of a NetworkPolicy and a CiliumNetworkPolicy. So the default would quietly
widen the Anthropic-only egress into the whole internet, and the policies in this directory
would never notice.

**sandboxd has no authentication.** Anyone who can reach a box's `:9090` can run commands in
it. The `p0-box` ingress rule is the only fence, and test 4 checks that it holds.

**The token never enters a box's pod spec.** `p0-api` holds it. The probe passes it to the agent
process as `StartRequest.config.env_vars`, through sandboxd. Test 3 greps the box's pod YAML to
confirm the token is absent.

## Traps

- **The boxes need the gVisor Talos upgrade on the node they land on.** On a node without it,
  the pod fails with `no runtime for "runsc" is configured`. Run the runbook in
  `bootstraping/README.md` ("Adding gVisor") first.
- **Changing a Sandbox's `operatingMode` here is test 5.** Setting `Suspended` deletes the pod
  and keeps the PVC.
- **Removing the Kustomization deletes the PVCs.** They are owned by their Sandbox.
