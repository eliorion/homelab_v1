# 21 — Credential brokering for sandboxed AI agents

**Status: design study, nothing deployed.** Written 2026-10-08. It answers one question
and ends in a recommendation:

> Many coding agents should run side by side in isolated environments. Each one should hold
> credentials for **its own GitHub repository and nothing else**. Every sensitive action
> (the cluster kubeconfig, cloud API keys, database logins) should go through something that
> holds the secret on the agent's behalf. What should that something be, and is a
> credential-holding MCP server the right shape for it?

Tool facts were checked against upstream repositories and docs on 2026-10-08. Anything that
could not be confirmed is listed in [§9](#9-not-verified-yet). Check it before you build on it.

---

## 1. The idea that drives everything else

**Hiding a secret is not the same as limiting what an agent can do with it.**

A proxy that holds an admin kubeconfig and forwards `kubectl` for the agent does protect the
*secret*. The agent cannot copy the file and keep using it after the sandbox is gone. But the
*capability* is untouched: `kubectl delete ns paperclip` goes through the proxy just as
well. A prompt injection in an issue body, a poisoned README or a malicious dependency
"asks" the agent, the agent asks the proxy, and the proxy obeys. That is the confused-deputy
problem, and putting the proxy behind MCP does not change it.

So a credential proxy solves one of the three real problems:

| Threat | Fixed by |
|---|---|
| **Exfiltration.** A long-lived secret leaves the sandbox and is used later, from anywhere. | Short-lived credentials, a broker that holds the long-lived ones, and egress lockdown |
| **Misuse in place.** The agent does damage with the access it legitimately has. | Least-privilege identity per agent, read/write separation, human approval for writes |
| **Lateral movement.** One agent reads another agent's repository, workspace or tokens. | One sandbox per task, one identity per task, network policy between sandboxes |

Any design worth building covers all three. The options below are compared on that basis.

## 2. What the cluster already has

Most of the parts are already here:

- **`ai-gateway` (Bifrost)** already works this way for LLM keys. Provider keys never leave
  the `ai-gateway` namespace, and each consumer holds a virtual key it can lose without
  harm. Bifrost also has an MCP-client section, so it is a candidate tool gateway as well
  ([README](../infrastructure/services/base/ai-gateway/README.md)).
- **Paperclip** is the agent control plane. Today its agents run **inside the Paperclip
  pod**: they share one filesystem, one `GITHUB_TOKEN` PAT covering every project repo,
  and one Claude token. That is exactly what this document wants to replace. Its README
  already names "Kubernetes sandboxes" as a later phase
  ([README](../apps/base/paperclip/README.md)).
- **OpenBao** has Kubernetes auth with a templated policy, so a ServiceAccount can only read
  its own namespace's folder. Its built-in **Kubernetes secrets engine** can mint
  ServiceAccount tokens with a TTL, and can create the SA/Role/RoleBinding and delete them
  when the lease expires ([README](../infrastructure/services/base/openbao/README.md)).
- **Keycloak** already runs an `mcp` realm with RFC 8707 audiences for fbref-mcp
  ([02](02-keycloak.md)).
- **Cilium 1.19** provides `CiliumNetworkPolicy` with `toFQDNs` and an embedded Envoy.
  Default-deny exists only in `dev-platform` today ([14 §10](14-design-decisions.md#10-open-work)).
- **dev-platform** has already proven the pattern "give CI a kubeconfig to a vcluster, never
  to the host", with a narrowly scoped token and a ValidatingAdmissionPolicy
  ([19](19-dev-platform.md)).
- **Kyverno** is present for admission policy.
- **The repository is GitOps.** Nothing is `kubectl apply`'d by hand. That matters a lot:
  an agent never needs write access to the cluster, because its writes are pull requests
  that Flux applies after a human merges them.

## 3. The five layers

Every option is a choice of how to fill these five layers. None of them fills all five on
its own:

1. **Sandbox.** Where the agent's process runs, and what isolates it from the node and from
   other agents.
2. **Egress.** Where the sandbox may connect. Without this layer, every other control can be
   bypassed by exfiltration.
3. **Identity.** What proves "this is agent X working on repo Y" to everything else.
4. **Credential delivery.** How a secret becomes usable: handed to the agent, short-lived;
   injected on the wire; or used by a server on the agent's behalf.
5. **Action control.** Which operations an identity may perform, and which need a human.

## 4. The options

### A. An MCP credential gateway (the original idea)

The agent holds one credential, for the gateway. The gateway holds the secrets and exposes
*tools*: `k8s_get_pods`, `flux_reconcile`, `db_query`, and so on. Behind it run MCP servers
such as `containers/kubernetes-mcp-server`, the Flux Operator MCP server, or a DB server.

Off-the-shelf gateways that fit Talos + Keycloak + OpenBao:

| Gateway | Fit | Notes |
|---|---|---|
| **agentgateway** (Linux Foundation, Apache-2.0, v1.6) | Best | Rust, Gateway API control plane, MCP OAuth with a documented Keycloak adapter, RFC 8693 token exchange to backends: "the MCP server never sees the incoming token, the caller never holds a credential for the MCP server". Its APIs move fast. |
| **ToolHive operator** (Stacklok, Apache-2.0) | Good | `MCPServer` / `VirtualMCPServer` CRDs, an embedded OAuth server that keeps upstream tokens server-side, token exchange. Needs Redis to scale beyond one replica. |
| **Bifrost** (already deployed) | Cheapest to try | Already running, and already issues one virtual key per consumer. It is OSS virtual-key auth only (no OIDC), it is pinned to one replica, and its config lives in the dashboard, not git. Whether tools can be filtered per virtual key is not yet verified. |
| Pomerium MCP, IBM ContextForge, Obot | Possible, heavier | Pomerium's MCP support is behind an experimental flag. ContextForge and Obot each bring Postgres + Redis (+ S3 + KMS for Obot). |
| Docker MCP Gateway, Microsoft MCP Gateway | No | Docker-Desktop-centric and Entra/Azure-centric respectively. |

**What protects the cluster** is the RBAC of the identity the MCP server calls with. The
`--read-only` and `disable_destructive` flags of `kubernetes-mcp-server` are defence in
depth on top of that. Its `cluster_auth_mode` can pass the caller's identity through, or
exchange it, so RBAC follows the agent instead of a shared ServiceAccount.

| | |
|---|---|
| **Pros** | The secret never enters the sandbox. Every action is a named, auditable tool call. Tools can be allowed per agent. Write tools are a natural place for a human approval step. It follows the MCP authorization spec (no token passthrough; the server gets its own token). |
| **Cons** | Agents are far better with real CLIs than with a tool catalogue. Every capability not exposed as a tool is unavailable, so you keep adding tools. Many tools also cost context. Coverage stops at what someone wrapped. It protects the secret, **not the capability**: a write tool is just as dangerous as a write kubeconfig. It is another stateful service in the critical path, and the MCP auth spec is still changing (DCR is being replaced by CIMD). |
| **Covers** | Exfiltration ✔ for whatever it fronts. Misuse ✔ only if tools are read-only or approval-gated. Lateral ✘ (that needs the sandbox). |

### B. A credential-injecting egress proxy

This is the pattern Claude Code on the web and the GitHub Copilot coding agent use. The
agent runs ordinary CLIs. All of its traffic goes through a proxy, which recognises the
destination (`api.github.com`, `api.cloudflare.com`, the API server) and adds the real
`Authorization` header. The agent holds only a placeholder or a session token. For git, a
small smart-HTTP proxy can also enforce rules such as "push only to `agent/*`".

Building blocks: Envoy's `credential_injector` filter (from agentgateway or Envoy Gateway),
**Infisical Agent Vault** (preview, "not recommended for production", no OpenBao backend
documented), and **OneCLI** (Apache-2.0, early, dashboard has no login by default). Smokescreen
and httpjail filter egress but do not inject credentials.

| | |
|---|---|
| **Pros** | It works with every CLI and SDK unchanged, including `gh`, `curl` and language SDKs. The agent never sees any real token, not even GitHub's. One choke point carries the allowlist, the audit and the injection. |
| **Cons** | HTTPS means the proxy must terminate TLS: a private CA trusted inside the sandbox, which tools pinning certificates will refuse. Only HTTP(S) is covered, so Postgres and SSH are not. The proxy needs per-sandbox identity to choose *which* credential to inject. Like option A, it protects the secret and not the capability: kubectl through an injecting proxy carries the full scope of whatever token is injected. The open-source dedicated projects are six months old. |
| **Covers** | Exfiltration ✔ (strongest). Misuse ✘ on its own. Lateral ✘. |

### C. Per-agent identity with short-lived, scoped credentials (no proxy)

Do not hide a powerful credential. Give each agent a **weak credential of its own**, valid
for minutes, and let the real servers enforce it.

- **Kubernetes:** each sandbox pod runs as its own ServiceAccount. Its projected token is
  audience-bound and short-lived, and it carries only the RBAC you grant: for example a
  `view`-like ClusterRole without Secrets, or nothing at all. Plain `kubectl` works. The API
  server already **is** the proxy: it authenticates, authorizes and writes the audit log. The
  OpenBao Kubernetes secrets engine can mint such tokens per task instead.
- **GitHub:** a GitHub App, not a PAT. An installation token can be restricted to **one
  `repository_id`** and a set of permissions, and it expires after one hour. Branch rulesets
  on GitHub (no push to `main`, required review) are enforced server-side, whatever the
  token. Minting options:
  - OpenBao with `martinbaillie/vault-plugin-secrets-github`. Policy can pin
    `repository_ids`. The plugin is slowing down and its OpenBao compatibility is untested.
  - Chainguard **octo-sts**, where a trust policy lives in the target repo. It is
    GCP-shaped (Firestore, KMS) to self-host.
  - A small minter (§7).
- **Everything else in OpenBao:** the sandbox SA logs in with Kubernetes auth and reads only
  its own folder. Use dynamic database credentials where the engine exists.

| | |
|---|---|
| **Pros** | Nothing new sits in the data path. Native tools work, and so do protocols other than HTTP. Each server's own authorization model applies, which is stronger than anything a proxy can re-implement. A leaked token is worth one repo for one hour. Mostly configuration, little code. |
| **Cons** | The token **is** inside the sandbox, so a compromised agent can use it from elsewhere until it expires. That makes egress lockdown mandatory, not optional. It only works for services with a scoped, short-lived credential model. A static third-party API key (Cloudflare, an SMTP password) has no such model. Something still has to *mint* per-task GitHub tokens. |
| **Covers** | Exfiltration ~ (bounded by TTL and scope). Misuse ✔ (least privilege, server-enforced). Lateral ✔ with one SA per task. |

### D. Give each agent its own cluster

Point the agent at a vcluster, the way dev-platform does for CI. Inside it the agent can be
`cluster-admin`, and a Cilium deny boundary keeps it away from the host.

| | |
|---|---|
| **Pros** | The agent can do *anything*, including `kubectl apply`, Helm and CRDs, without risk to staging. The pattern is already proven in this repo. |
| **Cons** | It answers "the agent needs a playground cluster", not "the agent needs to look at staging". Debugging a real staging problem still needs read access to the host cluster. Each vcluster costs a control plane, unless agents share the existing dev-platform. |
| **Covers** | All three, for cluster access only. |

### E. Buy it whole: Teleport

Teleport combines Machine ID (`tbot`, short-lived identities for bots), MCP access with
role-based tool filtering and audit (v18.1+), Kubernetes access, and since 2026 **Beams**:
per-agent Firecracker microVMs with delegated identity. The source is AGPL-3.0. Community
Edition is free for personal use.

| | |
|---|---|
| **Pros** | One product covers identity, the proxy, audit and session recording, for kubectl, SSH, databases and MCP alike. It is mature. |
| **Cons** | It is a second identity system beside Keycloak and a second secret system beside OpenBao. It is heavy for one person. Whether MCP access is in Community Edition, and whether Beams can be self-hosted, are both unverified. It pulls the design away from everything already built here. |

### F. Build the whole broker yourself

A single "MCP server with all the credentials", written from scratch.

| | |
|---|---|
| **Pros** | It fits exactly. |
| **Cons** | You would re-implement OAuth, the MCP authorization spec, auditing, tool schemas and a kubectl wrapper. That is a security-critical service with one maintainer, and agentgateway, ToolHive and kubernetes-mcp-server already do it. **The only piece worth writing yourself is narrow** (§7). |

### Side by side

| | A. MCP gateway | B. Injecting proxy | C. Scoped identity | D. vcluster | E. Teleport | F. DIY |
|---|---|---|---|---|---|---|
| Secret stays out of the sandbox | ✔ | ✔✔ | ✘ (short-lived) | ✔ | ✔ | ✔ |
| Limits what the agent can *do* | if tools are read-only | ✘ | ✔✔ | ✔ (blast radius) | ✔ | depends |
| Agent uses native CLIs | ✘ | ✔ | ✔ | ✔ | ✔ | ✘ |
| Non-HTTP (Postgres, SSH) | via tools | ✘ | ✔ | n/a | ✔ | via tools |
| New moving parts | 1 gateway + N MCP servers | 1 proxy + CA | a token minter | 0 (exists) | a whole platform | everything |
| Maturity in 2026 | medium, spec moving | low (OSS) | high | proven here | high | — |
| Fits Keycloak + OpenBao | ✔ | partly | ✔✔ | ✔ | ✘ | ✔ |

## 5. Answers to the two concrete cases

### The kubeconfig

Do **not** put the admin kubeconfig behind a proxy. In this repository an agent's write to
the cluster is a commit, and a commit reaches the cluster only through Flux after a human
merges the PR. So:

- **Reads** (logs, events, `get`, `describe`, Flux status): give each sandbox its own SA,
  with a ClusterRole like `view` minus `secrets`, `pods/exec`, `pods/portforward` and
  `serviceaccounts/token`. Plain `kubectl` works with it. If you also want a tool interface,
  run `kubernetes-mcp-server --read-only` and the Flux MCP server `--read-only` (secret
  masking on by default) behind the gateway.
- **Writes:** by pull request only. If an operations agent truly needs live actions
  (restart a Deployment, `flux reconcile`), expose those as individual MCP tools behind the
  gateway. Give them a separate identity minted by the OpenBao Kubernetes engine with a
  10-minute lease, and gate them on human approval.
- **Playground:** a namespace in dev-platform, or a vcluster, where it can be admin.

### GitHub, the one secret the agent holds

Replace Paperclip's shared fine-grained PAT with a **GitHub App** installed on the project
repositories. When a task starts, a broker mints an installation token restricted to that
task's `repository_id` with `contents:write` and `pull_requests:write`, valid one hour, and
hands it to the sandbox. A GitHub ruleset stops anything from pushing to `main` and requires
review, so even a hijacked agent can only open a PR on its own repo. If you later want
the token out of the sandbox entirely, put the option-B git proxy in front. That is an
upgrade, not a prerequisite.

## 6. Recommendation

**A hybrid: C as the foundation, A for the operations that need a deputy, and B only where
nothing else works.** In order, each phase useful on its own:

| Phase | What | Fixes |
|---|---|---|
| **0. Stop sharing** | GitHub App instead of the PAT. One Bifrost virtual key per agent/project instead of one subscription token in the pod env. A ruleset on every agent repo: no push to `main`, PR review required. | The single biggest risk today: every agent can read every project's token |
| **1. Sandbox** | One pod per task, created through `kubernetes-sigs/agent-sandbox` (v1.0, `Sandbox`/`SandboxTemplate`/`SandboxWarmPool`), on a gVisor `RuntimeClass` (the Talos `gvisor` extension). Paperclip's "Kubernetes sandbox" target dispatches to it. Own SA per sandbox, `automountServiceAccountToken` only where wanted. | Lateral movement; node escape |
| **2. Egress** | `CiliumNetworkPolicy` default-deny for sandbox namespaces. Allow `toFQDNs` `github.com` / `api.github.com` / `codeload.github.com`, `ai-gateway`, Harbor, Nexus, the broker, the gateway. Nothing else. | Exfiltration of whatever the sandbox holds, short-lived or not |
| **3. Broker** | A small `agent-broker` (§7) that mints the per-repo GitHub token, plus OpenBao Kubernetes auth for per-agent KV paths. | Long-lived secrets in sandboxes |
| **4. Tool gateway** | agentgateway with one Keycloak client per agent. Behind it: `kubernetes-mcp-server --read-only`, Flux MCP `--read-only`, DB tools whose credentials come from OpenBao. Write tools come later, approval-gated. Try Bifrost's MCP section first if per-key tool filtering checks out, since it is already running. | Secrets that must never be handed out, not even short-lived |
| **5. Optional** | Credential-injecting egress (Envoy `credential_injector`, or Agent Vault/OneCLI once mature) for static third-party API keys that have no scoped-token model. | The leftover cases |

**Why not the original "one MCP server with everything" alone.** It makes the agent worse,
because it loses the CLIs it is good at, and it does not stop misuse, because the deputy
still obeys. You would also maintain the hardest part (OAuth, tool wrappers) yourself. Kept
in its proper place, the MCP gateway of phase 4 is the right answer for the few
capabilities that must stay entirely server-side.

**What it costs.** Two new services (the broker, then the gateway), a GitHub App, a
`RuntimeClass` on the nodes, and network policy in a cluster that has almost none today. The
egress allowlist will break agent tasks until it has learned which mirrors and registries
they need. Expect a few rounds of "connection refused" before it settles.

## 7. The one thing worth building: `agent-broker`

Everything else is off the shelf. What no project does cleanly on Kubernetes + OpenBao is
"mint a GitHub token for exactly the repo this pod is assigned to". A sketch:

```
sandbox pod (SA agent-<task>)                       agent-broker                       OpenBao
  │ POST /github/token                                 │                                   │
  │ Authorization: Bearer <projected SA token,         │                                   │
  │                        aud=agent-broker>           │                                   │
  ├───────────────────────────────────────────────────▶│ TokenReview → ns/sa, pod UID      │
  │                                                    │ pod annotation                    │
  │                                                    │   agents.eliorion.fr/repo-id      │
  │                                                    │   (set by the controller, which   │
  │                                                    │    the agent cannot edit)         │
  │                                                    │ transit/sign App JWT ────────────▶│ App private key never
  │                                                    │◀────────────────────────────────  │ leaves OpenBao
  │                                                    │ POST /app/installations/{id}/     │
  │                                                    │   access_tokens                   │
  │                                                    │   {repository_ids:[id],           │
  │                                                    │    permissions:{contents:write,   │
  │                                                    │     pull_requests:write}}         │
  │◀───────────────────────────────────────────────────┤ 1h token, audit log line          │
```

- **Trust root:** the pod's projected token. The repo binding is read from the *pod*,
  which the agent cannot change, never from the request.
- **The App private key stays inside OpenBao.** It is imported into a Transit key and the
  broker asks Transit to sign the App JWT (RS256 / PKCS#1 v1.5). A compromised broker can
  mint tokens while it runs, but it cannot steal the key.
- **About 300 lines of Go**, stateless, one Deployment, its own namespace, audited through
  OpenBao's audit log plus its own.
- **Alternative to building it:** register `vault-plugin-secrets-github` in OpenBao and
  let the sandbox read `github/token` with a policy templated on its SA. That means no new
  service, but it relies on a slowing plugin with no stated OpenBao support, and it needs
  per-agent policy parameters for the repo ID. Try it first. Build the broker if it does not
  load or cannot be templated.

## 8. Threats that remain, whatever is built

- **Prompt injection inside the agent's own repo.** An issue, a PR comment or a dependency
  README can steer the agent within its legitimate scope. Rulesets and review are the
  control, not the broker.
- **Toxic flow:** private data, plus untrusted input, plus an outbound channel, all in one
  agent. Egress lockdown breaks the third leg. A PR on a public repo is itself an outbound
  channel, which is another reason to keep agents off repos that hold secrets.
- **Tool poisoning.** Only run MCP servers you deploy and pin yourself. Never let an agent
  register one.
- **The broker and the gateway become crown jewels.** They belong on the SOPS/OpenBao side
  of the line drawn in the OpenBao README, with an audit log shipped to Loki.

## 9. Not verified yet

Check these before you rely on them:

- Whether `martinbaillie/vault-plugin-secrets-github` loads in OpenBao 2.7, and whether its
  `repository_ids` can be pinned through templated policy.
- OpenBao Transit: whether an imported RSA key can sign a GitHub App JWT with PKCS#1 v1.5.
- Whether Bifrost can filter MCP tools per virtual key.
- Whether agentgateway's GatewayClass coexists cleanly with Cilium's Gateway API
  implementation.
- The maturity status of Envoy's `credential_injector` filter.
- Whether Teleport MCP access is in Community Edition, and whether Beams can be
  self-hosted.
- Whether the Talos nodes expose KVM (needed for Kata; gVisor does not need it).
- How Paperclip's remote-execution targets actually dispatch to Kubernetes, and how a
  per-task repo binding would reach the pod annotations.

## References

- agentgateway token exchange: <https://agentgateway.dev/docs/kubernetes/main/documentation/security/backend-authn/token-exchange/mcp/>
- ToolHive embedded auth server: <https://docs.stacklok.com/toolhive/concepts/embedded-auth-server>
- kubernetes-mcp-server: <https://github.com/containers/kubernetes-mcp-server>
- Flux MCP server: <https://fluxoperator.dev/docs/mcp/config/>
- agent-sandbox: <https://github.com/kubernetes-sigs/agent-sandbox>
- Claude Code sandboxing (git proxy, egress allowlist): <https://anthropic.com/engineering/claude-code-sandboxing>
- Copilot coding agent firewall: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall>
- Infisical Agent Vault: <https://infisical.com/docs/documentation/platform/agent-vault/how-it-works>
- OneCLI: <https://github.com/onecli/onecli>
- GitHub App token plugin: <https://github.com/martinbaillie/vault-plugin-secrets-github>
- octo-sts: <https://github.com/octo-sts/app>
- Teleport MCP access: <https://goteleport.com/docs/enroll-resources/mcp-access/getting-started/>
