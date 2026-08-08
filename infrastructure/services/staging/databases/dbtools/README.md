# `database` namespace — pgAdmin + nao

Two clients that read the platform databases. Nothing here owns data. They sit
in `infrastructure/services` rather than `apps/` for the same reason
`ai-gateway` does: they serve every project and belong to none.

```
database ns
├── pgadmin   dpage/pgadmin4      SQL client            https://pgadmin.tail45b0ca.ts.net
├── nao       getnao/nao          analytics agent       https://nao.tail45b0ca.ts.net
└── dbtools-db  CNPG (1 instance) their own state: db `pgadmin` + db `nao`
```

All three live in **this one directory** — cluster and tools together. The
`databases/` tier here groups every `infrastructure/services` database, and
these tools ARE the database tooling, so unlike keycloak and ai-gateway (whose
workloads sit a tier up from their clusters) there is nothing to split off.
Nothing is lost by co-locating: `infrastructure/services/staging` is a **single**
Flux Kustomization, so `databases/` is a plain directory here — not the
separately-ordered unit `apps/staging/databases` is, which `db-migrations` and
`apps` `dependsOn`.

Reads, across namespaces:

| target  | host                                      | database   |
| ------- | ----------------------------------------- | ---------- |
| asp     | `asp-db-ro.asp.svc.cluster.local`         | automarket |
| fbref   | `fbref-db-ro.fbref.svc.cluster.local`     | fbref      |
| scraper | `scraper-db-ro.scraper.svc.cluster.local` | scraper    |

## Tailnet exposure

Both UIs are published by the **Tailscale operator** as an `Ingress`
(`ingressClassName: tailscale`), not by the `tailscale.com/expose` Service
annotation they used to carry:

```
https://pgadmin.tail45b0ca.ts.net    pgadmin-ingress-tailscale.yaml
https://nao.tail45b0ca.ts.net        nao-ingress-tailscale.yaml
```

`expose` is an L3 forward that preserves the Service port, so it served two
password-authenticated consoles over plain http on `:80` / `:5005`. The Ingress
terminates TLS at the proxy on 443 with a **MagicDNS-issued certificate** — no
cert-manager `Certificate`, no DNS record, no port in the URL — which is the
same call `keycloak-admin` and `ai-gateway` make.

Consequences worth knowing:

- **PRECONDITION:** *HTTPS Certificates* must be enabled in the Tailscale admin
  console (DNS → HTTPS Certificates). Without it the proxy comes up with no
  certificate and both UIs are unreachable.
- The Services carry **no** tailscale annotations. Both mechanisms at once
  register two devices contending for one hostname and the loser is suffixed
  (`nao-1`) — which for nao is exactly the `BETTER_AUTH_URL` mismatch below.
- `BETTER_AUTH_URL` (`nao-env-patch.yaml`) must equal the browser address byte
  for byte, so it is `https://nao.tail45b0ca.ts.net` — **no port**. It moves
  with the Ingress, never on its own.
- Migrating off `expose`: the old `nao` / `pgadmin` devices must be gone from
  the Tailscale admin console before the Ingress proxies register, or MagicDNS
  hands the new ones a suffixed name. Check `kubectl -n tailscale get pods` and
  the Machines page.

Tailnet identity is still the only authentication in front of either UI —
see below.

## Secrets

Every `*.enc.yaml` here has a committed `*.enc.yaml.example` beside it: the same
manifest with placeholder values and a header saying where the value comes from.
Fill the copy, then encrypt it — `.sops.yaml` selects the age key by **path**
(`staging/*.enc.yaml`), which the `.example` suffix does not match, so a template
is never encrypted and must never hold a real value.

```bash
cd infrastructure/services/staging/databases/dbtools
cp nao-secrets.enc.yaml.example nao-secrets.enc.yaml
$EDITOR nao-secrets.enc.yaml                      # fill the placeholders
sops --encrypt --in-place nao-secrets.enc.yaml    # staging age key, by path
```

| secret | value | source |
| --- | --- | --- |
| `pgadmin-admin` | `email` + `password` | chosen here; email also names the pgpass storage dir |
| `nao-secrets` | `better-auth-secret` | `openssl rand -base64 32`, generated once and never rotated casually |
| `nao-ai-gateway-token` | `AI_GATEWAY_TOKEN` | created in the ai-gateway dashboard, only stored here |

