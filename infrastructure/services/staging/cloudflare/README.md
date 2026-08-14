# cloudflare

`cloudflared` is the cluster's only public entry point. A single Deployment in
the `cloudflare` namespace dials outward to the Cloudflare edge with a
`TUNNEL_TOKEN`, so no port is forwarded on the home router and no origin is
directly addressable from the internet. Because the tunnel is token driven it is
**remotely managed**: its routes live in the Cloudflare Zero Trust dashboard, not
in this repo. This file is the compensating control — everything configured
there, written down here, so the dashboard can be rebuilt from git even though it
is not driven by it.

**When you change a route in the dashboard, change this file in the same
sitting.** There is no reconciliation loop that will notice the drift.

Deeper context: [../../../../documentations/14-design-decisions.md](../../../../documentations/14-design-decisions.md)
(the exposure decision and what was rejected),
[../../../../documentations/02-keycloak.md](../../../../documentations/02-keycloak.md)
(the identity layer behind these hostnames),
[../../../../documentations/11-azuracast-public-relay.md](../../../../documentations/11-azuracast-public-relay.md)
(the AzuraCast listener-capacity measurements referenced below).

## How it is wired

| File | What it does |
|---|---|
| `../../base/cloudflare/namespace.yaml` | the `cloudflare` namespace |
| `../../base/cloudflare/deployment.yaml` | the `cloudflared` Deployment: one replica, image pinned, hardened `securityContext`, `TUNNEL_TOKEN` from a Secret, liveness on `/ready` |
| `../../base/cloudflare/kustomization.yaml` | the base: namespace + deployment, `namespace: cloudflare` |
| `kustomization.yaml` | the staging overlay: the base plus the tunnel token |
| `tunnel-secret.enc.yaml` | SOPS-encrypted Secret `tunnel-credentials`, key `token` — the tunnel's identity and its route set |

The container runs `cloudflared tunnel --no-autoupdate --loglevel info --metrics
0.0.0.0:2000 run`. With `TUNNEL_TOKEN` set there is no `config.yaml` and no
ingress block: the token names the tunnel, and the tunnel pulls its routes from
the dashboard. Everything from "Public hostnames" down in this file is that
remote configuration.

### Overlays

Two overlays exist and they are the same shape: this one and
`../../production/cloudflare/`, each the base plus its own
`tunnel-secret.enc.yaml` and nothing else. Only staging is live. Flux applies it
from `../kustomization.yaml` (`infrastructure/services/staging/`), reconciled by
the `infrastructure-services` Kustomization in
`clusters/staging/infrastructure.yaml`.

