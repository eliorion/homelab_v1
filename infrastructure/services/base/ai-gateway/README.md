# ai-gateway

One endpoint for every LLM call in the homelab — from devcontainers, from
projects, and from agent pods in the cluster.

**Bifrost is the current implementation, not the contract.** Everything a client
touches is deliberately vendor-neutral, so replacing the backend (LiteLLM, or
anything else that speaks the same two wire protocols) is a change to
`release.yaml` and nothing else.

---

## The contract

| Thing | Value | Set by |
|---|---|---|
| In-cluster base URL | `http://ai-gateway.ai-gateway.svc.cluster.local:8080` | `contract.yaml` (ConfigMap `ai-gateway-contract`) |
| Tailnet base URL | `http://ai-gateway.<your-tailnet>.ts.net` | Tailscale operator annotations in `release.yaml` |
| Anthropic-compatible path | `<base>/anthropic` | backend |
| OpenAI-compatible path | `<base>/v1` | backend |
| Credential | `AI_GATEWAY_TOKEN` | Secret `ai-gateway-token` (staging overlay) |
| Model aliases | `ai/opus`, `ai/sonnet`, `ai/fast` | routing rules in `release.yaml` |

Two rules keep the abstraction honest:

1. **Clients never name a vendor model.** They ask for `ai/sonnet`; the routing
   table decides that today it means Anthropic `claude-sonnet-5`. Re-pointing a
   tier is a one-line edit here, with no client redeploy.
2. **Clients never see a `BIFROST_*` name.** The provider keys and the virtual
   key stay in the `ai-gateway` namespace; consumers get `AI_GATEWAY_TOKEN`.

## Using it

### Laptop / devcontainer (over Tailscale)

```bash
export AI_GATEWAY_TAILNET=tail1234.ts.net       # your tailnet
export AI_GATEWAY_TOKEN=sk-bf-...               # from the ai-gateway-token Secret
source scripts/ai-gateway-env
```

That script is the only place any vendor-specific variable name appears — it
maps the contract onto `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` for Claude
Code and `OPENAI_BASE_URL` / `OPENAI_API_KEY` for OpenAI-compatible clients.

Claude Code caches its own credential, so after changing auth run `/logout` and
restart it. It also honours `ANTHROPIC_API_KEY` **above** `ANTHROPIC_AUTH_TOKEN`
— the script unsets it, because a stale key silently bypasses the gateway and
bills Anthropic directly.

Smoke test:

```bash
curl -s "$AI_GATEWAY_BASE_URL/anthropic/v1/messages" \
  -H "x-api-key: $AI_GATEWAY_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"ai/fast","max_tokens":16,"messages":[{"role":"user","content":"say OK"}]}'
```

### In-cluster (agent pods, jobs)

Consume the contract as data. Nothing in the pod spec names the backend:

```yaml
envFrom:
  - configMapRef:
      name: ai-gateway-contract   # AI_GATEWAY_BASE_URL + the ai/* aliases
  - secretRef:
      name: ai-gateway-token      # AI_GATEWAY_TOKEN
```

Both objects are mirrored by Reflector into `asp`, `fbref`, `lab` and `scraper`
— extend the `reflection-*-namespaces` annotations in `contract.yaml` and the
staging Secret to add a namespace.

Agent pods also need a NetworkPolicy allowing egress to the `ai-gateway`
namespace (label `name: ai-gateway`) on 8080.

### Dashboard

`http://ai-gateway.<your-tailnet>.ts.net` — login from the `ai-gateway-admin`
Secret. Usage, per-key spend and request logs live there. Note `sourceOfTruth:
config.json`: sections declared in `release.yaml` are authoritative, so edits
made in the UI to providers, virtual keys or routing rules are pruned on the
next restart. Change them in Git.

## Operating it

**Rotate the client token.** `sops infrastructure/services/staging/ai-gateway/ai-gateway-secrets.enc.yaml`,
change `AI_GATEWAY_VK` **and** `AI_GATEWAY_TOKEN` to the same new value, commit.
Reflector re-mirrors within seconds; the gateway picks it up on restart.

**Add a provider.** Add the key to `ai-gateway-providers` in that Secret, add a
`bifrost.providers.<name>` block referencing `env.<KEY>`, and (if it should
serve a tier) point a routing rule at it.

**Re-point a model tier.** Edit the `targets` of the matching rule in
`release.yaml`. No client changes.

**Swap the backend.** Rewrite `release.yaml` so the replacement keeps: the
Service name `ai-gateway` on port 8080, the tailnet hostname, the `/anthropic`
and `/v1` paths, virtual-key auth on one header, and the three `ai/*` aliases.
`contract.yaml`, the staging Secrets, the helper script and every consumer stay
untouched.

## Verify

```bash
kubectl kustomize infrastructure/services/staging   # renders?
flux get helmreleases -n flux-system ai-gateway
kubectl -n ai-gateway get cluster ai-gateway-db      # CNPG, 2/2 instances
kubectl -n ai-gateway get pods,svc
kubectl -n ai-gateway logs deploy/ai-gateway | head
```

Then check the tailnet hostname registered (`tailscale status`, or the Tailscale
admin console) and run the smoke test above.

## Deliberate limitations

**No cross-provider fallback.** Failing `ai/opus` over to another vendor would
change behaviour, tool-call semantics and cost invisibly. Failover is an
explicit edit to the routing rule, not a default.

**Auth is a shared virtual key, not Keycloak.** Bifrost OSS authenticates
inference with virtual keys; its SSO/OIDC integration is an enterprise feature,
and Claude Code cannot refresh an OIDC token on its own anyway. Per-user
identity is a phase-2 change **behind this contract**, and it lands in exactly
one of two places:

- **Keycloak-issued service tokens** — a dedicated confidential client per
  project, a helper that refreshes the token into `AI_GATEWAY_TOKEN`, and an
  `ai-gateway-auth` proxy in front that validates the JWT and swaps it for the
  backend virtual key. Consumers keep reading `AI_GATEWAY_TOKEN`; only the
  helper and the proxy are new.
- **Backend-native SSO** — if the backend gains usable OIDC inference auth,
  wire it to the existing `identity` realm and drop the proxy.

Either way the client contract above does not change — which is the point of
having written it down before shipping the auth layer.
