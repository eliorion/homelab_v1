# Keycloak — Identity

Keycloak is the identity platform: SSO for the internal IT team and customer
accounts (CIAM) for the apps. Chosen over edge-only auth (Cloudflare Access)
because Access gates *reach*, it does not *manage* identities — and because the
credentials for a service that reads a database should not live in someone
else's dashboard.

Its first real consumer is **fbref-mcp**, the read-only MCP server over the
fbref database. Hosted AI providers (claude.ai on the web, ChatGPT connectors)
connect from the provider's cloud, so the MCP needs a public endpoint, and a
public endpoint onto a database needs OAuth. Keycloak is the authorization
server; fbref-mcp verifies the tokens and never issues one.

## Deployment shape

```
CNPG Cluster keycloak-db (2 instances) ──auto──▶ Secret keycloak-db-app
                                                       │
Keycloak OPERATOR (identity ns) ──reconciles──▶ Keycloak CR ──▶ StatefulSet (2 pods)
                                                       │
                                    Secret keycloak-initial-admin (operator-generated)
                                                       │
                                          keycloak-config-cli Job ──▶ realm `mcp`
```

| Piece | Where |
|---|---|
| Operator | `infrastructure/controllers/base/keycloak-operator/` (vendored manifests — see its README) |
| Keycloak CR, TLS, PDB, tailnet Ingress | `infrastructure/services/base/keycloak/app/` |
| Database | `infrastructure/services/base/keycloak/database/` + the staging backup overlay |
| Realm as code | `infrastructure/services/base/keycloak/realm/`, applied by `infra-keycloak-realm` |

Three Flux Kustomizations, in order: `infra-keycloak-operator` (CRDs + namespace
+ operator) → `infrastructure-services` (database + Keycloak CR) →
`infra-keycloak-realm` (the import Job, `force: true` because a Job is
immutable).

### Why the operator, not a StatefulSet

This used to be a hand-written StatefulSet. The operator replaced it because
everything the scaling path below used to require by hand — Infinispan/JGroups
discovery, ordered rolling updates, the generated Service — it now does from
`instances: 2`. There is no Helm chart to use instead; the project does not
publish one.

### Version

One knob. The Keycloak CR sets **no** `spec.image`, so the server version is
whatever the operator shipped with. Bump both with
`scripts/fetch-keycloak-operator <version>`.

Note that **keycloak-config-cli lags**: its newest version-specific image is
built against 26.5.5, so the realm Job runs the floating `6.5.1-26` tag. The
admin REST API is stable within a major, but if the realm pipeline breaks after
a Keycloak bump, that skew is the first suspect.

## Hostnames

| URL | Reaches | How |
|---|---|---|
| `https://keycloak.eliorion.fr` | the OAuth surface (`/realms/*` and its assets) | Cloudflare tunnel → HTTPS listener |
| `https://keycloak-admin.tail45b0ca.ts.net` | the admin console | Tailscale Ingress → HTTP listener |

### The console needs TWO settings, not one

`spec.hostname.admin` makes Keycloak **serve** the console at the tailnet URL. It
does not change what the `master` realm advertises: that still comes from the
global `hostname`, so the console page loads from `ts.net` while its JavaScript
is told the auth server is `keycloak.eliorion.fr`. The 3rd-party check iframe is
then cross-origin, the browser blocks its cookies, and the console dies with:

> Something went wrong
> Timeout when waiting for 3rd party check iframe message.

