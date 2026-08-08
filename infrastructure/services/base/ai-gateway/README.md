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
| Tailnet base URL | `https://ai-gateway.<your-tailnet>.ts.net` | `ingress-tailscale.yaml` (Tailscale Ingress) |
| Anthropic-compatible path | `<base>/anthropic` | backend |
| OpenAI-compatible path | `<base>/v1` | backend |
| Credential | `AI_GATEWAY_TOKEN` | Secret `ai-gateway-token` (staging overlay) |
| Model aliases | whatever you create | routing rules **in the dashboard** |

Two rules keep the abstraction honest:

1. **Clients never name a vendor model.** They ask for an alias like
   `ai/sonnet`; the routing table decides which vendor model answers it.
   Re-pointing a tier is an edit in the dashboard, with no client redeploy.
2. **Clients never see a `BIFROST_*` name.** The provider keys and the virtual
   key stay in the `ai-gateway` namespace; consumers get `AI_GATEWAY_TOKEN`.

Git publishes only the **address**. It deliberately does not publish the alias
names: routing rules are created in the dashboard, so a `AI_GATEWAY_MODEL_*`
key in Git would assert a rule that might not exist. A consumer names the alias
it needs, and that alias has to have been created in the UI — that coupling is
what this design trades for UI ownership, and nothing enforces it.

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

`https://ai-gateway.<your-tailnet>.ts.net` — login from the `ai-gateway-admin`
Secret. HTTPS on 443 with a MagicDNS-issued certificate, served by the Tailscale
Ingress; there is no port in the URL and no plain-HTTP listener on the tailnet.

**This is where the gateway is configured.** Providers, provider keys,
virtual keys, the `ai/*` routing rules, budgets, rate limits, teams, MCP clients
and plugins all live in the config store (Postgres) and are edited here.

`release.yaml` declares none of them, and `sourceOfTruth: split` means the file
never re-applies what it does not declare — so a pod restart, a Helm upgrade or
a Flux reconcile cannot revert a dashboard edit. Git owns the infrastructure;
the UI owns the configuration.

## Operating it

**Bootstrap a fresh database.** A new `ai-gateway-db` has no providers and no
virtual keys, and `enforceAuthOnInference: true` means nothing can call the
gateway yet. In order:

1. Log into the dashboard with the `ai-gateway-admin` credentials.
2. Add a provider and its key (see the raw-vs-`env.` choice below).
3. Create a virtual key — this is the value clients send.
4. `sops infrastructure/services/staging/ai-gateway/ai-gateway-secrets.enc.yaml`
   and set `AI_GATEWAY_TOKEN` to that virtual key. Commit.
5. Create the three routing rules `ai/opus`, `ai/sonnet`, `ai/fast` so the
   published contract resolves.

**Add a provider.** Dashboard → Providers. Two ways to supply the key, and they
differ in where the secret's system of record ends up:

- **Raw value** — encrypted at rest in Postgres. Recoverable only from a DB
  backup *plus* `BIFROST_ENCRYPTION_KEY`. Nothing to commit.
- **`env.OPENAI_API_KEY`** (the literal string) — resolved at load time from the
  `ai-gateway-providers` Secret, so SOPS stays the system of record and the
  database holds no key material. Requires adding the variable to that Secret
  first. Verify this resolves for UI-entered keys before relying on it; it is
  documented for `config.json`, not explicitly for dashboard input.

**Re-point a model tier.** Dashboard → the matching routing rule → change its
target. No client change, no commit, no restart.

**Rotate the client token.** Create a new virtual key in the dashboard, then
`sops` the staging Secret and set `AI_GATEWAY_TOKEN` to it. Reflector re-mirrors
within seconds. `AI_GATEWAY_VK` is no longer used — the virtual key is created
in the UI, not injected from the Secret.

**Swap the backend.** Rewrite `release.yaml` so the replacement keeps: the
Service name `ai-gateway` on port 8080, the tailnet hostname, the `/anthropic`
and `/v1` paths, virtual-key auth on one header, and the three `ai/*` aliases.
`contract.yaml`, the staging Secrets, the helper script and every consumer stay
untouched. Note the configuration itself does **not** come along: it lives in
Bifrost's own schema, so a new backend starts empty and its providers, keys and
routing rules are re-entered in the replacement's UI.

## Backup & restore

The config store is the only copy of the gateway's configuration, so
`ai-gateway-db`'s backups are the recovery path — not Git.

`ai-gateway-db` archives to Garage (bucket `cnpg-staging-ai-gateway`, its own
key) with a daily base backup plus continuous WAL, giving PITR across the
retention window. To roll back a bad Bifrost upgrade or a mistaken UI edit,
restore the cluster to a timestamp before it.

Three things decide whether that actually works:

- **`BIFROST_ENCRYPTION_KEY` is the crown jewel.** Provider keys, virtual keys,
  OAuth tokens, MCP client and plugin configs are all encrypted at rest, so the
  Garage archive holds ciphertext. **Losing that key makes every backup
  permanently unrecoverable — there is no workaround.** It stays in SOPS on
  purpose: the archive and the key that opens it must not share a blast radius.
  Never rotate it after first boot; it cannot re-encrypt an existing store.
- **Rolling back a version is two moves, not one.** Bifrost migrates its schema
  forward on startup. Restoring an old dump into a *newer* Bifrost is fine — it
  migrates. Pinning the image *back* onto an already-migrated schema is the
  dangerous direction, so a version rollback means restoring the DB to the
  pre-upgrade point **and** pinning `images` back, together. Take an on-demand
  `Backup` before any Bifrost version bump.
- **The logs store shares this database.** `storage.logsStore` is Postgres too,
  and request/response rows will dwarf the config tables — they drive backup
  size and restore time, not the configuration itself.

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

**The configuration is not in Git.** Chosen, not accidental: providers, keys and
routing rules are edited in the dashboard, so changing a model tier costs no
commit, no PR and no reconcile wait. What that gives up is real — no review on a
routing change, no `git blame` on "who re-pointed `ai/sonnet`", no diff to revert.
The dashboard's own audit log and the DB backups above replace those. Everything
in this repo is still declarative; only the gateway's *content* is not.

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
