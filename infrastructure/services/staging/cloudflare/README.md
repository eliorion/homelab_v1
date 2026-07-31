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

### 2. `keycloak.eliorion.fr` — path-scoped, THREE entries

| # | Path | Service |
|---|---|---|
| 1 | `realms/*` | `https://keycloak-service.identity.svc.cluster.local:8443` |
| 2 | `resources/*` | same |
| 3 | `js/*` | same |

On each of the three, under **Additional application settings → TLS**:

| Field | Value | Why |
|---|---|---|
| No TLS Verify | **On** | The origin certificate is signed by a private CA (cert-manager, `identity` namespace) that a dashboard-managed tunnel has no way to trust. The hop is encrypted but not authenticated. |
| Origin Server Name | `keycloak-service` | Matches the certificate's SAN, so the handshake is still coherent. |

**There is deliberately no catch-all entry for this hostname, and adding one
would expose the Keycloak admin console to the internet.** Keycloak's
`hostname-admin` setting does *not* refuse admin requests arriving on the public
hostname — the vendor's own documentation says to restrict them at the reverse
proxy, and these three path rules are that restriction. The admin console is
reached over the tailnet
(`https://keycloak-admin.tail45b0ca.ts.net`), never here.

## WAF rule — the second layer

Security → WAF → Custom rules. One rule, on the `eliorion.fr` zone:

| Field | Value |
|---|---|
| Name | `block-keycloak-admin` |
| Expression | `(http.host eq "keycloak.eliorion.fr" and starts_with(http.request.uri.path, "/admin"))` |
| Action | Block |

Redundant with the path rules above by design: it fails independently of them,
and it kills the request at the edge before the tunnel is consulted.

## Verifying, from OFF the tailnet

Test each layer separately — a single combined check passes while one layer is
broken.

```bash
# The OAuth surface answers.
curl -sS https://keycloak.eliorion.fr/realms/mcp/.well-known/openid-configuration | head -c 120

# Blocked at the edge (WAF).
curl -si https://keycloak.eliorion.fr/admin/ | head -1

# Now disable the WAF rule and repeat: should still fail, as a tunnel 404,
# because no route matches. Re-enable the rule afterwards.
curl -si https://keycloak.eliorion.fr/admin/master/console/ | head -1

# The MCP challenges rather than answering.
curl -si https://fbref-mcp.eliorion.fr/mcp | head -1        # 401
curl -sS https://fbref-mcp.eliorion.fr/.well-known/oauth-protected-resource
```

## What is NOT configured here

- **No Cloudflare Access application, and no Managed OAuth.** Authentication is
  self-hosted in Keycloak; Cloudflare is transport only. Enabling Access on
  these hostnames would put a second, conflicting OAuth flow in front of the
  first.
- **No Access service tokens.** Same reason.
