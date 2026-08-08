# `database` namespace — pgAdmin + nao

Two clients that read the platform databases. Nothing here owns data. They sit
in `infrastructure/services` rather than `apps/` for the same reason
`ai-gateway` does: they serve every project and belong to none.

```
database ns
├── pgadmin   dpage/pgadmin4      SQL client            http://pgadmin.tail45b0ca.ts.net
├── nao       getnao/nao          analytics agent       http://nao.tail45b0ca.ts.net:5005
└── dbtools-db  CNPG (1 instance) their own state: db `pgadmin` + db `nao`
                (../databases/dbtools/)
```

Reads, across namespaces:

| target  | host                                      | database   |
| ------- | ----------------------------------------- | ---------- |
| asp     | `asp-db-ro.asp.svc.cluster.local`         | automarket |
| fbref   | `fbref-db-ro.fbref.svc.cluster.local`     | fbref      |
| scraper | `scraper-db-ro.scraper.svc.cluster.local` | scraper    |

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
`../../base/dbtools/db-reflect-stubs.yaml` names it. Those source clusters live
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
(`sops -d infrastructure/services/staging/dbtools/pgadmin-admin.enc.yaml`). The
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

`../../base/dbtools/nao-config-configmap.yaml` is a **seed**: the init container
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
