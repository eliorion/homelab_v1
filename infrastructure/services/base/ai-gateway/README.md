# ai-gateway

One endpoint for every LLM call in the homelab — from devcontainers, from
projects, and from agent pods in the cluster.

**Bifrost is the current implementation, not the contract.** Everything a client
touches is deliberately vendor-neutral, so replacing the backend (LiteLLM, or
anything else that speaks the same two wire protocols) is a change to
`release.yaml` and nothing else.

---

## The contract

| Thing | Value |
|---|---|
| In-cluster base URL | `http://ai-gateway.ai-gateway.svc.cluster.local:8080` |
| Tailnet base URL | `https://ai-gateway.<your-tailnet>.ts.net` |
| Anthropic-compatible path | `<base>/anthropic` |
| OpenAI-compatible path | `<base>/v1` |
| Credential | a virtual key the consumer holds itself |
| Model aliases | whatever you create in the dashboard |

Two rules keep the abstraction honest:

1. **Clients never name a vendor model.** They ask for an alias like
   `ai/sonnet`; the routing table decides which vendor model answers it.
   Re-pointing a tier is an edit in the dashboard, with no client redeploy.
2. **Clients never see a `BIFROST_*` name.** Provider keys never leave this
   namespace; a consumer holds only its own virtual key.

**This namespace exports nothing.** There is no ConfigMap and no Secret mirrored
anywhere, because neither is needed: a Kubernetes Service resolves from any
namespace, so a consumer just uses the DNS name above, and each project holds
its own virtual key created in the dashboard. Earlier revisions reflected a
contract ConfigMap and one shared token into every consumer namespace; that
meant four annotations across two objects had to agree for a project to work,
and a namespace listed on only one of them failed silently with a 401.

## Connecting a project

Three things, all in the consumer's own directory — nothing here changes:

1. **Create a virtual key** for that project in the dashboard.
2. **Store it** in a SOPS Secret in the project's namespace, and reference it
   with `secretKeyRef` (see `staging/dbtools/nao-ai-gateway-token.enc.yaml`).
   One key per project means it can be revoked, or have its spend read off,
   without touching any other consumer.
3. **Allow egress** to the `ai-gateway` namespace (label `name: ai-gateway`) on
   8080 — this, not any mirrored object, is what actually grants the path.

Then point the client at the base URL, append the path its SDK speaks, and name
an alias that exists as a routing rule. That last coupling is the one thing
nothing enforces: an alias no rule matches is rejected as an unknown model.

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

Everything lives in the consumer's own namespace — see "Connecting a project"
above. The address is a plain Service DNS name, the credential is that
project's own virtual key:

```yaml
env:
  - name: LLM_BASE_URL
    value: "http://ai-gateway.ai-gateway.svc.cluster.local:8080"   # + /v1 or /anthropic
  - name: LLM_MODEL
    value: "ai/sonnet"                                             # must match a routing rule
  - name: LLM_API_KEY
    valueFrom:
      secretKeyRef:
        name: <project>-ai-gateway-token
        key: AI_GATEWAY_TOKEN
```

Plus a NetworkPolicy allowing egress to the `ai-gateway` namespace (label
`name: ai-gateway`) on 8080. `dbtools/nao-deployment.yaml` is a worked example.

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
3. Create the routing rules your projects ask for — e.g. `ai/opus`,
   `ai/sonnet`, `ai/fast`. An alias no rule matches is rejected as an unknown
   model, so create these before pointing a client at one.
4. Create one virtual key **per consuming project**, and store each in that
   project's own namespace — see "Connecting a project" above.

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

**Rotate a project's token.** Create a new virtual key in the dashboard, disable
the old one, then `sops` that project's own Secret and set `AI_GATEWAY_TOKEN` to
the new value:

```bash
sops infrastructure/services/staging/dbtools/nao-ai-gateway-token.enc.yaml
```

Nothing in the `ai-gateway` namespace changes, and no other consumer is
affected. The cost of that isolation: rotating *everything* is one edit per
project rather than one edit total — the trade this design makes for
per-project revocation and per-project spend attribution.

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
