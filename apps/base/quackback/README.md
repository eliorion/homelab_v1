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
                                   │ not in feedback-users → 403, never reaches Quackback
                                   └ re-reads the groups every 5 min (--cookie-refresh)
```

**One account, one password**: the Keycloak account Scout uses. The gate (Keycloak client
`feedback-gate`) lets through the Keycloak group `feedback-users` only, which the owner grants per
person, independently of Scout (owner, 2026-10-27): Scout access does not include the board.
Removing someone from the group closes the board to them within 5 minutes.
A refused account gets the gate's 403 page, whose **"Sign in with another account"** button ends the
Keycloak session (logout, with `post.logout.redirect.uris` on the `feedback-gate` client) and comes
back to the board. A plain "Sign in" would loop: Keycloak's session silently returns the same account.
The page is oauth2-proxy's own `error.html` with that one change, in the staging overlay
(`feedback-gate-templates`, it holds the staging URLs): keep it in step when the image moves. Behind it, **Quackback's own login** is a
custom OIDC provider on the Keycloak client `quackback`, with password and magic-link sign-in
turned off: it rides the same Keycloak session, so the user never types a second password and
Quackback stores none. No Cloudflare Access application (owner, 2026-10-21: Keycloak is the only
login). See `infrastructure/services/staging/cloudflare/README.md` §6.

## How it is wired

| File | What it does |
|---|---|
| `deployment.yaml` | Quackback by digest, as its own non-root user (1001) with a read-only root; its entrypoint runs the migrations before the server |
| `service.yaml` | ClusterIP :3000, reached through the gate only |
| `feedback-gate.yaml` | oauth2-proxy v7.15.5 (Deployment, Service :4180 = **the tunnel's target**, NetworkPolicy: in from `cloudflare` only, out to Quackback, DNS, public 443 for Keycloak). `--allowed-group=feedback-users`, PKCE, scopes `openid email profile` (this realm has no `groups` scope: the client's mapper adds the claim), `--trusted-proxy-ip` = the pod network |
| `networkpolicy.yaml` | in: the gate only (a tunnel route straight to :3000 would skip the group check, so it gets nothing). out: `quackback-db`, the SeaweedFS S3 gateway (:8333), DNS, public 443 (the OAuth code exchange with Keycloak's public hostname) |
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
- **Image 0.14.1, not 0.13.2.** 0.13.2 sent `prompt=login` with every OIDC sign-in, so Keycloak asked
  for the password again even with a live session. 0.14.1 lets the provider send no prompt
  ("Don't send a prompt"), and with Keycloak as the only method it starts the sign-in by itself
  ("instant SSO"). It also no longer needs Redis. Upgrade measured 2026-10-28 on a copy of the
  0.13.2 schema, read-only root, user 1001, no Redis: 144 migrations, 3.2 s, healthy. No way back:
  a downgrade needs the backup from before the upgrade.
- **Uploads in SeaweedFS, proxied by the app** (`S3_PROXY`): the bucket stays private and
  in-cluster, so the browser never needs to reach it.
- **One CNPG instance, backed up to Garage** (off-site, daily + WAL, 7 days: databases/quackback/README.md).
  The uploads in the SeaweedFS bucket are NOT backed up: screenshots attached to feedback.
- **Not under `scout.eliorion.fr/feedback`** (tested 2026-10-19 behind Caddy `handle_path`): the
  redirects can be rewritten, but every one of the page's 35 assets is a root path, the main bundle
  builds 198 more at runtime, and the client router matches the real address bar. The board
  needs its own hostname.
- **No mail.** No SMTP account yet. 0.14.1 then sends nothing and logs no link or code, so no step
  below may depend on an email. Adding one = the `EMAIL_SMTP_*` / `EMAIL_FROM` variables and
  587/465 in the NetworkPolicy.
- **A gate in front, not Cloudflare Access and not inside Quackback.** Quackback cannot refuse an
  account by group, and Keycloak alone cannot stop a brand-new sign-up from reaching a client (the
  registration flow skips a client's browser-flow override), so any account of the realm,
  including an unapproved request, could sign in. oauth2-proxy reads the group before Quackback
  sees the request. Scout does NOT get one: it checks the group itself, and stays closed even if a
  route ever points straight at it.

## Keycloak as the only sign-in (once, after the 0.14.1 rollout)

Played end to end on 2026-10-28 against a local Keycloak 26 and this image, with a 0.13.2-era admin
(password, `email_verified=false`), the same `auth_config` as staging and SSO idle 30 min. No step
needs mail or SQL. Keep the password on until step 6.

1. Sign in to `https://feedback.eliorion.fr` as the admin, with the password.
2. Settings → Access & Security → **Sign-in** tab → **Single sign-on (OIDC)** → **New provider** →
   the **Keycloak** tile:

   | Field | Value |
   |---|---|
   | Keycloak base URL | `https://staging-keycloak.eliorion.fr` |
   | Realm | `staging-apps` |
   | Client ID | `quackback` |
   | Client secret | `bao kv get -field=client-secret kv/identity/quackback-oidc-client` |
   | Connection options → **Sign-in prompt** | **Don't send a prompt** (the default, "Re-authenticate", makes Keycloak ask the password again) |

   Leave the rest as it is (scopes `openid email profile`, credentials in the body, nonce on).
   **Save and test** → **Start test sign-in** (a Keycloak popup) → "Your SSO connection works."
   Then the header switch **Enable Keycloak**. Note the provider id in the page's Redirect URI
   (`.../api/auth/callback/oidc_xxxxxxxx`).
