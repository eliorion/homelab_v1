# monica

[Monica HQ](https://github.com/monicahq/monica), a personal CRM, from the
**official** chart (`monica` 1.0.15, `https://monicahq.github.io/helm/`), image
`monica:5.0.0-beta.5-apache`, one replica in namespace `monica`, Service on 8080
(targetPort 80), 10Gi of RWO storage on the LINSTOR `ssd` class. Published on the
tailnet at **https://monica.tail45b0ca.ts.net** and nowhere else. Postgres is the
external CNPG cluster `monica-db`, which ships from
[`../databases/monica/`](../databases/monica/README.md) along with the namespace.

**This is v5 "Chandler", still a beta** (`5.0.0-beta.5`). That is not a
preference — see [Why it is like this](#why-it-is-like-this).

## How it is wired

| File | What it is |
|---|---|
| `repository.yaml` | `HelmRepository/monicahq` in `flux-system`, plain https (the chart has no OCI registry) |
| `release.yaml` | the `HelmRelease`, its values, and the cron postRenderer |
| `ingress-tailscale.yaml` | the tailnet device `monica`, `defaultBackend` to Service `monica:8080` |
| `../../staging/monica/` | the overlay: the SOPS `monica` Secret holding `appkey` |

Secrets in play, and who makes them:

| Secret | Made by | Read for |
|---|---|---|
| `monica-db-app` | CNPG, from `bootstrap.initdb` | `DB_USERNAME`, `DB_PASSWORD` |
| `monica` | you, SOPS, from the overlay template | `APP_KEY`, and `smtp-*` if mail is enabled |

The chart creates **no** Secret of its own: `monica.existingSecret.enabled` and
`externalDatabase.existingSecret.enabled` each suppress one.

### CalDAV / CardDAV from Apple devices

Monica runs a DAV **server** at `/dav`. It does **not** push into iCloud — your
devices add Monica as a separate account that sits alongside iCloud. Monica
serves its own discovery redirects (`routes/web.php`: `/.well-known/carddav` and
`/.well-known/caldav` → `/dav`), so the Ingress needs no annotation or rewrite
snippet.

On iPhone or Mac, with Tailscale connected:

1. Settings → Calendar (or Contacts) → Accounts → Add Account → Other →
   Add CalDAV / CardDAV Account.
2. Server `monica.tail45b0ca.ts.net`, user = the Monica account email,
   password = a Monica **API token**, not the login password.

Sync only runs while the device is on the tailnet. macOS Contacts is reported
broken upstream ([monica#4240](https://github.com/monicahq/monica/issues/4240));
iOS Contacts is reported working.

## Why it is like this

**v5 beta, because CNPG forces it.** Monica v4 is the stable release, but its
official image cannot run on Postgres at all: `monicahq/docker`
`4/apache/entrypoint.sh` implements `waitfordb()` with `new mysqli(...)` and a
`CREATE DATABASE ... CHARACTER SET utf8mb4`, and `exit(1)`s under
`set -Eeo pipefail` — it aborts before `artisan monica:update` ever runs. v4 is
also Laravel 9 with no `/up` route, which every probe in this chart hardcodes
with no override. v5 uses the driver-agnostic `artisan waitfordb` and registers
`health: '/up'` (Laravel 12). Since the barman-cloud plugin only backs CNPG,
choosing v4 would have meant giving up both Postgres and the backups. The cost
accepted: beta software, the vaults data model, and no `/settings/dav` page — DAV
URLs are built by hand.

**The official chart, not hand-written kustomize.** This is the opposite call
from [`../nextcloud/README.md`](../nextcloud/README.md), and for the opposite
reason: Monica's chart is published by MonicaHQ itself (signed releases, the
maintainer is the upstream author), and all five of its subcharts are
`condition`-gated off by default, so none of the withdrawn Bitnami images are
pulled. What is left is exactly the env plumbing Monica needs.

**The tailnet Ingress is a separate object, not `ingress.enabled`.** Same as
[`../../../infrastructure/services/base/ai-gateway/`](../../../infrastructure/services/base/ai-gateway/README.md).
The chart's template renders `rules[0].host` from `monica.host`, and hand-writing
a `defaultBackend` Ingress matches every other tailnet surface in the repo.

**Monica is on the tailnet only.** It holds the contact details of everyone you
know. The repo's rule is that anything whose authentication boundary is the
tailnet goes through the Tailscale operator and never through the Cloudflare
tunnel — [`../../../documentations/14-design-decisions.md`](../../../documentations/14-design-decisions.md).

**Cron runs as a container in the app pod, added by a postRenderer.** Monica's
reminders and scheduled jobs need `artisan schedule:run` every minute. The
chart's own `monica.cronjob` is a `CronJob` and `monica.queue` is a `DaemonSet`,
and both mount the same RWO PVC as the app pod while honouring neither
`nodeSelector` nor `affinity` — on a three-node cluster they fail Multi-Attach
whenever they land elsewhere, which for the CronJob is most minutes. Both are
also `helm.sh/hook` resources, untracked by Helm and so invisible to Flux drift
detection, and the queue template additionally mints a cluster-scoped
`PriorityClass` at value 1000000. Putting cron in the app pod makes the node
question disappear. It is a `postRenderers` patch rather than a chart value
because the chart's own sidecar hook is broken — see [Traps](#traps).

**`QUEUE_CONNECTION=sync`.** With `monica.queue.enabled: false` there is no
worker, so jobs must run inline. Enabling the queue would mean Redis and the
DaemonSet above.

## Traps

- **`monica.extraSidecarContainers` is broken in chart 1.0.15 — do not use it.**
  `templates/deployment.yaml:215` renders it at `nindent 6` while container list
  items sit at indent 8 (`extraInitContainers` on line 224 correctly uses 8), so
  any value produces YAML that will not parse and the release fails to install.
  The cron container goes through `spec.postRenderers` instead.
- **`appkey` must decode to exactly 32 bytes, and must be random.** Monica pins
  `cipher => 'AES-256-CBC'` (`config/app.php:102`) and Laravel's
  `Encrypter::supported()` tests `mb_strlen($key, '8bit') === 32`, so anything
  else throws `Unsupported cipher or incorrect key length` and the pod never
  starts. A `base64:` prefix is stripped and decoded
  (`EncryptionServiceProvider::parseKey()`); without the prefix the literal
  string bytes are the key. It is the AES key itself, not a passphrase — nothing
  stretches it, so a memorable 32-character string is a weak key against anyone
  holding a database dump.
- **Never rotate `appkey`.** It is the Laravel `APP_KEY` that encrypts columns in
  `monica-db`; a database restore without that exact value is worthless. Laravel
  12 can decrypt with retired keys via `previous_keys` (`config/app.php:106`,
  env `APP_PREVIOUS_KEYS`), which the chart does not expose — it would need a
  `monica.extraEnv` entry. That is a recovery path, not a reason to rotate. The
  chart would rotate it on its own if left to: `templates/secrets.yaml` guards a
  `lookup` that does not run during a Flux dry-run, so `randAlphaNum 32` re-rolls
  on every reconcile. `monica.existingSecret.enabled: true` is what prevents it.
- **The Secret must be named exactly `monica`, with key `appkey`.**
  `_helpers.tpl:107-111` hardcodes `secretKeyRef: {name: <fullname>, key: appkey}`
  and **ignores** `monica.existingSecret.secretName`. `fullnameOverride: monica`
  is what makes the two agree.
- **`internalDatabase.enabled` must stay `false`.** The chart's env helper tests
  `internalDatabase` → `mariadb` → `postgresql` → external, in that order, so the
  default `true` silently runs SQLite while every `externalDatabase` value is
  ignored and nothing warns.
- **`monica.host` must equal `tls.hosts[0]` plus the tailnet suffix.** `APP_URL`
  is hardcoded to `https://<monica.host>` and all three probes send it as the
  `Host` header, so a mismatch breaks both the generated links and readiness.
- **The Service port is 8080, not 80.** The Ingress `defaultBackend` must say
  8080; the container port is 80 and the chart maps it.
- **The Service must carry no `tailscale.com/expose`** and `ingress.enabled` must
  stay `false` — either would register a second tailnet device contending for the
  hostname, and the loser is silently suffixed (`monica-1`).
- **PRECONDITION Flux cannot satisfy:** HTTPS Certificates must be enabled by
  hand in the Tailscale admin console (DNS → HTTPS Certificates), or the proxy
  comes up with no certificate.
- **The image tag appears twice** — `values.image.tag` and the postRenderer's
  cron container. Bump both together. Renovate manages the chart version but not
  image tags under `apps/`.
- **Keep `replicaCount: 1` and `autoscaling.enabled: false`.** The storage PVC is
  RWO, so a second pod cannot mount it.

## Operating it

```sh
kubectl kustomize apps/staging/monica        # render check before commit
flux get helmreleases -A | grep monica
kubectl -n monica get pods,pvc,ingress
kubectl -n monica logs deploy/monica -c cron --tail=20
```

Everything is GitOps: change the YAML, commit, push, let Flux reconcile. Nothing
here is `kubectl apply`ed by hand.

### First boot

1. Create `apps/staging/monica/monica-secrets.enc.yaml` from the `.example`,
   generate `appkey` (`printf 'base64:%s\n' "$(openssl rand -base64 32)"`),
   `sops -e -i` it, and uncomment it
   in `apps/staging/monica/kustomization.yaml`. Until then the pod has no Secret
   to read and will not start — it fails closed, deliberately.
2. Push. Once the pod is Ready, open https://monica.tail45b0ca.ts.net and
   register the first account.
3. Mint an API token in Monica's settings for the DAV clients.

### Checking DAV

```sh
curl -sI https://monica.tail45b0ca.ts.net/.well-known/caldav        # 301 -> /dav
curl -u '<email>:<api-token>' -X PROPFIND https://monica.tail45b0ca.ts.net/dav   # 207
```

### Enabling mail

Flip `monica.mail.enabled` to `true` in `release.yaml`, fill the `smtp-username`
and `smtp-password` keys already present in the `monica` Secret, and add the
`monica.mail.smtp` host/port/encryption plus `fromAddress`. The username and
password are read from the same Secret, so no new object is needed.

### Overlays

`staging/` is the only reconciled overlay, and it carries nothing but the SOPS
Secret. There is no `production/monica`.
