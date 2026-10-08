# 22 — An agent platform: manage, reach, connect and equip many agents

**Status: design, nothing deployed.** Written 2026-10-08. This follows
[21](21-agent-credential-broker.md), which settled *how secrets reach an agent*. This document
settles the platform around it. The goal is a system where you can:

1. see and manage every agent, and add one in minutes;
2. SSH into any agent's sandbox;
3. let agents talk to each other, only when you choose;
4. give each agent exactly the tools you pick;
5. keep it easy to change and cheap to maintain.

Tool facts were checked upstream on 2026-10-08. Anything not confirmed is listed in
[§10](#10-not-verified-yet).

---

## 1. The answer in one paragraph

Split the platform into **two layers with one source of truth each**. **Paperclip**, which
is already deployed, stays the *work* layer: it owns the org chart, assigns issues, wakes
agents and lets them delegate to each other. **Git** becomes the *environment* layer: one
local Helm chart, `agent-box`, turns a ten-line entry per agent into a sandbox you can SSH
into, with its own identity, network fence, secrets and tool grants. Adding an agent is
one entry in one file plus a PR. Paperclip decides *what an agent is asked to do*. Git
decides *what an agent is able to do*. Only git's half is enforced by the platform, so
only git's half is a security boundary.

```
                         you ── ssh <agent>@agents-ssh ──┐        browser ── Paperclip UI
                                                         ▼                         │
 ┌───────────────────────── cluster ─────────────────────────────────────────────────▼──────┐
 │  sshpiper (one tailnet entry)            Paperclip (work layer: org chart, issues,       │
 │     │ routes by username                   delegation, heartbeats, skills)               │
 │     ▼                                          │ SSH environment: runs each agent        │
 │  ┌──────── ns agent-backend-dev ────────┐      │ on its own box                          │
 │  │ StatefulSet  agent box (gVisor)      │◀─────┘                                         │
 │  │  claude / codex / gh / sshd :2222    │                                                │
 │  │  PVC /home  (workspace survives)     │── MCP ──▶ agentgateway ──▶ k8s-ro, flux-ro,     │
 │  │  managed-settings.json (read-only)   │           (per-agent        agent-mail, db…    │
 │  │ ServiceAccount, ExternalSecret       │            tool allowlist)                     │
 │  │ CiliumNetworkPolicy: deny + per-tool │── LLM ──▶ ai-gateway (own virtual key)          │
 │  └──────────────────────────────────────┘── git ──▶ github.com (own repo token, doc 21) │
 │       … one namespace per agent, all rendered from the same chart entry …                │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Choosing the manager

| Candidate (2026-10) | Manage many | SSH into sandbox | Agent ↔ agent | Per-agent tools | Verdict |
|---|---|---|---|---|---|
| **Paperclip** (MIT, weekly releases, already deployed) | ✔ org chart, any CLI agent | via its **SSH environment** (experimental flag) | ✔ issues, parent/blocker links, delegation | ✔ skills, MCP tool gateway, per-agent secrets | **Keep**: it is the only one that covers 1, 3 and 4 |
| Coder (AGPL core, v2.38) | ✔ workspaces | ✔✔ `coder ssh` | ✘ (Coder Agents only) | `.mcp.json` per workspace | Tasks was removed in v2.38. Coder Agents does not wrap Claude Code and allows 5 concurrent on Community. The Agent Firewall is a paid add-on. Use it only if you want polished SSH workspaces |
| kagent (CNCF, 1.0-alpha) | ✔ `Agent` CRD | ✘ | ✔✔ A2A | ✔ MCP | Built for ops agents talking A2A. Its Claude/Codex harness is still alpha. Revisit later |
| OpenHands OSS | ~ | ✘ | ~ | ~ | Per-agent sandboxes on Kubernetes are an Enterprise feature |
| DevPod, Vibe Kanban, humanlayer ACP | — | — | — | — | Dormant or sunsetting |
| agent-sandbox | building block | ✘ | — | — | A sandbox CRD, not a manager |

Paperclip also ships an **alpha Kubernetes sandbox plugin**: one pod per run, Cilium FQDN
egress, optional `runtimeClassName`. It is a good fit for *throwaway parallel runs*, but
it does not give SSH. Its default backend also writes `agents.x-k8s.io/v1alpha1`, which
agent-sandbox v1.0 no longer serves. That is why the primary design below uses
**persistent boxes driven over Paperclip's SSH environment**, and keeps the plugin as an
optional later addition ([§8](#8-how-it-evolves)).

## 3. The environment layer: one chart, one entry per agent

Everything about an agent's environment is declared in a single values file:

```yaml
# apps/staging/agents/values.yaml
defaults:
  image: harbor.<tailnet>/agents/agent-box:2026.10.1
  runtimeClassName: gvisor
  storage: 20Gi
  resources: {requests: {cpu: 250m, memory: 1Gi}, limits: {memory: 4Gi}}

sshUsers:                         # people, not agents
  elio: ["ssh-ed25519 AAAA… elio@laptop"]

tools:                            # the catalogue: defined once, granted by name
  github:     {egress: [github.com, api.github.com, codeload.github.com]}
  pypi:       {egress: [nexus.nexus.svc]}
  k8s-read:   {mcp: kubernetes-ro}
  flux-read:  {mcp: flux-ro}
  agent-mail: {mcp: agent-mail}

agents:
  backend-dev:
    repo: eliorion/asp
    team: asp
    tools: [github, pypi, agent-mail]
    ssh: [elio]
  sre:
    repo: eliorion/homelab_v1
    tools: [github, k8s-read, flux-read]
    ssh: [elio]
    suspended: true               # scales the box to 0, keeps its disk
```

For each entry the chart renders:

| Object | Purpose |
|---|---|
| `Namespace agent-<name>` | The boundary for RBAC, quota, OpenBao and policy. **One per agent**, see below. |
| `ServiceAccount` | The agent's identity. Doc 21's broker and the gateway both key on it. |
| `StatefulSet` (1 replica) + PVC on `ssd` | The box. The PVC holds `/home`, so the clone, caches and CLI logins survive restarts. `suspended: true` sets replicas to 0. |
| `Service` :2222 | For sshpiper and Paperclip only. Never exposed directly. |
| `CiliumNetworkPolicy` | Default deny. Allows DNS, the ai-gateway, agentgateway, and the union of the `egress` lists of its tools. Ingress only from sshpiper and Paperclip, plus same-`team` boxes when a team is set. |
| `ExternalSecret` | `kv/agent-<name>/*` from OpenBao: its ai-gateway virtual key, and whatever else it is granted. |
| `ConfigMap` → `/etc/claude-code/` | `managed-settings.json` and `managed-mcp.json`, built from `tools`, mounted read-only. |
| sshpiper `Pipe` | `ssh <name>@agents-ssh` reaches this box, for the listed `ssh` users' keys only. |
| `AgentgatewayPolicy` | Allows exactly the MCP tools from its `tools` list ([§6](#6-tools)). |

**Why one namespace per agent.** The OpenBao policy in this cluster is already templated
on the *namespace* of the ServiceAccount that logs in. With one namespace per agent, every
agent gets its own secret folder with no new policy. If all agents shared one namespace,
they would all read the same folder. It also gives a ResourceQuota per agent and an RBAC
boundary that `kubectl` understands. The cost: each namespace must also be listed in
`openbao/config/eso-namespaces.txt` ([§10](#10-not-verified-yet) has a way to remove
that second edit).

**Why a local Helm chart and not kro yet.** kro would give a real `Agent` CRD
(`kubectl get agents`, status per agent) without writing an operator, and its `forEach` /
`includeWhen` fit this shape well. But its API is still `v1alpha1`, with breaking changes
announced and a 0.10 engine rewrite in release-candidate. A Helm chart needs no new
controller and is Flux-native. Because it sees every agent at once, it can also render
per-team policies. **Treat the values schema as the future CRD spec.** Switching to a kro
`ResourceGraphDefinition` later then means the same fields under `kind: Agent`, and the
values file splits into one object per agent, with no redesign. Crossplane (too heavy),
Kyverno generate (weak lifecycle and status) and Metacontroller (an operator in disguise)
were rejected.

**Why a StatefulSet and not an agent-sandbox `Sandbox`.** A Sandbox is exactly "one
stateful pod with a stable identity and a PVC", plus suspend and warm pools. For persistent
boxes a StatefulSet already does all of that, without one more controller. Swap it in when
warm pools or per-run sandboxes are wanted.

**One image for every box**, `agent-box`, built by the ARC runners and pushed to Harbor. It
contains `claude`, `codex`, `opencode`, `gh`, `git`, `kubectl`, `flux`, a non-root `sshd`
on 2222, and whatever the Paperclip SSH driver needs on the host. Per-agent differences
come from the values entry, never from per-agent images. Image tags under `apps/` are
pinned by hand ([CLAUDE.md](../CLAUDE.md)). Bumping the box image is one line in
`defaults`.

## 4. SSH access

**One entry point, sshpiper**, exposed once on the tailnet through a Tailscale operator L3
Service (`loadBalancerClass: tailscale`, plain TCP on 22). The chart renders one `Pipe` per
agent, which matches the SSH username to the box. `ssh backend-dev@agents-ssh` lands in
that box. VS Code Remote-SSH and `scp` go the same way.

- **Two keys, two jobs.** Your public keys sit in the `Pipe` (`from`). sshpiper then logs
  into the box with **its own** upstream key (`to.private_key_secret`, a SOPS or OpenBao
  Secret), and every box trusts only that key. You never put a personal key into a box.
  Removing someone from `ssh:` revokes them everywhere at the next reconcile.
- **Fallback: sshpiper's `kubectl exec` mode** (`sshpiper.com/kubectl_exec_cmd`). It needs
  no `sshd` in the box, but sshpiper then needs `pods/exec` on the agent namespaces, and
  scp and port-forwarding there are unverified.
- **Rejected: Tailscale inside each box.** The agent would hold a tailnet node key, which
  is a WireGuard egress path that Cilium sees only as UDP. That defeats the sandbox.
- **Rejected: one LoadBalancer IP per box.** It burns the 21-address LB-IPAM pool.

Paperclip reaches the boxes the same way, or directly on each box's `Service` :2222 with
its own key. Either way, the box's `sshd` accepts only keys the chart put there.

## 5. Agent ↔ agent communication: three levels, opt-in

| Level | How | When |
|---|---|---|
| **1. Through work items (default)** | Paperclip issues: an agent opens a sub-issue for another, with parent and blocker links. The target wakes on assignment. | Almost always. It is asynchronous and audited, and a human can watch or veto it. |
| **2. Through a mailbox tool** | `mcp_agent_mail` as one in-cluster service behind agentgateway: threads, identities, file leases. Granted as the `agent-mail` tool. | Chatty coordination between agents on one codebase. |
| **3. Direct network** | Same `team:` → the chart's CiliumNetworkPolicy allows box-to-box traffic inside that team. Cilium has no "same label as me" selector, so the chart renders one rule per team. | Only when agents must reach each other's dev servers or ports. |

Every level is a line in git, and the default is none. Direct network is level 3 on
purpose: an open path between boxes is also how one compromised agent reaches the next.
**Turn off Claude Code's own cross-session messaging** in managed settings (deny
`SendMessage` and `ListAgents`, refuse inbound). Across machines it goes through
Anthropic's servers, so it leaves the cluster and bypasses Cilium entirely. A2A was
skipped: coding CLIs are not A2A servers, and kagent can bring it later if needed.

## 6. Tools

**A tool is defined once in the `tools:` catalogue and granted to an agent by name.** A
grant is enforced in three places, and the chart renders all three from the same line:

1. **Network.** The tool's `egress` hosts join the agent's CiliumNetworkPolicy. A tool
   that is not granted has no route. This is the only layer the agent cannot argue with.
2. **Gateway.** MCP tools reach the agent only through agentgateway. An
   `AgentgatewayPolicy` per agent uses CEL over the caller's identity and
   `mcp.tool.name`. Tools not granted are **removed from `tools/list`** and refused on
   call. Several MCP servers are multiplexed behind one endpoint, with names prefixed by
   target (`k8s-read_pods_list`). The backends are the read-only servers from doc 21.
3. **In the box.** `managed-settings.json` (`allowManagedMcpServersOnly`,
   `allowedMcpServers`, `disableBypassPermissionsMode`) and `managed-mcp.json` match the
   grant, so the agent is only *offered* what it may use. They are mounted read-only and
   the agent runs non-root, so it cannot edit them. Treat this as convenience and
   defence in depth: Claude Code's Bash deny rules do not catch `sh -c` or a binary
   called by path.

**What about Paperclip's per-agent MCP and tool settings?** Use them to shape *behaviour*,
but do not rely on them for *permission*. They live in Paperclip's database, not git, and
an agent with a shell in its box can go around anything the app enforces. The network and
the gateway are the boundary.

**Credential-bearing tools** follow doc 21. GitHub is a per-repo installation token from
the broker, and `repo:` in the values entry is the binding the broker reads. Cluster
access is through the read-only MCP servers or the agent's own ServiceAccount RBAC, never
a shared kubeconfig.

## 7. What adding, changing and removing look like

| You want to | You do |
|---|---|
| Add an agent | Add an entry under `agents:` (and its namespace to `eso-namespaces.txt`), PR, merge. Then in Paperclip: create the agent and set its environment to SSH `agent-<name>`. |
| Give it a tool | Add the tool's name to its `tools:`. If the tool is new, add it to `tools:` once. |
| Let two agents talk | Same `team:`, or grant both `agent-mail`, or simply assign issues across them in Paperclip. |
| Pause it | `suspended: true`: replicas go to 0 and the disk is kept. |
| Look inside | `ssh <name>@agents-ssh`. |
| Remove it | Delete the entry. The namespace, PVC and every grant go with it. |
| Upgrade every box | Bump `defaults.image`. |

## 8. How it evolves

Each phase is useful on its own:

| Phase | Adds |
|---|---|
| **1. Boxes and SSH** | The `agent-box` image, the chart (namespace, SA, StatefulSet, PVC, Service, Pipe), sshpiper on the tailnet, Paperclip SSH environments. Agents leave the Paperclip pod. |
| **2. Fences** | The `gvisor` Talos extension and RuntimeClass, the CiliumNetworkPolicy from `tools[].egress`, ExternalSecret per agent, a separate ai-gateway virtual key per agent. |
| **3. Tools** | agentgateway with the read-only MCP backends and `mcp_agent_mail`, the per-agent `AgentgatewayPolicy`, managed settings. |
| **4. Credentials** | Doc 21's broker for per-repo GitHub tokens. The shared PAT is removed from Paperclip. |
| **5. Later** | kro `Agent` CRD once it is beta. Paperclip's Kubernetes plugin for throwaway parallel runs once it targets `v1beta1`. kagent if A2A becomes useful. |

## 9. Why this stays maintainable

- **Two sources of truth, never overlapping.** Git holds the environment and the
  permissions. Paperclip's database holds the work. No setting exists in both.
- **One abstraction.** Every agent is the same chart with different values. No per-agent
  YAML, image or script.
- **No custom code until phase 4.** Everything else is upstream (Paperclip, sshpiper,
  Cilium, agentgateway, External Secrets), version-pinned, and bumped like the rest of the
  repo. The broker is the only code you own.
- **Each layer can be swapped behind its contract.** The values schema survives a move to
  kro. Paperclip could be replaced by anything that drives SSH hosts. sshpiper, agentgateway
  and the box runtime are each behind one template.
- **It follows the repo conventions.** The chart directory gets a README for the *why*,
  manifests carry trap markers only, and secrets live in OpenBao with SOPS only for
  sshpiper's upstream key.

## 10. Not verified yet

Check these before building on them:

- **Paperclip's SSH environment.** It is behind an experimental flag. Still to confirm:
  what it installs on or requires from the remote host, how it passes per-agent
  credentials, and whether it keeps the workspace on the host between runs.
- **sshd and Tailscale under gVisor.** No upstream statement was found for OpenSSH under
  `runsc`. Test it first. The fallback is sshpiper exec mode, or `runc` for the boxes with
  everything else kept.
- **sshpiper exec mode.** Whether scp, sftp and port-forwarding work.
- **agentgateway policies.** Whether several `AgentgatewayPolicy` objects on one route
  merge, or whether the chart should render one policy with all agents' rules.
- **The OpenBao Kubernetes role.** Whether it supports a namespace *label selector*
  (`bound_service_account_namespace_selector`). If it does, the `eso` role could match
  `agents.eliorion.fr/box=true` instead of a list, and adding an agent stops needing the
  `eso-namespaces.txt` edit.
- **Whether the Talos nodes expose KVM.** Kata needs it; gVisor does not.

## References

- Paperclip Kubernetes sandbox plugin: <https://github.com/paperclipai/paperclip/tree/master/packages/plugins/sandbox-providers/kubernetes>
- agent-sandbox: <https://github.com/kubernetes-sigs/agent-sandbox>
- kro: <https://github.com/kubernetes-sigs/kro>
- sshpiper Kubernetes plugin: <https://github.com/tg123/sshpiper/tree/master/plugin/kubernetes>
- Tailscale operator L3 ingress: <https://tailscale.com/docs/kubernetes-operator/ingress/expose-workload-to-tailnet-l3>
- agentgateway MCP authorization: <https://agentgateway.dev/docs/configuration/security/mcp-authz>
- mcp_agent_mail: <https://github.com/Dicklesworthstone/mcp_agent_mail>
- Claude Code managed settings: <https://code.claude.com/docs/en/managed-settings>
- Claude Code cross-session messaging: <https://code.claude.com/docs/en/cross-session-messaging>
- Cilium policy language: <https://docs.cilium.io/en/stable/security/policy/language/>
- Coder AI agents licensing: <https://github.com/coder/coder/blob/main/docs/ai-coder/agents/licensing-usage.md>
- kagent: <https://github.com/kagent-dev/kagent>
