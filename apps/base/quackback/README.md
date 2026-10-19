# quackback

[Quackback](https://github.com/QuackbackIO/quackback) (AGPL-3.0) is the feedback board of Scout
(asp `services/fbref/webapp`): its users post bugs and feature requests with a title, a
description, the URL that went wrong and screenshots, vote and comment. Published at
`https://feedback.eliorion.fr` through the Cloudflare tunnel; Scout's `/feedback` redirects
there, because Quackback serves only at the root of a hostname.

## Who can reach it

Two gates, one account. **Cloudflare Access** in front: the policy is the Keycloak group
`scout-users` (realm `staging-apps`), so approving a Scout account is what opens the board to that
person. **Quackback's own login** behind it, a custom OIDC provider on the Keycloak client
`quackback`: same Keycloak session, no second password. See
`infrastructure/services/staging/cloudflare/README.md` §6.

## How it is wired

| File | What it does |
|---|---|
| `deployment.yaml` | Quackback by digest, as its own non-root user (1001) with a read-only root; its entrypoint runs the migrations before the server |
| `service.yaml` | ClusterIP :3000, the tunnel's target |
| `networkpolicy.yaml` | in: the `cloudflare` namespace only. out: `quackback-db`, `quackback-redis`, the SeaweedFS S3 gateway (:8333), DNS, public 443 (the OAuth code exchange with Keycloak's public hostname) |
| `redis.yaml` | the Redis 0.13.2 refuses to run without (`REDIS_URL`): cache and job state, nothing on disk, reachable from Quackback only |
| `../databases/quackback/` | the namespace and the CNPG cluster `quackback-db` (with `vector` and `pg_trgm`) |
| `../../staging/quackback/` | `BASE_URL`, the S3 settings, and the ExternalSecret `quackback-secrets` (`secret-key`, OpenBao `kv/quackback/quackback-secrets`) |

One Secret arrives by reflector: `s3-quackback` (the bucket `quackback`'s identity, from `flux-system`:
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
- **One CNPG instance, no backup yet**: feedback is small; a second instance and a Garage backup
  are one patch each away.
- **Redis is required**, not optional: measured 2026-10-19 on 0.13.2, every config read fails
  `redisUrl: invalid_type` without it. It holds nothing durable, so it runs without persistence.
- **Not under `scout.eliorion.fr/feedback`** (tested 2026-10-19 behind Caddy `handle_path`): the
  redirects can be rewritten, but every one of the page's 35 assets is a root path, the main bundle
  builds 198 more at runtime, and the client router matches the real address bar. The board
  needs its own hostname.
- **No mail.** No SMTP account yet; Quackback then writes the notifications it would have sent to its
  log (its documented behaviour). Adding one = the `EMAIL_SMTP_*` / `EMAIL_FROM` variables and
  587/465 in the NetworkPolicy.
- **Ingress from `cloudflare` only**, so nothing reaches the board around the Access application.

## First run (once, after the Access application and the tunnel route exist)

1. Open `https://feedback.eliorion.fr` FIRST, before anyone else: the first account created owns
   the setup (workspace name, first admin). Use the owner's address. (`SETUP_OWNER_EMAIL` in the
   ConfigMap reassigns it if a stranger got there first.)
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
3. Turn off password and magic-link sign-in for the portal: Keycloak is then the only way in.
