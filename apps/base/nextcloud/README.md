# nextcloud

Self-hosted file sync and share, published on `nextcloud.eliorion.fr` through
the Cloudflare tunnel. Single replica, `nextcloud:34.0.2-apache`, a crond
sidecar for background jobs, a Valkey Deployment for locking and caching, and
the CNPG cluster in
[`apps/base/databases/nextcloud`](../databases/nextcloud/README.md) for storage.

The `nextcloud` Namespace and `nextcloud-db` ship from the databases tier, which
reconciles first — this directory assumes both already exist.

## How it is wired

- `deployment.yaml` — two containers on one pod:
  - **`nextcloud`** — the `apache` image flavour, port 80. Postgres credentials
    come from the CNPG-generated `nextcloud-db-app` Secret as `POSTGRES_HOST` /
    `_DB` / `_USER` / `_PASSWORD`. `REDIS_HOST` points at the Valkey Service;
    the image turns that into the `memcache.locking` + `memcache.distributed`
    entries in `config.php` by itself.
  - **`cron`** — the same image with `command: ["/cron.sh"]`, which is busybox
    crond running `php -f /var/www/html/cron.php` every 5 minutes. It shares the
    data volume with the main container.
- `storage.yaml` — a 10Gi RWO PVC mounted at `/var/www/html`. The *whole* tree
  is persistent, not just `data/`: Nextcloud keeps its code, `config/`, and
  installed apps there and the entrypoint patches all three on upgrade.
- `valkey.yaml` — `nextcloud-valkey` Deployment + Service, port 6379, emptyDir,
  persistence disabled.
- `service.yaml` — ClusterIP `nextcloud:80`, the tunnel origin.

The staging overlay (`apps/staging/nextcloud/`) adds:

- `configmap.yaml` — trusted domains, `TRUSTED_PROXIES`, the `OVERWRITE*` trio,
  PHP limits.
- `nextcloud-admin.enc.yaml` — `NEXTCLOUD_ADMIN_USER` / `_PASSWORD`, SOPS-encrypted.

## Why it is like this

**Hand-written kustomize, not the `nextcloud/helm` chart.** That chart lives in
the Nextcloud GitHub org but its own README states it is community-maintained,
not vendor-supported. Its three bundled subcharts (postgresql, mariadb, redis)
are Bitnami charts whose images were withdrawn in August 2025, so all three have
to be disabled and replaced anyway — CNPG here, Valkey here. What is left of the
chart is env-var plumbing plus a multi-replica HPA that RWO storage makes
unusable. Writing the ~150 lines directly matches every other app in `apps/`
(`linkding`, `audiobookshelf`, `n8n`, `glpi`, `azuracast`) and keeps Renovate
bumping the image tag rather than a chart version that hides one.

**Plain HTTP between cloudflared and this Service.** TLS terminates at the
Cloudflare edge and the tunnel leg to `cloudflared` is encrypted QUIC; the
remaining hop stays inside the Cilium overlay and never touches the LAN. The
alternative — an HTTPS listener on the shared `cilium-gw` plus a cert-manager
Certificate plus `originServerName`/`caPool` in the tunnel config — was rejected
because the `apache` image serves no TLS of its own, so it would mean adding a
terminator (Gateway listener or sidecar) purely to re-encrypt a hop that never
leaves the node network.

**`apache` flavour, not `fpm`.** `fpm` needs a second nginx container in the pod
to speak HTTP. At one replica that buys nothing.

**Cron as a sidecar, not a `CronJob`.** The data volume is RWO on Longhorn. A
`CronJob` pod scheduled onto a different node cannot mount it, and pinning the
CronJob to the app's node would silently break the moment the app pod moves.

