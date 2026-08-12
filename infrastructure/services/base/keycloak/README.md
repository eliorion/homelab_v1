# keycloak

Keycloak is the cluster's identity platform: the OAuth/OIDC authorization server
for services that are published on the public internet. It runs in the
`identity` namespace as a `Keycloak` custom resource reconciled by the Keycloak
operator, backed by the CNPG Postgres cluster `keycloak-db`. Its first real
consumer is **fbref-mcp**, the read-only MCP server over the fbref database:
hosted AI providers (claude.ai, ChatGPT connectors) call it from their own
cloud, so it needs a public endpoint, and a public endpoint onto a database
needs OAuth. Keycloak issues and signs the tokens; fbref-mcp only verifies them.
A second realm fronts self-hosted web UIs published through the Cloudflare
tunnel, authenticated at the edge by Cloudflare Access.

The deep narrative — deployment shape, first-run checklist, scaling path — is in
[../../../../documentations/02-keycloak.md](../../../../documentations/02-keycloak.md).
Backups are covered by [../../../../documentations/03-backups.md](../../../../documentations/03-backups.md).

## How it is wired

Three Flux Kustomizations apply this component, in order:
`infra-keycloak-operator` (CRDs + the `identity` namespace + the operator) →
`infrastructure-services` (this component's `app/`) → `infra-keycloak-realm`
(the realm import Job). All three are declared in
`clusters/staging/infrastructure.yaml`.

This component's own `kustomization.yaml` lists a single resource, `app/`. It
deliberately does **not** list the `identity` Namespace and does **not** list
`realm/`; both exclusions are load-bearing (see Traps).

### `app/` — the server

| File | What it does |
|---|---|
| `keycloak.yaml` | The `Keycloak` CR: 2 instances, database wiring, hostnames, proxy mode, NetworkPolicy, resources. |
| `certificate.yaml` | A self-signed `Issuer`, a 10-year `keycloak-ca` CA `Certificate`, a CA `Issuer` built from it, and the 90-day `keycloak-tls` serving certificate for `keycloak-service.identity.svc`. The CA's `87600h`/10y duration is deliberate: it is a private CA nobody can rotate out of band. |
| `ingress-tailscale.yaml` | A `tailscale`-class `Ingress` that publishes the admin console at `https://keycloak-admin.tail45b0ca.ts.net`. |
| `poddisruptionbudget.yaml` | `minAvailable: 1` over the operator's pod labels, because the CR has no PDB field. |
| `kustomization.yaml` | Lists the four files above, and nothing else. |

The operator generates the `Service` `keycloak-service` (the CR name plus
`-service`), the StatefulSet, the NetworkPolicy, and the Secret
`keycloak-initial-admin`. CNPG generates the Secret `keycloak-db-app` with a
random password. No Keycloak credential is stored in git.

Traffic in:

- public OAuth traffic — Cloudflare tunnel (namespace `cloudflare`) → HTTPS
  :8443 on `keycloak-service`;
- admin console — Tailscale proxy (namespace `tailscale`) → HTTP :8080;
- realm import — the config-cli Job inside `identity` → HTTPS :8443.

### `realm/` — the realms as code

| File | What it does |
|---|---|
| `job.yaml` | A `keycloak-config-cli` Job (`adorsys/keycloak-config-cli:6.5.1-26`) that logs in as the operator-generated admin and applies the three realm files. |
| `realm-mcp.yaml` | The `mcp` realm: anonymous dynamic client registration fenced by client-registration policies, the `mcp:tools` scope, and the audience mapper for `https://fbref-mcp.eliorion.fr/mcp`. |
| `realm-apps.yaml` | The `apps` realm: one confidential client, `cloudflare-access`, for Zero Trust edge authentication of tunnel-published UIs (today: nao, `https://nao.eliorion.fr`). |
| `realm-master.yaml` | The `master` realm, carrying a single attribute: `frontendUrl`. |
| `kustomization.yaml` | A `configMapGenerator` that packs the three realm files into the `keycloak-realm` ConfigMap, plus `job.yaml`. |

The three `realm-*.yaml` files are the one place in this component that keeps its
comments. They are ConfigMap *content*, not manifest annotation: `configMapGenerator`
hashes them into the ConfigMap name, so editing a comment renames the ConfigMap and
re-runs the import Job.

### Overlays

`staging/keycloak/kustomization.yaml` sets `namespace: identity` and pulls in
`../../base/keycloak/`. It deliberately does **not** list `realm/`.

`staging/keycloak/realm/kustomization.yaml` is the target of the separate
`infra-keycloak-realm` Flux Kustomization. It pulls in
`../../../base/keycloak/realm/` and adds `cloudflare-access-client.enc.yaml`,
the sops Secret holding the `cloudflare-access` client secret and the Zero Trust
team domain. Both are read by the Job as `$(env:...)` references, so that
neither a credential nor an account-specific hostname is baked into a base
manifest. The team domain is the host half of the one redirect URI Access ever
calls back on — not a secret, but account-specific, which is why it lives in the
overlay. The Secret is in the same Kustomization as the Job, so it is guaranteed
to exist before the Job runs. `cloudflare-access-client.enc.yaml.example` is the template for it.

The `staging` overlay no longer carries an `app/` directory: the sops
`keycloak-secret` it held used the `KC_BOOTSTRAP_ADMIN_*` key spellings only the
retired hand-written StatefulSet read, and the operator generates
`keycloak-initial-admin` itself. The database also left: `keycloak-db` now lives
in `infrastructure/services/staging/databases/keycloak/`, next to every other
infra/services database, mirroring `apps/staging/databases/`.

`production/keycloak/` is staged but **inert**: its `resources:` list is
commented out, so only the `patches:` entries are declared and nothing is
applied until the list is uncommented. It contains:

- `app/kustomization.yaml` + `app/secret.enc.yaml`;
- `database/objectstore.yaml` — the `r2-store` barman-cloud ObjectStore pointing
  at `s3://asp-cnpg-production` on Cloudflare R2, 7-day retention, gzip + AES256;
- `database/cluster-backup-patch.yaml` — attaches the barman-cloud plugin to the
  `keycloak-db` Cluster as WAL archiver (`barmanObjectName: r2-store`,
  `serverName: keycloak-db`);
- `database/scheduledbackup.yaml` — `keycloak-db-daily`, `0 0 3 * * *`;
- `database/objectstore-staging.yaml` and `database/cluster-recovery-patch.yaml`
  — the temporary seed-from-staging pair (see Traps);
- `database/r2-backup-credentials.enc.yaml`,
  `database/r2-staging-credentials.enc.yaml` — sops R2 credentials.

## Why it is like this

**The operator, not a hand-written StatefulSet.** Running `instances: 2` is
Keycloak's own production guidance — a login page that dies with one node is not
production. The operator wires Infinispan/JGroups DNS discovery automatically
for `instances > 1`, so the `KC_CACHE` / `KC_CACHE_STACK` / `jgroups.dns` recipe
the hand-written StatefulSet needed is gone.

**`spec.image` is left unset on purpose.** Setting it makes the operator assume
a pre-optimized image and start the server with `--optimized`, and it decouples
the server version from the operator version. Left unset, the operator runs the
server it was released with (`RELATED_IMAGE_KEYCLOAK` in its own Deployment), so
the single version knob for the whole component is `scripts/fetch-keycloak-operator`.

**`spec.bootstrapAdmin` is left unset on purpose.** Without it the operator
generates a temporary admin and stores it in the Secret `keycloak-initial-admin`
— one less credential in git, and it is exactly the credential the realm
pipeline authenticates with. Delete the leftover sops `keycloak-secret` once a
personal admin account exists.

**TLS terminates at the pod.** Cilium runs here without transparent encryption,
so without pod-level TLS the login POST would cross the node network in
plaintext even on the cloudflared hop. The certificate is only ever presented to
one peer — cloudflared, inside the cluster — and the name it protects
(`keycloak-service.identity.svc`) is not resolvable from the internet and no
browser ever sees it, so a public CA would buy nothing. A private CA scoped to
this namespace is the right size, and the Issuers are namespaced rather than
`ClusterIssuer`s so this CA can sign for `identity` and nothing else.
cloudflared cannot be handed that CA through the Cloudflare dashboard, so its
origin config sets "No TLS Verify": the hop is **encrypted but not
authenticated**. That is a real limitation, and it still removes plaintext
credentials from the node network, which is the actual exposure. The realm
import Job accepts the same trade-off from the other side: it sets
`KEYCLOAK_SSLVERIFY: "false"` because the config-cli image cannot trust this CA
without a Java truststore, so that hop too is encrypted but not authenticated —
acceptable for a pod-to-pod call inside a namespace only this Job and the tunnel
enter.

**The plain HTTP listener exists for one caller.** The Tailscale proxy fronting
the admin console terminates the MagicDNS certificate; re-encrypting from there
to a self-signed origin would mean teaching that proxy to trust the private CA.
`spec.networkPolicy.http` restricting :8080 to the `tailscale` namespace is what
makes plaintext acceptable — the hop never leaves the proxy pod's path.

**A Tailscale `Ingress`, not the `tailscale.com/expose` annotation.** `expose`
is an L3 forward of the Service port, so it would serve the console over plain
http on :8080. An admin console needs HTTPS on 443 (MagicDNS issues the cert)
both so session cookies sit on a secure origin and so the URL matches the
`https://` value of `spec.hostname.admin` — a mismatch there breaks every
redirect in the console.

**Two hostnames, and the console needs both settings.** `spec.hostname.hostname`
is the public face: what Cloudflare routes, what tokens are issued for, and the
`iss` string fbref-mcp verifies by exact match. `spec.hostname.admin` makes
Keycloak *serve* the console at the tailnet URL, but the `master` realm still
advertises its OIDC endpoints at the global hostname — verified on the live
cluster, where `/realms/master/.well-known/openid-configuration` returned
`"issuer":"https://staging-keycloak.eliorion.fr/realms/master"` regardless of the
`Host` header sent. The console page then loads from ts.net while its JavaScript
is told the auth server is `staging-keycloak.eliorion.fr`, the 3rd-party check
iframe is cross-origin, the browser blocks its cookies, and the console dies
with:

```
Something went wrong
Timeout when waiting for 3rd party check iframe message.
```

A per-realm `frontendUrl` overrides the global hostname, which is upstream's own
workaround for this exact report (keycloak/keycloak#42254). That is the entire
content of `realm-master.yaml`, and it is set on `master` **only**: the `mcp`
realm must keep the public frontend URL, because fbref-mcp compares `iss` by
exact string and the hosted connectors reach it over the internet. That
asymmetry is why this is done per realm rather than by flipping the global
hostname.

**`spec.hostname.strict: true`** stops Keycloak from resolving its hostname from
request headers, which would let a forged `Host` header mint tokens with someone
else's `iss`.

**`spec.proxy.headers: xforwarded`** — TLS is terminated by Cloudflare at the
edge, so the pod must trust the forwarded scheme and host or it builds redirect
URLs as `http://`.

**`spec.ingress.enabled: false`.** The operator creates an Ingress for
`hostname` by default and nothing serves it: the only IngressClass on this
cluster is `tailscale` and there is no default class, so it sat classless and
inert while publishing the public hostname in an object no controller owns.
Public traffic arrives through the Cloudflare tunnel straight to the Service,
and the admin console has its own Tailscale Ingress.

**The NetworkPolicy ships with the CR** rather than as a separate object that
can drift away from it. `management` (health + metrics) is deliberately left
unrestricted: the kubelet probes it from the node, which is not a pod and would
be dropped by a `namespaceSelector` list.

**`http-max-queued-requests: "1000"`** makes the server return 503 under
overload instead of queueing without bound. A public login endpoint is the one
place an unbounded queue turns into a memory leak.

**A PodDisruptionBudget is hand-written** because the Keycloak CR has no PDB
field. Two instances without a budget are two instances a single node drain can
take down together: the operator's StatefulSet rolls one at a time, but a drain
does not consult it. `minAvailable: 1` is what makes "2 instances" mean "stays
up during maintenance" rather than "costs twice as much".

**keycloak-config-cli, not the operator's `KeycloakRealmImport` CR.** The import
CR is create-oriented, so realm *updates* are effectively ignored and every
change would mean deleting and re-importing the realm. The DCR policies and
client scopes here get tuned repeatedly while onboarding connectors, which is
the case the import CR handles worst. config-cli diffs the live realm and
applies only what changed, with no Keycloak restart.

**The realm lives in its own Flux Kustomization.** A Job is immutable, so
`infra-keycloak-realm` carries `force: true` (delete + recreate is what makes
the import re-run) and `wait: true` (a failed import surfaces as NotReady rather
than as a realm that quietly does not match git). Folding `realm/` into the
parent Kustomization would either give the Job a second owner without `force`,
or extend `force`/`wait` to the Keycloak CR and the database. Same recipe as the
db-migrations Flyway Job; `realm/` is nested under the staging overlay for the
same reason `apps/staging/databases/db-migrations` is.

**`IMPORT_MANAGED_*: no-delete` everywhere.** Users are created in the admin
console over the tailnet, not in the realm files; clients arrive by dynamic
registration; sub-components hang off components; and a later Keycloak version
may introduce client-registration policies this repo has never heard of.
config-cli's default is full management, under which every object absent from
the files is deleted.

**Why the `mcp` realm looks like that.** It exists to authorize exactly one
resource, `https://fbref-mcp.eliorion.fr/mcp`. The MCP spec expects RFC 8707
resource indicators to bind a token to one resource; Keycloak 26 does not
implement RFC 8707 and ignores the `resource` parameter clients send, so the
audience is stamped on by an `oidc-audience-mapper` on the `mcp:tools` scope
instead. fbref-mcp requires `aud` and refuses a token without it, which is what
stops a token issued for some future client in this realm from being replayed
against the database. ChatGPT mandates OAuth 2.1 plus dynamic client
registration — it will not accept a pre-registered client id — so
`/realms/mcp/clients-registrations/openid-connect` is a public, unauthenticated
endpoint, fenced by the client-registration policies in the file. Access control
is realm membership: `registrationAllowed: false` plus exactly one resource
means a user existing in this realm *is* permission to read the fbref database;
disable or delete the account to revoke. Access tokens are short (300s) and the
connector refreshes, because a long-lived token is a long-lived database reader
in someone else's cloud.

**Why the `apps` realm is separate from `mcp`.** The `mcp` realm has anonymous
dynamic client registration open to claude.ai and chatgpt.com, and a user
existing there is permission to read the fbref database. Adding the operators of
a web UI to it would silently grant that, and adding a browser SSO client to it
would put that client in a realm whose registration surface is public. Two
audiences, two realms. The realm is named `apps` rather than after its single
current UI because a Cloudflare Access identity provider is configured *once*
per Zero Trust account and reused by every Access application: a second
published UI adds an Access application and a policy, not a second realm and a
second IdP.

Note what the `apps` realm does **not** do: nao has no OIDC of its own —
self-hosted `getnao/nao` runs better-auth with local accounts and SSO is an
Enterprise feature — so Keycloak is not nao's identity provider. It
authenticates the request *before* it reaches the tunnel; nao's own login still
follows. Two logins is the cost of fronting an app that cannot delegate its own.
The `cloudflare-access` client is confidential (the code exchange happens
server-to-server from Cloudflare's edge), runs the authorization code flow only
(direct access grants would turn it into a password oracle on the public
internet), carries no roles (`fullScopeAllowed: false`), and grants no CORS
origin (`webOrigins: []`) because only Cloudflare's edge talks to it, never
browser JavaScript. Its tokens are exchanged once, immediately, by the edge;
after that the session is Access's own cookie, so short lifespans are free.

Both public-facing realms set `sslRequired: all`, `registrationAllowed: false`,
and brute-force protection (5 failures, exponential wait capped at 15 minutes).
`permanentLockout` stays `false` on purpose: with a handful of human accounts, a
permanent lock is a self-inflicted outage anybody can trigger.

**Why the base Kustomization omits the Namespace.** The keycloak-operator unit
(`infrastructure/controllers/base/keycloak-operator`) creates `identity`,
because the operator is namespace-scoped and runs in it. Two Flux Kustomizations
owning the same Namespace object would fight over it.

**Why the R2 ObjectStores carry two AWS env vars.** boto3 >= 1.36 sends
data-integrity checksums that Cloudflare R2 rejects with
`XAmzContentSHA256Mismatch`; `AWS_REQUEST_CHECKSUM_CALCULATION` and
`AWS_RESPONSE_CHECKSUM_VALIDATION` set to `when_required` restore compatibility
for both backup and restore (plugin-barman-cloud issue #411).

## Traps

- **Do not set `spec.image`.** It flips the operator into `--optimized` mode and
  decouples the server version from the operator version.
- **Do not set `spec.bootstrapAdmin`.** The realm import Job reads the
  operator-generated Secret `keycloak-initial-admin`; setting a bootstrap admin
  means that Secret is not what it thinks it is.
- **`spec.hostname.admin`, `realm-master.yaml`'s `frontendUrl`, and the
  `keycloak-admin` device name in `ingress-tailscale.yaml` are one value in
  three places.** Change one and you must change the others, or the console
  fails with `Timeout when waiting for 3rd party check iframe message.`
- **`spec.hostname.admin` restricts nothing.** Keycloak's docs are explicit:
  "Using the hostname-admin option does not prevent accessing the Administration
  REST API endpoints via the frontend URL specified by the hostname option."
  Keeping the console off the internet is done at the reverse proxy, and here
  that means two Cloudflare-side layers, **neither of them in git**: (1) the
  tunnel publishes `staging-keycloak.eliorion.fr` with path rules for
  `/realms/*`, `/resources/*`, `/js/*` and `/.well-known/*` only — four entries,
  the fourth required for OAuth discovery and easy to miss — so no route reaches
  `/admin`; (2) a WAF rule blocks `/admin*` on that hostname at the edge. Both
  are documented in
  `infrastructure/services/staging/cloudflare/README.md`. A dashboard edit that
  adds a catch-all route re-exposes the admin login page and nothing in this
  repo would catch it in review — that is the accepted trade-off, not an
  oversight.
- **`realm-master.yaml`'s `frontendUrl` is for `master` only.** Setting the same
  thing on `mcp` would point the public realm at a ts.net URL and break the
  whole MCP flow, because fbref-mcp compares `iss` by exact string.
- **`IMPORT_MANAGED_USER: no-delete` is the most load-bearing line in
  `job.yaml`.** The realm files declare no users, so config-cli's default (full
  management) deletes *every* account on the next import — a silent total
  lockout triggered by an unrelated realm edit.
- **`IMPORT_VARSUBSTITUTION_ENABLED` is off by default in keycloak-config-cli.**
  Without it the literal string `$(env:CF_ACCESS_CLIENT_SECRET)` is imported as
  the client secret and every Cloudflare Access token exchange fails.
- **`mcp:tools` must stay in `defaultDefaultClientScopes`, not an optional
  list.** Dynamically-registered clients request whatever they please; on an
  optional scope, a client that asks for nothing gets a token with no `aud`,
  fbref-mcp refuses it, and every call fails with no obvious cause.
- **`openid` is not a Keycloak client scope.** Listing it in a client's
  `defaultClientScopes` makes the server log `Referenced client scope 'openid'
  doesn't exist. Ignoring` on every import — a warning that looks like the cause
  of any nearby failure.
- **Cloudflare Access identifies users by email.** A Keycloak account in the
  `apps` realm with no email set authenticates and is then refused by every
  Access policy, which reads as a broken login.
- **The `cloudflare-access` client secret is declared in the realm, not
  generated by Keycloak.** A regenerated secret breaks the Cloudflare side
  silently; the only symptom is a failed token exchange nobody sees. Same for
  the team domain: Keycloak matches redirect URIs textually, so a trailing slash
  or a missing scheme rejects every callback with
  `Invalid parameter: redirect_uri`.
- **`localhost` and `127.0.0.1` are in the `mcp` realm's trusted hosts on
  purpose.** ChatGPT's DCR uses a loopback callback with a random port, and
  Keycloak validates redirect URI hosts textually, so `chatgpt.com` alone
  rejects `http://127.0.0.1:<port>/callback/<id>` with HTTP 403.
- **`host-sending-registration-request-must-match: "false"` is deliberate.**
  Hosted providers send the registration request from arbitrary cloud egress
  IPs, so matching the caller's address would reject every real client while
  providing no security. `client-uris-must-match: "true"` is the check actually
  doing the work.
- **The allowed protocol mapper list must not gain an audience mapper.** A
  self-registered client that could mint an `aud` of its own choosing defeats
  precisely the check fbref-mcp relies on.
- **The ConfigMap name hash in `realm/kustomization.yaml` is load-bearing.** It
  changes the ConfigMap name when a realm file changes, which changes the Job
  spec, which is what lets Flux (`force: true`) delete and recreate the Job.
  Disabling the hash suffix would leave realm edits sitting in git, applied to
  nothing.
- **`IMPORT_FILES_LOCATIONS` names every realm file explicitly.** A glob would
  work; the files are named so that a file added to the ConfigMap and forgotten
  there fails loudly instead of being imported silently.
- **The config-cli image is on a floating `26` tag.** No build exists for
  Keycloak 26.6+ (the newest version-specific tag is `6.5.1-26.5.5`), so
  `adorsys/keycloak-config-cli:6.5.1-26` is a real version skew: the admin REST
  API is stable within a major, but if the realm pipeline starts failing after a
  Keycloak bump, look there first.
- **The `identity` Namespace must not be added to this component's
  `kustomization.yaml`.** It is owned by
  `infrastructure/controllers/base/keycloak-operator`.
- **`realm/` must not be added to this component's `kustomization.yaml`, nor to
  the staging overlay's.** It has its own Flux Kustomization
  (`infra-keycloak-realm`); a second owner without `force: true` would make
  realm edits fail to apply forever, silently.
- **The `infra-keycloak-realm` Flux Kustomization must keep `decryption`
  configured.** Its path carries a sops Secret; without decryption Flux applies
  the ciphertext verbatim, nothing fails at apply time, and Keycloak later
  rejects the client with
  `400 {"error":"invalid_input","error_description":"A redirect URI is not a valid URI"}`.
- **The Tailscale Ingress needs HTTPS Certificates enabled** in the Tailscale
  admin console (DNS → HTTPS Certificates). Without it the proxy comes up with
  no certificate and the console is unreachable — probably already satisfied,
  since the API-server proxy requires it too. See
  `infrastructure/controllers/staging/tailscale-operator/README.md`.
- **The PodDisruptionBudget selector must match the operator's pod labels**
  (`app: keycloak` and `app.kubernetes.io/managed-by: keycloak-operator`), or it
  selects nothing and protects nothing.
- **`production/keycloak/database/objectstore-staging.yaml` and
  `cluster-recovery-patch.yaml` are temporary**, for seeding production from the
  staging backup only, and must be removed once the prod `keycloak-db` is seeded
  and verified. CNPG honors a `bootstrap` stanza only at first cluster creation,
  so the recovery patch must be present *before* the prod cluster is created and
  is inert once it exists.

## Operating it

Render check before committing:

```bash
kubectl kustomize infrastructure/services/staging/keycloak
kubectl kustomize infrastructure/services/staging/keycloak/realm
```

Re-run the realm import. Editing any realm file changes the generated ConfigMap
hash and Flux recreates the Job by itself. Changing only the sops Secret does
**not** change that hash, so force it by deleting the Job (or touching a realm
file):

```bash
kubectl -n identity delete job keycloak-realm-config
flux reconcile kustomization infra-keycloak-realm --with-source
kubectl -n identity logs job/keycloak-realm-config
```

The finished Job is kept for a day (`ttlSecondsAfterFinished: 86400`) so its
logs stay readable after a reconcile.

Read the operator-generated admin credential:

```bash
kubectl -n identity get secret keycloak-initial-admin -o jsonpath='{.data.username}' | base64 -d
kubectl -n identity get secret keycloak-initial-admin -o jsonpath='{.data.password}' | base64 -d
```

The admin console is `https://keycloak-admin.tail45b0ca.ts.net`, reachable from
the tailnet only. Accounts for both realms are created there by hand.

Create or rotate the Cloudflare Access client credential:

```bash
cd infrastructure/services/staging/keycloak/realm
cp cloudflare-access-client.enc.yaml.example cloudflare-access-client.enc.yaml
openssl rand -base64 32          # paste as client-secret
$EDITOR cloudflare-access-client.enc.yaml
sops --encrypt --in-place cloudflare-access-client.enc.yaml
```

`.sops.yaml` selects the age key by path (`staging/*.enc.yaml`), so the
`.example` file matches nothing and is never encrypted — never put the real
secret in it. Read an existing one back with
`sops -d infrastructure/services/staging/keycloak/realm/cloudflare-access-client.enc.yaml`.
The same secret value must be entered by hand in Zero Trust → Settings →
Authentication, on the Keycloak login method; the team domain comes from Zero
Trust → Settings → Custom Pages (`https://<team-name>.cloudflareaccess.com`,
with scheme, no trailing slash).

Check what the realms actually advertise:

```bash
curl -s https://staging-keycloak.eliorion.fr/realms/mcp/.well-known/openid-configuration | jq .issuer
curl -s https://keycloak-admin.tail45b0ca.ts.net/realms/master/.well-known/openid-configuration | jq .issuer
```