3. Same page, **Sign-in & access** card: **Show sign-in button** ON, then **Save changes** (the switch
   alone is not saved). **Create accounts on first sign-in** is already ON.
4. Sign-in tab → **Recovery codes** → **Generate new codes**. Store the 10 codes in OpenBao
   (`bao kv put kv/quackback/recovery-codes codes=@codes.txt`, then delete the file). They are the only
   way in once the password is off and the provider is broken (`/auth/recovery`).
5. Link the admin to its Keycloak account, still signed in with the password: open
   `https://feedback.eliorion.fr/auth/link-sso?provider=oidc_xxxxxxxx&type=oidc&next=/admin`. It
   comes back to `/admin`. Check: avatar → **Sign out**, then **Sign in with Keycloak**: you land on
   `/admin`, still the admin. (Without this step the first Keycloak sign-in fails `account_not_linked`:
   the admin's email was never verified, and with no mail it cannot be.)
6. Sign-in tab → **Email** card → **Password** OFF (saves at once). Magic link is already off.
7. **Members by default**: provider page → **Roles** card → Claim `groups`, one rule: value
   `feedback-users` → **Member**. Keycloak sends the claim (the `quackback` client's `groups` mapper);
   a domain would not do, members' addresses are on any domain. Leave **sync on every sign-in** off:
   with no rule giving Admin it would demote the admin (Quackback refuses, but do not lean on it).
   An account still a portal user is promoted at its next Keycloak sign-in.
8. **Portal access** tab: visibility **Everyone** and **Let visitors create an account** ON. The gate
   decides who gets in; **Private** would add Quackback's own invite list on top, and a gate-approved
   member without an invite would land on a "no access" page.
9. Check from a private window, signed in to Scout: Scout's feedback button lands on the board signed
   in, with no form. Typing `feedback.eliorion.fr` shows **Log in**: one click, no form.

What a `feedback-users` member sees then: from Scout's button (`/auth/login`), nothing; a direct visit,
one click on **Log in**; with no live Keycloak session (idle more than 30 min, or never signed in), the
Keycloak form once, at the gate.

## Keep in mind

- **`SECRET_KEY` never changes**: the Keycloak client secret is stored encrypted under it in the
  database, and a restore needs the same key (`kv/quackback/quackback-secrets`).
- **Rotating `kv/identity/quackback-oidc-client`** breaks the board's sign-in until the new secret is
  typed in step 2's form.
- **The admin's Keycloak email stays as it is.** Quackback links a Keycloak sign-in to an existing
  account by email: never rename or delete the admin's Keycloak account, and when someone leaves
  `feedback-users` for good, delete their board account too, so no one can take over the address.
- **Signing out of the board** does not sign out of Keycloak: the next **Log in** is silent again.