Edit an existing one in place with `sops <file>` (re-encrypts on save); read one
back with `sops -d <file>`.

## Why this is read-only

Both tools authenticate as each cluster's `app` OWNER role, mirrored in by
kubernetes-reflector from `<project>/<project>-db-app`. What makes that safe is
the **host**: every connection targets the CNPG `-ro` service, which selects
replicas only. A replica is in recovery and rejects any write with SQLSTATE
25006 — no grant, no NetworkPolicy and no UI setting is in that path.

The rw and ro Services select the **same pods**, so the NetworkPolicies cannot
express "replica only". Anyone who can reach pgAdmin on the tailnet can register
`<cluster>-rw` by hand and write. **Tailnet membership is therefore write
access.** If that stops being acceptable, the replacement is a per-database
read-only role (`analytics_ro`, NOLOGIN in Flyway + CNPG `managed.roles` + a
sops Secret each), not a network rule.

Reflection is permitted per source cluster in
`apps/staging/databases/<project>/cluster-reflector-patch.yaml`; nothing is
auto-mirrored — a secret lands here only because a stub in
`../../../base/databases/dbtools/db-reflect-stubs.yaml` names it. Those source clusters live
in the **apps** tier, which reconciles after this one, so on a first-ever
install the pods restart until the credentials arrive.

## LLM access

nao calls **ai-gateway**, never a provider: `NAO_LLM_BASE_URL` and
`NAO_LLM_MODEL` come from the reflected `ai-gateway-contract` ConfigMap
(`/v1` + the `ai/sonnet` alias) and the credential from the `ai-gateway-token`
Secret. The NetworkPolicy allows the `ai-gateway` namespace on 8080 and nothing
else outbound — the agent has no route to the internet.

All three refs are `optional: true`, so a missing mirror costs chat, not the pod.

## Where state lives

| what                                     | where                                   |
| ---------------------------------------- | --------------------------------------- |
| pgAdmin users / saved servers / prefs     | `pgadmin` database on `dbtools-db`      |
| pgAdmin sessions + pgpass                 | pod emptyDir (rebuilt each start)       |
| nao users / sessions / chat history       | `nao` database on `dbtools-db`          |
| nao project: `nao_config.yaml` + context  | PVC `nao-project` at `/app/project`     |

`dbtools-db` carries **no backup**: losing it costs a re-login and a re-import
of `servers.json`, not data.

## First run

**pgAdmin** — log in with the credentials in `pgadmin-admin.enc.yaml`
(`sops -d infrastructure/services/staging/databases/dbtools/pgadmin-admin.enc.yaml`). The
three servers are pre-registered and connect with no password prompt: the init
container writes a `pgpass` from the reflected CNPG secrets on every start, so a
credential rotation needs only
`kubectl -n database rollout restart deploy/pgadmin`.

`servers.json` is imported **once per user**. Editing the ConfigMap later does
not re-import — delete the server in the UI first.

**nao** — the first visitor self-registers and becomes admin; everyone after is
invited from the UI. Then build the context:

```bash
kubectl -n database exec -it deploy/nao -- nao sync
```

## Changing nao's config

`../../../base/databases/dbtools/nao-config-configmap.yaml` is a **seed**: the init container
copies it in with `cp -n`, so it only applies to an empty project directory.
That is deliberate — `nao init` / `nao sync` inside the pod write to the same
file, and a ConfigMap that overwrote on every boot would silently discard them.

```bash
# edit in place (survives restarts, not in git)
kubectl -n database exec -it deploy/nao -- sh -c 'vi /app/project/nao_config.yaml'

# re-seed from git (discards the pod's copy)
kubectl -n database exec deploy/nao -- rm /app/project/nao_config.yaml
kubectl -n database rollout restart deploy/nao
```

The connection blocks use nao's `{{ env('...') }}` interpolation against the env
vars the Deployment injects, so no password is ever written into the project
volume or into git.

The image publishes no semver tags — `nao-deployment.yaml` pins a commit tag
(`getnao/nao:b325bba`, app 0.3.3). Renovate cannot bump that; move it by hand.