The fix is a per-realm `frontendUrl` on **master** (`realm/realm-master.yaml`),
which overrides the global hostname — upstream's own workaround for this report
([keycloak#42254](https://github.com/keycloak/keycloak/issues/42254)). The two
settings must always name the same URL.

Only master. The `mcp` realm keeps the public frontend URL: fbref-mcp compares
`iss` by exact string and the hosted connectors reach it over the internet, so
pointing that realm at a `ts.net` URL would break the whole MCP flow. Verify both
after any hostname change:

```bash
kubectl -n identity run kcprobe --rm -i --restart=Never --image=curlimages/curl:8.11.1 -q -- \
  sh -c 'curl -sSk https://keycloak-service:8443/realms/master/.well-known/openid-configuration;
         curl -sSk https://keycloak-service:8443/realms/mcp/.well-known/openid-configuration' \
  | grep -o "\"issuer\":\"[^\"]*\""
# master → https://keycloak-admin.tail45b0ca.ts.net/realms/master
# mcp    → https://keycloak.eliorion.fr/realms/mcp
```

### The admin console is not on the internet — and Keycloak is not what stops it

`spec.hostname.admin` points the console at the tailnet URL so its links and
redirects work there. **It restricts nothing.** Keycloak's docs are explicit:

> Using the `hostname-admin` option does not prevent accessing the
> Administration REST API endpoints via the frontend URL specified by the
> `hostname` option.

Keycloak's own guidance is to restrict admin access at the reverse proxy, and
that is what is done here — **two Cloudflare-side layers, neither of them in
git**:

1. the tunnel publishes `keycloak.eliorion.fr` with path rules for `/realms/*`,
   `/resources/*` and `/js/*` only, so no route reaches `/admin`;
2. a WAF custom rule blocks `/admin*` on that hostname at the edge.

Both are documented field-by-field in
`infrastructure/services/staging/cloudflare/README.md`.

**The accepted risk:** a dashboard edit that adds a catch-all route re-exposes
the admin login page, and no pull request would show it. Options with a
git-resident guard were considered and rejected as disproportionate: splitting
into public and admin instances breaks cache invalidation (two Keycloak CRs are
two Infinispan clusters sharing one database, so a realm change on one may never
reach the other), a Cilium L7 path allowlist cannot read inside TLS, and an
nginx path filter is another pod to own. If the trade stops feeling right, the
nginx filter is the option to revisit.

### Network policy

Written by the operator from `spec.networkPolicy` on the CR, so it cannot drift
away from the thing it protects:

- HTTPS (8443) ← the `cloudflare` namespace (the tunnel) and `identity` (the
  realm Job).
- HTTP (8080) ← the `tailscale` namespace only. This listener exists solely so
  the Tailscale proxy can serve the console over MagicDNS HTTPS without being
  taught to trust our private CA.
- management (health, metrics) unrestricted — the kubelet probes it from the
  node, which is not a pod and would be dropped by a namespace selector.

### TLS

cert-manager issues a private CA and a server certificate, both namespaced to
`identity` (`app/certificate.yaml`). Cilium runs without transparent encryption,
so without this the login POST would cross the node network in plaintext.

cloudflared cannot be handed this CA through the dashboard, so its origin config
sets **No TLS Verify**: the hop is encrypted but not authenticated. Same for the
realm Job (`KEYCLOAK_SSLVERIFY=false`).

## The `mcp` realm

`infrastructure/services/base/keycloak/realm/realm-mcp.yaml` is the source of
truth. Two things in it are easy to break and worth knowing:

**`mcp:tools` must stay a DEFAULT client scope.** Keycloak 26 does not implement
RFC 8707 resource indicators, so the token's `aud` comes from an audience mapper
on that scope. fbref-mcp requires `aud` and refuses a token without it. On an
*optional* scope, a dynamically-registered client that requests nothing gets a
token with no audience and every call fails.

**Anonymous DCR is open, on purpose.** ChatGPT will not accept a pre-registered
client, so `/realms/mcp/clients-registrations/openid-connect` is public and
unauthenticated. It is fenced by the Trusted Hosts policy with
`client-uris-must-match: true` (redirect URIs must live under `claude.ai` or
`chatgpt.com`) and `host-sending-registration-request-must-match: false` —
hosted providers register from arbitrary cloud IPs, so matching the caller's
address would reject every real client while stopping no attacker. Plus a
50-client cap and a protocol-mapper allowlist, the latter so a self-registered
client cannot mint an `aud` of its own.

Review registered clients periodically. If ChatGPT support ever stops mattering,
close DCR and pin a static Claude client — strictly safer.

## Who may use the MCP

**Realm membership is the access list.** The realm sets
`registrationAllowed: false` and holds exactly one resource, so an account
existing in realm `mcp` *is* permission to read the fbref database. There is no
second gate to configure and no role to assign.

Accounts are managed in the **admin console over the tailnet**, not in git:

| To | Do |
|---|---|
| Grant access | Realm `mcp` → Users → Add user. Set a **temporary** password under Credentials, and add the required actions `Update Password` and `Configure OTP` so the temporary value cannot survive first login. |
| Revoke access | Disable the user (keeps history) or delete it. Existing access tokens stay valid for their remaining lifetime — 5 minutes at most, `accessTokenLifespan: 300`. |
| Audit | Realm `mcp` → Users, and Clients for what registered itself by DCR. |

`realm-mcp.yaml` declares **no** `users:` block, and the import Job therefore
sets `IMPORT_MANAGED_USER=no-delete`. **Do not remove that env var.**
keycloak-config-cli defaults to full management, under which the next realm edit
would delete every user absent from the file — which is all of them. The failure
is silent from the pipeline's point of view: the Job succeeds, and everybody is
locked out.

The trade you accepted by choosing console management: the access list lives only
in the database, so it gets no pull-request review, no history, and it is gone if
the realm is ever rebuilt from scratch. R2 backups are what make that
recoverable, which is the next section.

## Backups — Cloudflare R2

Since users and client registrations live only in the database (above), the
backup *is* the access list. Wired in
`infrastructure/services/staging/keycloak/database/`:

| Object | Value |
|---|---|
| ObjectStore `r2-store` | `s3://cnpg-staging-keycloak`, 7d retention, gzip + AES256 on WAL and base |
| Cluster patch | barman-cloud plugin as WAL archiver, `serverName: keycloak-db` |
| ScheduledBackup | `keycloak-db-daily`, 03:00, `immediate: true` |

Its **own bucket**, not asp's: the token then carries Object Read & Write on this
bucket alone, so a credential in the `identity` namespace cannot rewrite the asp
archive. (fbref keeps a separate bucket too, though it points at in-cluster
Garage rather than R2.)

The `instanceSidecarConfiguration` env is not decoration — boto3 ≥ 1.36 sends
data-integrity checksums that R2 rejects with `XAmzContentSHA256Mismatch`, and
those two variables are what make backup *and restore* work.

### One-time setup, before the first backup can succeed

Full instructions live in
`infrastructure/services/staging/keycloak/database/r2-backup-credentials.enc.yaml.example`.
In short: create the bucket, create a token with **Object Read & Write on that
bucket only**, copy the example over the real file, fill it, `sops --encrypt
--in-place`.

**On the existing `r2-backup-credentials.enc.yaml`:** it is genuinely encrypted —
valid `sops` block, staging age recipient, MAC, `version: 3.13.1`. Its header
comment saying "PLACEHOLDER — NOT ENCRYPTED YET" is **stale**: `sops -e -i`
encrypts values and leaves comments untouched, so the instruction outlived the
act of following it. The ciphertext is 32 and 64 bytes, which is real R2 key
material, not the word "PLACEHOLDER". (Nobody here can decrypt it to be sure —
that needs the staging age key.)

It still needs replacing, for a different reason: that token was scoped to
`asp-cnpg-staging`, and this ObjectStore now points at `cnpg-staging-keycloak`.
A bucket-scoped token for the old bucket cannot write to the new one. Delete the
stale header while you are in there.

Verify after the first scheduled run:
```bash
kubectl -n identity get backup
kubectl -n identity exec keycloak-db-1 -c plugin-barman-cloud -- \
  barman-cloud-backup-list --cloud-provider aws-s3 \
  s3://cnpg-staging-keycloak keycloak-db
```

## First-run checklist

1. `kubectl -n identity get keycloak,pods` — 2 pods Ready.
2. `kubectl -n identity get job keycloak-realm-config` — Complete. **This is the
   canary**: it is the first thing to exercise the admin REST API, the generated
   admin credential and the realm file together.
3. `kubectl -n identity get secret keycloak-initial-admin -o jsonpath='{.data.password}' | base64 -d`
   — the operator-generated bootstrap admin.
4. Open `https://keycloak-admin.tail45b0ca.ts.net` **from the tailnet** (HTTPS
   certificates are already enabled on the tailnet), log in with it, create a
   personal admin, then disable the bootstrap account.
5. Create your MCP user in realm `mcp` — see *Who may use the MCP* above.
6. Verify the split from **off** the tailnet:
   `/realms/mcp/.well-known/openid-configuration` answers on
   `keycloak.eliorion.fr`; `/admin/` does not.
7. Confirm the first backup landed (see *Backups* above). Do this before adding
   users you would mind recreating.

## Scaling path

1. **Vertical first.** One well-resourced replica handles thousands of logins.
   Raise `spec.resources` before adding pods.
2. **Horizontal.** `spec.instances` — the operator wires Infinispan/JGroups DNS
   discovery, so this is now a one-line change rather than the four-env-var
   recipe the StatefulSet needed. At very large scale, offload sessions to an
   external Infinispan cluster.
3. **Database.** `keycloak-db` runs 2 instances, matching every other CNPG
   cluster here. Backups go to Cloudflare R2 (PITR, daily base + continuous WAL,
   7d retention) — see the section above and `03-backups.md`.
4. **Identity model.** Realm-per-tenant or shared realm + groups; federate the
   IT team (LDAP / Google Workspace via SCIM); self-registration + social login
   for customers. Independent of replica count.
