# Cloudflare tunnel — public hostnames

`cloudflared` runs from `../../base/cloudflare/` with a `TUNNEL_TOKEN`, which
means the tunnel is **remotely managed**: its routes live in the Cloudflare Zero
Trust dashboard, not in this repo. This file is the compensating control —
everything configured there, written down here, so the dashboard can be rebuilt
from git even though it is not driven by it.

**When you change a route in the dashboard, change this file in the same
sitting.** There is no reconciliation loop that will notice the drift.

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
`/.well-known/oauth-protected-resource` as well as `/mcp`. Nothing else is
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

**There is deliberately no catch-all entry for this hostname, and adding one
would expose the Keycloak admin console to the internet.** Keycloak's
`hostname-admin` setting does *not* refuse admin requests arriving on the public
hostname — the vendor's own documentation says to restrict them at the reverse
proxy, and these four path rules are that restriction. The admin console is
reached over the tailnet
(`https://keycloak-admin.tail45b0ca.ts.net`), never here.

## WAF rule — the second layer

Security → WAF → Custom rules. One rule, on the `eliorion.fr` zone:

| Field | Value |
|---|---|
| Name | `block-keycloak-admin` |
| Expression | `(http.host eq "staging-keycloak.eliorion.fr" and starts_with(http.request.uri.path, "/admin"))` |
| Action | Block |

Redundant with the path rules above by design: it fails independently of them,
and it kills the request at the edge before the tunnel is consulted.

## Verifying, from OFF the tailnet

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
#    because hosted clients register themselves
curl -sS https://staging-keycloak.eliorion.fr/realms/mcp/.well-known/openid-configuration \
  | grep -o '"registration_endpoint":"[^"]*"'
```

## What is NOT configured here

- **No Cloudflare Access application, and no Managed OAuth.** Authentication is
  self-hosted in Keycloak; Cloudflare is transport only. Enabling Access on
  these hostnames would put a second, conflicting OAuth flow in front of the
  first.
- **No Access service tokens.** Same reason.
