# quackback

[Quackback](https://github.com/QuackbackIO/quackback) (AGPL-3.0) is the feedback board of Scout
(asp `services/fbref/webapp`): its users post bugs and feature requests with a title, a
description, the URL that went wrong and screenshots, vote and comment. Published at
`https://feedback.eliorion.fr` through the Cloudflare tunnel; Scout's `/feedback` redirects
there, because Quackback serves only at the root of a hostname.

## Who can reach it

```
Internet ─► Cloudflare tunnel ─► feedback-gate (oauth2-proxy) ─► Quackback
                                   │ no session  → Keycloak login (realm staging-apps)
                                   │ not in scout-users → 403, never reaches Quackback
                                   └ re-reads the groups every 5 min (--cookie-refresh)
```

**One account, one password**: the Keycloak account Scout uses. The gate (Keycloak client
`feedback-gate`) lets through `scout-users` only, so approving a Scout account is what opens the
board, and removing it closes the board within 5 minutes. Behind it, **Quackback's own login** is a
custom OIDC provider on the Keycloak client `quackback`, with password and magic-link sign-in
turned off: it rides the same Keycloak session, so the user never types a second password and
Quackback stores none. No Cloudflare Access application (owner, 2026-10-21: Keycloak is the only
login). See `infrastructure/services/staging/cloudflare/README.md` §6.

## How it is wired

| File | What it does |
|---|---|
| `deployment.yaml` | Quackback by digest, as its own non-root user (1001) with a read-only root; its entrypoint runs the migrations before the server |
| `service.yaml` | ClusterIP :3000, reached through the gate only |
| `feedback-gate.yaml` | oauth2-proxy v7.15.5 (Deployment, Service :4180 = **the tunnel's target**, NetworkPolicy: in from `cloudflare` only, out to Quackback, DNS, public 443 for Keycloak). `--allowed-group=scout-users`, PKCE, scopes `openid email profile` (this realm has no `groups` scope: the client's mapper adds the claim), `--trusted-proxy-ip` = the pod network |
| `networkpolicy.yaml` | in: the gate only (a tunnel route straight to :3000 would skip the group check, so it gets nothing). out: `quackback-db`, `quackback-redis`, the SeaweedFS S3 gateway (:8333), DNS, public 443 (the OAuth code exchange with Keycloak's public hostname) |
| `redis.yaml` | the Redis 0.13.2 refuses to run without (`REDIS_URL`): cache and job state, nothing on disk, reachable from Quackback only |
| `../databases/quackback/` | the namespace and the CNPG cluster `quackback-db` (with `vector` and `pg_trgm`) |
| `../../staging/quackback/` | `BASE_URL`, the S3 settings, the gate's issuer + redirect URL (`feedback-gate-config`), and the ExternalSecret `quackback-secrets` (`secret-key`, `gate-cookie-secret`; OpenBao `kv/quackback/quackback-secrets`) |

Two Secrets arrive by reflector: `feedback-gate-client` (the gate's Keycloak client secret, from
`identity`) and `s3-quackback` (the bucket `quackback`'s identity, from `flux-system`:
`infrastructure/controllers/staging/seaweedfs/s3/`). Seed OpenBao first
(`infrastructure/services/base/keycloak/README.md`, "Scout and Quackback").

## Why it is like this

- **Quackback, not Fider.** The owner wanted the board reachable from `scout.eliorion.fr/feedback`.
  Neither can serve under a path (Fider issues #1453/#1455 open, ClearFlask's maintainer: "not
  designed" for it), so the board keeps its own hostname and Scout redirects. Quackback has OIDC
  built in, Fider only a generic OAuth form.
- **Image 0.13.2.** The newest image published: v0.14.x have GitHub releases and no image tag.
  0.13.2 already has custom OIDC (since 0.12) and OAuth-only sign-in.
- **Uploads in SeaweedFS, proxied by the app** (`S3_PROXY`): the bucket stays private and
  in-cluster, so the browser never needs to reach it.
- **One CNPG instance, backed up to Garage** (off-site, daily + WAL, 7 days: databases/quackback/README.md).
  The uploads in the SeaweedFS bucket are NOT backed up: screenshots attached to feedback.
- **Redis is required**, not optional: measured 2026-10-19 on 0.13.2, every config read fails
  `redisUrl: invalid_type` without it. It holds nothing durable, so it runs without persistence.
- **Not under `scout.eliorion.fr/feedback`** (tested 2026-10-19 behind Caddy `handle_path`): the
  redirects can be rewritten, but every one of the page's 35 assets is a root path, the main bundle
  builds 198 more at runtime, and the client router matches the real address bar. The board
  needs its own hostname.
- **No mail.** No SMTP account yet; Quackback then writes the notifications it would have sent to its
  log (its documented behaviour). Adding one = the `EMAIL_SMTP_*` / `EMAIL_FROM` variables and
  587/465 in the NetworkPolicy.
- **A gate in front, not Cloudflare Access and not inside Quackback.** Quackback cannot refuse an
  account by group, and Keycloak alone cannot stop a brand-new sign-up from reaching a client (the
  registration flow skips a client's browser-flow override), so any account of the realm,
  including an unapproved request, could sign in. oauth2-proxy reads the group before Quackback
  sees the request. Scout does NOT get one: it checks the group itself, and stays closed even if a
  route ever points straight at it.

## First run (once, after the tunnel route points at the gate)

1. Open `https://feedback.eliorion.fr` signed in as a `scout-users` account (the gate keeps everyone
   else off the setup page): the first account created owns the setup (workspace name, first
   admin). **Use the same email as your Keycloak account**, so the Keycloak sign-in of step 2
   lands on this admin rather than on a second user.
   Without SMTP, any code or link Quackback would mail is in its log instead:
   `kubectl -n quackback logs deploy/quackback | grep -i -E "code|link"`.
2. Settings → Sign-in → custom OIDC (fields as Quackback asks for them):

   | Field | Value |
   |---|---|
   | Issuer / discovery | `https://staging-keycloak.eliorion.fr/realms/staging-apps` |
   | Client ID | `quackback` |
   | Client secret | `bao kv get -field=client-secret kv/identity/quackback-oidc-client` |
   | Scopes | `openid email profile` |

   The callback it shows is under `https://feedback.eliorion.fr/api/auth/`, which the Keycloak
   client allows. Sign in once through it before turning anything else off.
3. Turn off password and magic-link sign-in: Keycloak is then the only way in, and Quackback holds
   no password. Check before: sign out, sign in with Keycloak, and confirm you are still the admin.
