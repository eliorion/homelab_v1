# agent-platform

Coding agents in gVisor sandboxes, driven through an API, holding no infrastructure credential.
The code, the image and the Helm chart live in the asp repo:
- `services/agent-platform/`, with the design in `docs/22-agent-platform.md`;
- `k8s/charts/agent-platform`.

This directory is the cluster wiring only.

## How it is wired

| File | What it does |
|---|---|
| `namespace.yaml` | Two namespaces, both PodSecurity `restricted`. `agent-platform` holds the control plane (agent-api and the Agent controller). `agent-sandboxes` holds the agents: one gVisor box per `Agent`, plus the chart's templates, warm pools, quota and CiliumNetworkPolicies. |
| `release.yaml` | `HelmRelease agent-platform`, chart `k8s/charts/agent-platform` from the `agent-platform` GitRepository, with `reconcileStrategy: Revision` like the other asp-repo charts. It sets `crds: Create` / `upgrade.crds: CreateReplace` (the Agent CRD is in the chart's `crds/`), `retries: 3` and helm tests. Its values are environment overrides only: `ghcr-pull-secret`, and the Keycloak issuer and audience. |
| `ingress-tailscale.yaml` | `Ingress agent-web` (`ingressClassName: tailscale`): the web UI at `https://agent-platform.tail45b0ca.ts.net`, which is one of the Keycloak client's redirect URIs. The chart's `agent-web` nginx serves the SPA and proxies `/api` to agent-api. |
| `kustomization.yaml` | The three files above. |

The staging overlay adds `secrets/`, namespaced to `agent-platform`. It holds the `openbao` consumer
component and `ExternalSecret claude-subscription`, which reads OpenBao
`kv/agent-platform/claude-subscription` (property `CLAUDE_CODE_OAUTH_TOKEN`). That is the
subscription token the **broker** injects into an agent process. Only the broker mounts it, and
`agent-platform` is listed in `eso-namespaces.txt`. **Write it by hand** with the OpenBao README's
`bao kv put` procedure. A token stored for the Phase 0 test bed at `kv/agent-p0/...` is not
visible from this namespace: each namespace reads only its own folder.

The overlay is `../../staging/agent-platform/`. It has its own Flux Kustomization,
`infra-agent-platform` (`clusters/staging/infrastructure.yaml`), which depends on:
- `infra-agent-sandbox`: the SandboxTemplate, WarmPool and Claim CRDs;
- `infra-gvisor`;
- `infra-reflector`;
- `infra-cilium`.

It is not in the services aggregate, so that the agent-sandbox controller never gates the whole
tier.

The source is `GitRepository agent-platform` in `clusters/staging/sources.yaml`, scoped to
`k8s/charts/agent-platform/` + `k8s/charts/common/`, with the shared `asp-deploy-key`.

Set up in earlier PRs:
- `agent-platform` and `agent-sandboxes` are in the descheduler excludes and the
  `ghcr-pull-secret` reflection lists (#237);
- the gVisor runtime (#236).

## Agents are not in git

An agent is an `Agent` object (`agentplatform.eliorion.fr/v1alpha1`). agent-api creates it at
runtime. The controller turns it into a `SandboxClaim` on a warm pool and owns that claim, so
deleting the Agent deletes the claim, the box and its workspace. None of those objects is in this
repo, and Flux never prunes them.

## History: turning it on

The HelmRelease started suspended. It was turned on 2026-10-09, once three conditions held:
- the agent platform's Phase 0 had passed on staging (results in asp
  `services/agent-platform/phase0/README.md`);
- `agent-platform-control-v0.1.0` was released;
- the Keycloak `agent-platform` client and groups were in place
  (`../keycloak/realm/realm-apps.yaml`).

**Who can call agent-api** is decided by membership of `agent-platform-{viewers,operators,admins}`,
set in the Keycloak admin console. An operator gets a token from a shell with the device grant:
`POST https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/auth/device`
with `client_id=agent-platform`.

## Traps

- **Removing `infra-agent-platform` deletes both namespaces**, and with them every agent and
  its workspace.
- **Flux never prunes an Agent**, because Agents are created at runtime. Deleting the
  HelmRelease does not delete them either. To clean up, delete the Agents through agent-api first.
- **Keep `upgrade.crds: CreateReplace`.** Without it a new CRD field is pruned by the API server,
  silently.
