# fider

[Fider](https://github.com/getfider/fider) is the feedback site of Scout (asp
`services/fbref/webapp`): its users post bugs and feature requests, with a title, a description,
the URL that went wrong and screenshots (attachments, stored in the database: `BLOB_STORAGE`
stays at its `sql` default, so there is no bucket to run). Published at
`https://feedback.eliorion.fr` through the Cloudflare tunnel.

## Who can reach it

Two gates, one account. **Cloudflare Access** in front: the policy is the Keycloak group
`scout-users` (realm `staging-apps`), so approving a Scout account is what opens Fider to that
person. **Fider's own login** behind it, through the Keycloak client `fider`: same Keycloak
session, no second password. See `infrastructure/services/staging/cloudflare/README.md` §6.

## How it is wired

| File | What it does |
|---|---|
| `deployment.yaml` | Fider, pinned by digest, as a non-root user with a read-only root (the image declares no `USER`). `./fider migrate` runs before the server on every start |
| `service.yaml` | ClusterIP :3000, the tunnel's target |
| `networkpolicy.yaml` | in: the `cloudflare` namespace only. out: `fider-db`, DNS, and public 443/587/465 (the OAuth code exchange with Keycloak's public hostname, SMTP) |
| `../databases/fider/` | the namespace and the CNPG cluster `fider-db` (databases tier, before the apps tier) |
| `../../staging/fider/` | `BASE_URL` (= `FIDER_URL` in the realm vars) / `LOCALE`, and the ExternalSecret `fider-secrets` (`jwt-secret`, OpenBao `kv/fider/fider-secrets`) |

Seed OpenBao first (infrastructure/services/base/keycloak/README.md, "Scout and Fider"). Mail goes
through the realm's SMTP account: the Secret `apps-realm-smtp`, kept in `identity` and
reflected here (`infrastructure/services/staging/keycloak/realm/`).

## Why it is like this

- **One CNPG instance, attachments in the database.** Feedback posts are small; `BLOB_STORAGE`
  stays at Fider's `sql` default, so there is no bucket or volume to run, and a second instance
  is one field away. No backup yet: it needs a Garage key like n8n's.
- **Non-root, read-only root.** The image declares no `USER`; nothing in it needs root, and
  Fider writes nothing but `/tmp` (logs go to the console).
- **The NetworkPolicy admits only the `cloudflare` namespace**, so nothing reaches Fider around
  the Access application. Egress is the database, DNS, and public 443 (the OAuth code exchange
  with Keycloak's PUBLIC hostname) / 587 / 465 (SMTP), every private range excluded.

## First run (once, after the Access application and the tunnel route exist)

1. Open `https://feedback.eliorion.fr`: Fider asks for the site name and the FIRST ADMIN's email,
   and mails a link (the SMTP account must work). That account is the owner's.
2. Site Settings → Authentication → **Add new** (custom OAuth2):

   | Field | Value |
   |---|---|
   | Display name | `Eliorion` |
   | Client ID | `fider` |
   | Client secret | `bao kv get -field=client-secret kv/identity/fider-oidc-client` |
   | Authorize URL | `https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/auth` |
   | Token URL | `https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/token` |
   | Profile API URL | `https://staging-keycloak.eliorion.fr/realms/staging-apps/protocol/openid-connect/userinfo` |
   | Scope | `openid email profile` |
   | JSON path: ID / Name / Email | `sub` / `name` / `email` |

   Fider shows the callback URL (`/oauth/_<n>/callback`); the Keycloak client allows
   `https://feedback.eliorion.fr/oauth/*`, so nothing to change there. Use **Test** before
   enabling it.
3. Site Settings → Privacy: **private site** on. Authentication: email authentication **off**
   once the OAuth login works (the admin then signs in through Keycloak with the same email).
