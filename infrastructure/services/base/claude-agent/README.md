# claude-agent

The Kubernetes identity of the Claude Code agent: ServiceAccount `claude-agent` in namespace
`claude-agent`. It replaces the agent working with the cluster-admin kubeconfig, so the limits
below are enforced by the API server rather than by the agent's own discipline.

| What it can do | Grant |
| --- | --- |
| Read every object except Secrets | built-in `view` (aggregated) + `claude-agent-read`: nodes, namespaces, PVs, StorageClasses, CRDs, RBAC objects and the CRD groups `view` does not cover (CNPG, barman, Flux, Prometheus operator, ESO, KEDA, Cilium, Gateway API, cert-manager, Kyverno, Tailscale, Piraeus, metrics) |
| `flux reconcile` | `claude-agent-flux-reconcile`: `patch` on Kustomizations, HelmReleases, Git/Helm/OCI repositories. Any spec change other than the annotation is reverted by Flux |
| Throwaway pods (benchmarks, S3 reads) | `claude-agent-workbench`: pods + logs in `claude-agent` only, whose namespace enforces Pod Security `restricted` |
| Loki / Prometheus over a port-forward | `claude-agent-port-forward`: `pods/portforward` in `monitoring` only |

## What it deliberately cannot do

- **Read any Secret**, anywhere. `view` excludes them and `claude-agent-read` never lists the core
  group's `secrets` (nor `*` on the core group, which would include them). This is what keeps the
  Garage bucket-manager token, the database credentials and the OpenBao material out of reach.
- **Exec into a pod.** An exec into a CNPG pod is a Postgres superuser; work that needs one goes
  through the owner.
- **Create, change or delete workloads** outside `claude-agent`. Changes go through a PR and Flux.
- **Read a consumer's bucket with its key**, as the agent did with throwaway pods in `fbref` or
  `ai-gateway`. Bucket reads use read-only keys reflected into `claude-agent` (garage-config Job).

## Issuing the kubeconfig

```bash
mise claude-kubeconfig          # with an ADMIN kubeconfig; writes ~/.kube/claude-agent.yaml, mode 600
mise claude-kubeconfig 24h      # shorter
```

A token from `kubectl create token`: it is not stored in the cluster and expires on its own
(default 7 days). Revoke early by deleting and recreating the ServiceAccount.

## Making it binding

RBAC limits the token, not the machine. While the cluster-admin kubeconfig
(`clusters/staging/kubeconfig`) is readable from the agent's devcontainer, the agent can still use
it. Either keep the admin kubeconfig out of that container, or deny it in the agent's Claude Code
settings (`permissions.deny` on reading that path and on commands naming it), and set
`KUBECONFIG=~/.kube/claude-agent.yaml` for the session.

## Traps

- **Never widen `claude-agent-read` with `apiGroups: [""]` and `resources: ["*"]`** — the core
  group's wildcard includes Secrets.
- **`pods/exec` must stay out**, in every namespace.
- **A new CRD group is invisible until it is listed** in `claude-agent-read`, unless its operator
  ships `aggregate-to-view` roles.
