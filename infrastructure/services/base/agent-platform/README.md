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
| `release.yaml` | `HelmRelease agent-platform`, chart `k8s/charts/agent-platform` from the `agent-platform` GitRepository, with `reconcileStrategy: Revision` like the other asp-repo charts. It sets `crds: Create` / `upgrade.crds: CreateReplace` (the Agent CRD is in the chart's `crds/`), `retries: 3` and helm tests. Its values are environment overrides only: `ghcr-pull-secret`, and the Keycloak issuer and audience. **It starts `suspend: true`.** |
| `kustomization.yaml` | The two files above. |

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

## Turning it on

The HelmRelease stays suspended until all of these hold:

1. The agent platform's Phase 0 has passed, with results in asp
   `services/agent-platform/phase0/README.md`. The profile sizes and the egress list may change
   from it.
2. `agent-platform-control` is released, so `images.control.tag` in the chart is set by asp's
   `bump-chart`. With an empty tag, the Deployments render an unpullable `agent-platform-control:`.
3. Someone is in an `agent-platform-*` group. The `agent-platform` client (device flow,
   `aud: agent-platform`, a flat `groups` claim) and the three groups are declared in
   `../keycloak/realm/realm-apps.yaml`. Membership is set in the admin console, never in git.
   An operator gets a token from a shell with the device grant:
   `POST https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/auth/device`
   with `client_id=agent-platform`, then approves in a browser.

To turn it on, delete the `suspend: true` line in a PR.

## Traps

- **Removing `infra-agent-platform` deletes both namespaces**, and with them every agent and
  its workspace.
- **Flux never prunes an Agent**, because Agents are created at runtime. Deleting the
  HelmRelease does not delete them either. To clean up, delete the Agents through agent-api first.
- **Keep `upgrade.crds: CreateReplace`.** Without it a new CRD field is pruned by the API server,
  silently.