**One replica, `strategy: Recreate`.** Same constraint as `n8n`: an RWO volume
means a RollingUpdate deadlocks — the new pod waits for a volume the old pod
still holds. Real HA would need RWX (Longhorn's NFS share-manager) and is not
worth its failure modes for a single-user instance.

**Valkey rather than Redis.** Wire-protocol identical — phpredis cannot tell
them apart — but Valkey is the Linux Foundation's BSD-3 fork of Redis 7.2.4,
taken after Redis Ltd relicensed to RSALv2/SSPL in March 2024. Redis 8 restored
an AGPLv3 option in May 2025, so the licensing argument is mostly historical;
Valkey stays because it is the distribution default and costs nothing to prefer.
Why a cache exists at all is in the
[database README](../databases/nextcloud/README.md#why-it-is-like-this).

## Traps

- **The probes send `Host: localhost`.** A kubelet `httpGet` otherwise sends the
  pod IP, and Nextcloud answers "access through untrusted domain". `localhost`
  is in `NEXTCLOUD_TRUSTED_DOMAINS` for exactly this reason — remove it and the
  pod never goes Ready.
- **`NEXTCLOUD_ADMIN_USER` / `_PASSWORD` are read only during the first-boot
  install.** Editing the Secret afterwards changes nothing; rotate the password
  with `occ user:resetpassword`.
- **The `capabilities.add` list is load-bearing.** The entrypoint chowns the
  volume as root and apache setuids to `www-data` while binding port 80.
  Dropping `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID` or
  `NET_BIND_SERVICE` kills the container on start. `runAsNonRoot: true` is
  likewise impossible with this image.
- **The cron container overrides the image ENTRYPOINT on purpose.** Letting
  `/entrypoint.sh` run there would start a second installer racing the main
  container over the same volume.
- **Never skip a major version.** Nextcloud refuses `n` → `n+2` upgrades. If
  Renovate opens a PR that jumps two majors (or the pod has been down across a
  release), upgrade one major at a time.
- **No `maxmemory-policy` on Valkey.** An eviction policy would drop file *lock*
  keys, not merely cache entries, which corrupts concurrent uploads. The
  container memory limit is the only bound.
- **`OVERWRITEPROTOCOL` must stay `https`.** Without it Nextcloud builds
  `http://` asset URLs behind the tunnel and the browser blocks them as mixed
  content — the page loads unstyled and the client apps fail to connect.
- **`TRUSTED_PROXIES` is the pod CIDR `10.244.0.0/16`** (from
  `bootstraping/talconfig.yaml`). Wrong value and every login, rate limit, and
  audit entry records the cloudflared pod IP instead of the real client.

## Operating it

The admin password is in the encrypted Secret:

```bash
sops -d apps/staging/nextcloud/nextcloud-admin.enc.yaml
```

`occ` runs inside the pod as `www-data`:

```bash
kubectl -n nextcloud exec deploy/nextcloud -c nextcloud -- \
  su -s /bin/sh www-data -c "php occ status"
kubectl -n nextcloud exec deploy/nextcloud -c nextcloud -- \
  su -s /bin/sh www-data -c "php occ user:resetpassword admin"
```

Confirm background jobs are actually running (Nextcloud's own admin page flags a
stale cron):

```bash
kubectl -n nextcloud logs deploy/nextcloud -c cron --tail=20
```

### Cloudflare tunnel

The tunnel is token-mode, so the route is **configured in the Cloudflare
dashboard, not in this repo** (Zero Trust → Networks → Tunnels → *(the tunnel)*
→ Public Hostnames):

| Field | Value |
|---|---|
| Subdomain / Domain | `nextcloud` / `eliorion.fr` |
| Path | *(empty — the whole host)* |
| Service | `http://nextcloud.nextcloud.svc.cluster.local:80` |
| HTTP Host Header | *(leave empty — pass the original through)* |

The original `Host` must reach the pod: it has to match
`NEXTCLOUD_TRUSTED_DOMAINS`, and rewriting it here produces "untrusted domain"
on every request. Delete any pre-existing `A` record for this name first — a
leftover LAN record means the name never resolves to Cloudflare and the tunnel
is bypassed entirely.

The admin panel will also ask for two `.well-known` redirects (`/.well-known/carddav`
and `/caldav`) for desktop and mobile client discovery; the apache image already
serves them, so no extra tunnel entry is needed.

### Overlays

- `apps/staging/nextcloud/` — hostname config + the admin Secret.
- No production overlay.