The production overlay is listed in
`infrastructure/services/production/kustomization.yaml` — cloudflare is in fact
its only uncommented entry — and `clusters/production/infrastructure.yaml`
declares an `infrastructure-services` Kustomization pointing at
`./infrastructure/services/production`. That entrypoint runs only on a
production cluster, and none is deployed, so nothing reconciles it today. Treat
it as scaffolding
([../../../../documentations/01-architecture.md](../../../../documentations/01-architecture.md#a-note-on-production)),
and do not assume a change here reaches it.

## Why it is like this

- **Token-driven, remotely managed.** `cloudflared` dials outward, so the origin
  is never directly addressable. Rejected: a locally managed tunnel with a
  `config.yaml` ingress block in git, and a port forward to a Cilium LB-IPAM
  address. The cost is that route configuration is outside git with no
  reconciliation loop; this README is the control, and it has a measured failure
  rate of one (it claimed a hostname carried a web UI only, when the same route
  was in fact serving a continuous audio stream — see section 4).
- **One replica.** Elastic scaling of this Deployment is possible and was not
  done; a single connector is enough for this traffic.
- **The image tag is pinned** rather than `:latest`, which a Radar audit flagged
  (`imageTagLatest`). Renovate bumps it. `--no-autoupdate` matches: the binary is
  updated by changing the tag in git, not by the process replacing itself under a
  `readOnlyRootFilesystem`.
- **The `securityContext` is hardened** (`runAsNonRoot`, `runAsUser: 65532`,
  `readOnlyRootFilesystem`, all capabilities dropped, `RuntimeDefault` seccomp) to
  clear Radar-audit privilege-escalation findings. `cloudflared` needs no
  privileges: it makes outbound connections only.
- **Liveness is `/ready` on the metrics port.** `cloudflared` answers 200 there if
  and only if it holds an active connection to the edge, so a connector that has
  lost the edge is restarted rather than left running as a black hole.
  `failureThreshold: 1` makes that immediate.

## Public hostnames

Zero Trust → Networks → Tunnels → *(the tunnel)* → **Public Hostnames**.

### 1. `fbref-mcp.eliorion.fr`

| Field | Value |
|---|---|
| Subdomain / Domain | `fbref-mcp` / `eliorion.fr` |
| Path | *(empty — the whole host)* |
| Service | `http://fbref-mcp.fbref.svc.cluster.local:8080` |
| HTTP Host Header | *(leave empty — pass the original through)* |

The MCP server validates the `Host` header itself (`MCP_ALLOWED_HOSTS`), so
rewriting it here breaks the request with a 421. Plain HTTP is deliberate: the
MCP pod serves no TLS, and the OAuth token in flight is a bearer token whose
audience is bound to this exact URL.

The whole host is routed because the OAuth flow needs
`/.well-known/oauth-protected-resource/mcp` as well as `/mcp`. Nothing else is
served by that pod except `/healthz`.

### 2. `staging-keycloak.eliorion.fr` — path-scoped, FOUR entries

**Delete any pre-existing DNS record for this name first.** A leftover `A`
record pointing at a LAN address (this zone had one at `192.168.1.41`) means the
name never resolves to Cloudflare, so the tunnel is bypassed entirely and TLS
fails with `sslv3 alert handshake failure` rather than any HTTP status. Adding
the public hostname creates the proxied record; a conflicting `A` record blocks
it. Symptom, from a connector: *"L'authentification a échoué"* — the MCP hands
the client an authorization server it cannot reach.

| # | Path | Service |
|---|---|---|
| 1 | `realms/*` | `https://keycloak-service.identity.svc.cluster.local:8443` |
| 2 | `resources/*` | same |
| 3 | `js/*` | same |
| 4 | `.well-known/*` | same |

Entry 4 is **required for OAuth discovery and easy to miss**. RFC 8414 §3
locates authorization-server metadata by INSERTING the well-known segment before
the issuer path, so a client looking up the issuer
`https://staging-keycloak.eliorion.fr/realms/mcp` fetches:

```
https://staging-keycloak.eliorion.fr/.well-known/oauth-authorization-server/realms/mcp
```

That path is **not** under `/realms/*`. Without entry 4 it 404s, and a client
that only tries the RFC 8414 form never finds the token endpoint. (Clients that
fall back to the OIDC form, `/realms/mcp/.well-known/openid-configuration`, work
without it — which is exactly what makes this fail for some clients and not
others.) Keycloak serves nothing but discovery documents under `.well-known`, so
the entry adds no surface.

On each of the four, under **Additional application settings → TLS**:

| Field | Value | Why |
|---|---|---|
| No TLS Verify | **On** | The origin certificate is signed by a private CA (cert-manager, `identity` namespace) that a dashboard-managed tunnel has no way to trust. The hop is encrypted but not authenticated. |
| Origin Server Name | `keycloak-service` | Matches the certificate's SAN, so the handshake is still coherent. |

**Symptom when No TLS Verify is off:** Cloudflare returns **502 Bad Gateway**
with "Host — Error", and `kubectl -n cloudflare logs -l infrastructure=cloudflared`
shows the real reason:

```
tls: failed to verify certificate: x509: certificate signed by unknown authority
originService=https://keycloak-service.identity.svc.cluster.local:8443
```

That is a working route with a rejected handshake — DNS, the tunnel and the
Service are all fine. Read the cloudflared log before changing anything else; a
502 here says nothing about Keycloak's health.

**Do not fix that 502 while the entry is still a catch-all.** If a request for
`/` matches (the log line shows which `ingressRule` fired), the hostname is not
path-scoped, and the TLS failure is the only thing keeping `/admin` unreachable.
Enabling No TLS Verify then publishes the admin console. Scope the paths in the
same sitting.

**There is deliberately no catch-all entry for this hostname, and adding one
would expose the Keycloak admin console to the internet.** Keycloak's
`hostname-admin` setting does *not* refuse admin requests arriving on the public
hostname — the vendor's own documentation says to restrict them at the reverse
proxy, and these four path rules are that restriction. The admin console is
reached over the tailnet
(`https://keycloak-admin.tail45b0ca.ts.net`), never here.

### 3. `nao.eliorion.fr` — the only hostname behind Cloudflare Access

| Field | Value |
|---|---|
| Subdomain / Domain | `nao` / `eliorion.fr` |
| Path | *(empty — the whole host)* |
| Service | `http://nao.database.svc.cluster.local:5005` |
| HTTP Host Header | *(leave empty — pass the original through)* |

nao serves no TLS and the `database` namespace has no ingress NetworkPolicy, so
the hop is plain HTTP inside the cluster, same as fbref-mcp.

**This route is unauthenticated on its own.** Everything protecting it is the
Access application below. Create the route and the application in the same
sitting, in that order, and do not leave the route published in between: nao
holds the owner-role credential for the asp, fbref and scraper databases and an
ai-gateway key, and its own login is a self-service better-auth signup form.

`BETTER_AUTH_URL` (`../databases/dbtools/nao-env-patch.yaml`) is
`https://nao.eliorion.fr` and must equal this hostname byte for byte.

**nao stays reachable on the tailnet too** (`https://nao.tail45b0ca.ts.net`),
which better-auth allows only because both origins are listed in
`BETTER_AUTH_TRUSTED_ORIGINS` in that same patch — its origin check answers 403
`INVALID_ORIGIN` to any host it does not trust. Publishing a further hostname
here means adding it there in the same sitting.

That second door is a deliberate bypass of everything below: a tailnet user
reaches nao without Cloudflare Access and without Keycloak. It is not a hole in
this design, it is the pre-existing gate — but it does mean **Access is not a
complete access-control boundary for nao**. Revoking someone means removing them
from the Access policy AND from the tailnet.

### 4. `mve-azuracast.eliorion.fr`

| Field | Value |
|---|---|
| Subdomain / Domain | `mve-azuracast` / `eliorion.fr` |
| Path | *(empty — the whole host)* |
| Service | `http://azuracast.azuracast.svc.cluster.local:80` |
| HTTP Host Header | *(leave empty — pass the original through)* |

Check for a conflicting DNS record before adding this, the same way section 2
describes: a leftover `A` record for this name means the tunnel is bypassed and
you get a TLS failure with no HTTP status to read.

AzuraCast builds its own absolute URLs from the request host (`prefer_browser_url`
defaults on), so rewriting the Host header here produces a working page whose
links all point somewhere else. Leave it empty. Plain HTTP to the origin is
deliberate — the pod serves no TLS, and the hop is inside the cluster.

**First run:** the container boots into a setup wizard, which asks for the site
base URL. Enter `https://mve-azuracast.eliorion.fr` — that value is what
security-critical emails (password resets) are built from.

**This hostname carries the AUDIO as well as the UI, and that is an accepted
decision rather than an accident.** An earlier version of this file claimed the
UI only. It was wrong: nginx proxies `/listen/*` to the local Icecast on the same
port 80 this route already points at, so publishing the host published the
stream with it. Measured from outside the network on 2026-08-10:

```
$ curl -D- https://mve-azuracast.eliorion.fr/listen/sysadmin/radio.mp3
HTTP/2 200
content-type: audio/mpeg
icy-br: 192
server: cloudflare                    27 666 B/s sustained over 15 s
```

`/api/nowplaying` advertises that same URL as `listen_url`, so every embed and
player uses it by default — including the snippet in `scripts/azuracast-embed/`.

**The trade being accepted:** this is the sustained non-HTML streaming
Cloudflare's ToS §2.8 restricts. At the current audience it is unlikely to be
noticed; at scale Cloudflare may throttle or object, and the fallback is a direct
path (a port forward to a Cilium LB-IPAM address) or an off-site relay
(`scripts/azuracast-relay/`). Doc 11 measured the alternative: the home uplink
sustains at least 80 concurrent listeners.

**To close it instead**, path-scope this route the way section 2 does for
Keycloak, or add a WAF rule on `/listen/*`. Keeping `/api/*` open is harmless —
it is small JSON, and its `Access-Control-Allow-Origin: *` is what lets an
external site show what is playing.

**The admin login is internet-facing on this hostname.** Unlike section 2 there
is no path scoping to apply — AzuraCast serves its UI and its admin area from the
same routes, so they cannot be separated at the edge. The compensating controls
are the image pin (`0.23.8`; CVE-2026-42606 lets an unauthenticated attacker
poison `X-Forwarded-Host` to steal password-reset links and wipe 2FA, fixed in
0.23.6) and a strong admin password set at first run. A Cloudflare Access policy
in front of this hostname is the obvious hardening step if the public player is
not needed; the recipe below applies unchanged, and it conflicts with nothing
here because AzuraCast has no OAuth flow of its own — unlike section 2, where a
second flow would collide with Keycloak's.

## Cloudflare Access — the login in front of nao

Keycloak cannot be nao's own identity provider: self-hosted `getnao/nao` runs
better-auth with local accounts, and SSO is a nao Enterprise feature. So
Keycloak authenticates at the EDGE, before the tunnel is consulted, and nao's
own login still follows it. **Two logins is expected, not a misconfiguration.**

### The identity provider — Zero Trust → Settings → Authentication → Login methods → Add → Generic OIDC

| Field | Value |
|---|---|
| Name | `Keycloak` |
| App ID (client id) | `cloudflare-access` |
| Client secret | `sops -d ../keycloak/realm/cloudflare-access-client.enc.yaml` |
| Auth URL | `https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/auth` |
| Token URL | `https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/token` |
| Certificate (JWKS) URL | `https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/certs` |
| OIDC scopes | `openid`, `email`, `profile` |
| PKCE | On |

The realm is `apps` — declared in
`../../base/keycloak/realm/realm-apps.yaml`, applied by the realm-config Job.
It is **not** the `mcp` realm: that one has anonymous dynamic client
registration open to claude.ai and chatgpt.com, and membership of it is already
permission to read the fbref database.

All three URLs live under `/realms/*`, which is **already routed** by hostname 2
above — publishing this needs no new Keycloak route. Only the browser hits the
Auth URL; the Token and JWKS URLs are called from Cloudflare's edge, so they too
must resolve publicly, which they do.

Two values must match on both sides or the flow fails at the last step:

- the client secret, from the sops Secret above (Keycloak holds the same string
  because the realm file declares it — it is not Keycloak-generated, precisely
  so an import cannot rotate it silently);
- the redirect URI. Keycloak allows exactly
  `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`, built from
  the `team-domain` key of that Secret. **It ships as a placeholder** — set it
  before testing, or every login ends on *"Invalid parameter: redirect_uri"*.

**Every Keycloak account in the `staging-apps` realm needs an email address set.**
Access identifies users by email and its policies match on it; a user with none
authenticates successfully and is then refused by the policy, which reads as a
broken login rather than a denied one.

### The application — Zero Trust → Access → Applications → Add → Self-hosted

| Field | Value |
|---|---|
| Application name | `nao` |
| Session duration | 24h |
| Public hostname | `nao.eliorion.fr` (whole host, no path) |
| Identity providers | `Keycloak` **only** — untick everything else, including One-time PIN |
| Instant Auth | On (single IdP, so skip the chooser) |

Policy: **Allow**, `Include → Emails` listing the operator addresses. Do **not**
use `Include → Everyone` with the IdP as the only gate — the `staging-apps` realm has
`registrationAllowed: false`, but an emails include keeps the two independent.

Leaving One-time PIN enabled would let anyone with any email address bypass
Keycloak entirely; it is on by default when an application is created.

## WAF rule — the second layer

Security → WAF → Custom rules. One rule, on the `eliorion.fr` zone:

| Field | Value |
|---|---|
| Name | `block-keycloak-admin` |
| Expression | `(http.host eq "staging-keycloak.eliorion.fr" and starts_with(http.request.uri.path, "/admin"))` |
| Action | Block |

Redundant with the path rules above by design: it fails independently of them,
and it kills the request at the edge before the tunnel is consulted.

## Traps

In the manifests:

- The image tag is pinned off `:latest` (Radar audit `imageTagLatest`); Renovate
  bumps it. Do not float it back.
- The liveness probe port `2000` must stay equal to the port in
  `--metrics 0.0.0.0:2000`. Change one and the probe fails every period, with
  `failureThreshold: 1` restarting the pod immediately.
- The Deployment reads the Secret `tunnel-credentials`, key `token`. That
  name/key pair is what `tunnel-secret.enc.yaml` must produce.
- Never open or edit `tunnel-secret.enc.yaml` by hand: it is SOPS ciphertext, and
  the token in it is a bearer credential that also carries the route set.

In the dashboard (each explained in its section above):

- A leftover `A` record for a published name bypasses the tunnel; the failure is
  a TLS handshake error with no HTTP status (sections 2 and 4).
- `staging-keycloak.eliorion.fr` must stay path-scoped to the four prefixes. A
  catch-all publishes the Keycloak admin console (section 2).
- No TLS Verify **On** plus Origin Server Name `keycloak-service` on all four
  Keycloak entries, and never enable it while a catch-all still exists
  (section 2).
- Leave the HTTP Host Header empty everywhere: fbref-mcp answers 421 on a
  rewritten host, AzuraCast builds wrong absolute URLs (sections 1 and 4).
- `BETTER_AUTH_URL` must equal `https://nao.eliorion.fr` byte for byte, and every
  origin serving nao must be in `BETTER_AUTH_TRUSTED_ORIGINS`, else 403
  `INVALID_ORIGIN` (section 3).
- Untick One-time PIN on the nao Access application; it is on by default and
  bypasses Keycloak entirely.
- The Access redirect URI ships as a placeholder (`team-domain` key); unset, every
  login ends on *"Invalid parameter: redirect_uri"*.
- Accounts in the `staging-apps` realm need an email address, or the Access policy refuses
  a successful login.

## Operating it

```bash
kubectl -n cloudflare get pods -l infrastructure=cloudflared
kubectl -n cloudflare logs -l infrastructure=cloudflared     # origin/TLS errors land here
flux get kustomizations                                      # infrastructure-services
kubectl kustomize infrastructure/services/staging/cloudflare # render check before commit
```

A pod restart loop means `/ready` is not answering, i.e. the connector has no
edge connection — token, egress, or the tunnel being deleted dashboard-side.

### Verifying the nao login

```bash
# From OFF the tailnet. Unauthenticated: Access intercepts before the tunnel.
curl -sI https://nao.eliorion.fr/ | head -1          # 302 to cloudflareaccess.com

# Follow it far enough to see WHERE it lands — it must be the Keycloak realm,
# not the one-time-PIN page.
curl -sIL https://nao.eliorion.fr/ | grep -i '^location:'

# The realm's discovery document answers over the already-routed /realms/* path.
curl -sS https://staging-keycloak.eliorion.fr/realms/staging-apps/.well-known/openid-configuration \
  | head -c 120

# The tailnet path is UNCHANGED and still bypasses Access by design — confirm it
# still works rather than assuming, since the same pod now serves two origins.
# From ON the tailnet:
curl -sI https://nao.tail45b0ca.ts.net/ | head -1     # 200, no Access redirect

# A login that 403s on ONE host only means that origin is missing from
# BETTER_AUTH_TRUSTED_ORIGINS. better-auth names it in the pod log:
kubectl -n database logs -l app=nao | grep -i "invalid origin"
```

### Verifying the OAuth surface, from OFF the tailnet

Test each layer separately — a single combined check passes while one layer is
broken.

```bash
# FIRST: the name must resolve to Cloudflare, not to the LAN. A private address
# here means every check below fails at TLS, with no HTTP status to read.
getent hosts staging-keycloak.eliorion.fr        # want a Cloudflare address, NOT 192.168.x.x

# The OAuth surface answers.
curl -sS https://staging-keycloak.eliorion.fr/realms/mcp/.well-known/openid-configuration | head -c 120

# RFC 8414 discovery — the form MCP clients use, and the one path rule 4 exists
# for. A 404 here is why a connector reports "authentication failed".
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://staging-keycloak.eliorion.fr/.well-known/oauth-authorization-server/realms/mcp   # 200

# Blocked at the edge (WAF).
curl -si https://staging-keycloak.eliorion.fr/admin/ | head -1

# Now disable the WAF rule and repeat: should still fail, as a tunnel 404,
# because no route matches. Re-enable the rule afterwards.
curl -si https://staging-keycloak.eliorion.fr/admin/master/console/ | head -1

# The MCP challenges rather than answering. Note the RESOURCE PATH on the
# metadata URL — RFC 9728 inserts it, and the bare path 404s.
curl -si https://fbref-mcp.eliorion.fr/mcp | head -1        # 401
curl -sS https://fbref-mcp.eliorion.fr/.well-known/oauth-protected-resource/mcp
```

Walk the flow end to end the way a connector does — each step feeds the next:

```bash
# 1. the MCP names its authorization server
curl -sS https://fbref-mcp.eliorion.fr/.well-known/oauth-protected-resource/mcp
#    -> authorization_servers: ["https://staging-keycloak.eliorion.fr/realms/mcp"]
# 2. that server must be reachable AND advertise a registration endpoint,
#    because hosted clients register themselves. Keycloak's Trusted Hosts policy
#    validates redirect URI hosts, including ChatGPT's loopback callback.
curl -sS https://staging-keycloak.eliorion.fr/realms/mcp/.well-known/openid-configuration \
  | grep -o '"registration_endpoint":"[^"]*"'
```

## What is NOT configured here

- **No Access application on `fbref-mcp.eliorion.fr` or
  `staging-keycloak.eliorion.fr`, and no Managed OAuth.** Those two carry their
  own OAuth flow — the MCP server is an OAuth resource server and Keycloak is
  the authorization server behind it — so an Access application would put a
  second, conflicting flow in front of the first. Access is used on
  `nao.eliorion.fr` alone, and only because nao has no OAuth of its own.
- **No Access service tokens.** Nothing machine-to-machine goes through Access.
- **No WAF rule for `nao.eliorion.fr`.** Access blocks the whole host before the
  tunnel; there is no admin path to carve out the way Keycloak's `/admin` is.
- **No rotation procedure for the tunnel token.** It is a bearer credential with
  none written down anywhere.
