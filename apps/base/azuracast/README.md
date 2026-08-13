# azuracast

AzuraCast is the cluster's self-hosted radio stack: web UI, station management,
Icecast frontend and Liquidsoap backend. It runs as a single replica in the
`azuracast` namespace from the upstream **all-in-one** image
`ghcr.io/azuracast/azuracast`, which packs nginx, PHP-FPM, MariaDB, Redis,
Icecast and Liquidsoap into one container under supervisord — so almost every
oddity in these manifests comes from hosting a docker-compose appliance as a
Kubernetes pod. The web UI is published through the shared Cloudflare tunnel at
`https://mve-azuracast.eliorion.fr`, and the raw Icecast port is published on
the tailnet as `azuracast-stream` for an off-site relay to pull from. Background:
[`../../../documentations/13-azuracast-load-test.md`](../../../documentations/13-azuracast-load-test.md)
(what a listener costs) and
[`../../../documentations/11-azuracast-public-relay.md`](../../../documentations/11-azuracast-public-relay.md)
(how many remote listeners the home uplink serves, and the audio-over-the-tunnel
correction).

## How it is wired

Base (`apps/base/azuracast/`), listed by `kustomization.yaml` in this order:

- `namespace.yaml` — Namespace `azuracast`, with no pod-security labels.
- `storage.yaml` — four `ReadWriteOnce` PVCs, none setting `storageClassName`
  so they land on the cluster default (Longhorn): `azuracast-db` 5Gi
  (`/var/lib/mysql`), `azuracast-stations` 20Gi (`/var/azuracast/stations`),
  `azuracast-storage` 5Gi (`/var/azuracast/storage`), `azuracast-backups` 5Gi
  (`/var/azuracast/backups`). One PVC per volume the upstream docker-compose
  declares, so each grows on its own; `azuracast-storage` covers upstream's
  `uploads`, `geoip`, `sftpgo`, `acme`, `shoutcast2`, `stereo_tool` and `rsas`
  sub-volumes in a single mount.
- `deployment.yaml` — Deployment `azuracast`, `replicas: 1`,
  `strategy.type: Recreate`, image `ghcr.io/azuracast/azuracast:0.23.8`.
  Container ports `80` (`http`) and `8000` (`icecast`). Env:
  `APPLICATION_ENV: production` and `MYSQL_RANDOM_ROOT_PASSWORD: "yes"`. Pod
  security context is only `fsGroup: 1000` +
  `fsGroupChangePolicy: OnRootMismatch`; the container has **no**
  securityContext. Requests `500m` CPU / `1Gi` memory, no limits. Startup,
  liveness and readiness probes all `httpGet /` on the `http` port; the startup
  probe allows 10 minutes (`periodSeconds: 10`, `failureThreshold: 60`). Mounts
  the four PVCs above.
- `service.yaml` — `ClusterIP` Service `azuracast`, selector `app: azuracast`,
  ports `80` (`http`) and `8000` (`icecast`).
- `service-stream-tailscale.yaml` — a second `ClusterIP` Service
  `azuracast-stream`, same selector, carrying **only** port `8000`, annotated
  `tailscale.com/expose: "true"` and `tailscale.com/hostname: azuracast-stream`.
  The tailscale-operator turns that into an L3 tailnet forward at
  `http://azuracast-stream.tail45b0ca.ts.net:8000/radio.mp3`.

Flux: `apps/staging/azuracast/kustomization.yaml` pulls `../../base/azuracast/`
and nothing else; `apps/staging/kustomization.yaml` lists `azuracast/`; the
`apps` Flux Kustomization in `clusters/staging/apps.yaml` reconciles
`./apps/staging` every `1m` with `prune: true` and SOPS decryption. It
`dependsOn` `db-migrations`, which depends on `databases` (`wait: true`) — so a
broken CNPG cluster stalls the whole app chain, azuracast included, even though
azuracast has no CNPG database of its own (MariaDB lives inside the pod).

Not in this directory but part of the component:

- The Cloudflare tunnel route `mve-azuracast.eliorion.fr` →
  `http://azuracast.azuracast.svc.cluster.local:80`, configured in the Zero
  Trust dashboard and documented in
  `infrastructure/services/staging/cloudflare/README.md`. It is not in git.
- `infrastructure/controllers/staging/tailscale-operator/` — the operator that
  reacts to the `tailscale.com/expose` annotation; its README lists
  `azuracast-stream` (port 8000) among the exposed Services.
- `scripts/azuracast-load-test/` — the listener generators for docs 11 and 13,
  deliberately outside every Flux path and applied by hand.
- `scripts/azuracast-relay/` — the off-site Icecast relay that pulls one copy of
  the stream over the tailnet and fans it out publicly.
- `scripts/azuracast-embed/` — the player snippet, which uses whatever
  `/api/nowplaying` advertises as `listen_url`.

There is no monitoring config and no alert rule for azuracast.

## Why it is like this

**`strategy.type: Recreate`, one replica.** The Longhorn volumes are
`ReadWriteOnce` and MariaDB is embedded in the pod: the old pod must release the
volumes before the new one can attach them. `RollingUpdate` deadlocks.

**`fsGroup: 1000`.** The app runs as `azuracast` (uid/gid 1000) even though
supervisord is root, and a fresh PVC mounts `root:root` 755. Without the fsGroup
the migration step cannot write `/var/azuracast/backups/pre_migration_db.sql`,
the schema migration aborts, and `azuracast:setup` then dies querying a column
the migration never added. Upstream never hits this: Docker named volumes
inherit the image's ownership, and upstream's `03_persist_dir.sh` only chowns
`/var/azuracast/storage/*`, never the backups or stations mount roots.
`fsGroupChangePolicy: OnRootMismatch` skips the recursive chown when the volume
root already matches — the media volume is the one that gets big.

**No container securityContext.** The all-in-one image starts supervisord as
root and drops privileges per process itself. `runAsNonRoot` or a capability
drop stops it booting. For the same reason the namespace carries no pod-security
labels: Talos enforces `baseline`, which the image satisfies, while the
`restricted` level would only warn/audit — until someone pins it.

**`MYSQL_RANDOM_ROOT_PASSWORD: "yes"` is required, not optional.**
`MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_DATABASE` are baked into the image;
the root-password choice is not. Without one of the four `MARIADB_*ROOT_PASSWORD`
options the first-boot init aborts with *"Database is uninitialized and password
option is not specified"*. MariaDB then starts on a datadir with no `mysql`
schema and dies on *"Table 'mysql.db' doesn't exist"*, taking nginx, php-fpm,
Icecast and Liquidsoap with it — supervisord gates them all behind it. A random
password is the right choice because nothing needs the root account: the app
connects as `azuracast` over the container's own socket.

**`500m` CPU / `1Gi` memory requests.** MariaDB, Redis, PHP-FPM, Icecast and
Liquidsoap share this one container, so the request covers the whole stack, not
a web app. Doc 13 measured the idle footprint at ~0.13 cores and ~656 MiB, with
a marginal cost of 0.086 millicores and 12 KiB per listener — the request is
comfortable into four figures of listeners and needs no change.

**A 10-minute startup probe.** First boot initialises MariaDB and runs the
schema migrations: minutes, not seconds. The startup probe carries that window
so the liveness probe can stay tight (30s period, 3 failures) afterwards.

**Four PVCs on a Deployment, not a StatefulSet.** One PVC per upstream volume so
each grows independently, and a Deployment owns them so they stay resizable —
the music library is the one volume here guaranteed to fill up. A StatefulSet's
`volumeClaimTemplates` are immutable, and resizing would mean deleting the
StatefulSet and the PVC.

**A separate Service for the stream.** The `azuracast` Service also carries
`:80`, the admin console, and `tailscale.com/expose` is an L3 forward that
preserves every port on the Service — annotating it would publish the admin
console to every device on the tailnet. `azuracast-stream` carries `:8000`
alone.

**`tailscale.com/expose` rather than a Tailscale `Ingress`** — the opposite call
from ai-gateway and n8n. Those are browser origins whose session cookies need
TLS and a port-less hostname. This is a byte stream pulled by another server:
WireGuard already encrypts the hop, Icecast relays speak plain HTTP, and an L3
forward that preserves `:8000` is exactly what a relay's `<relay>` block
expects.

**The public hostname carries the audio as well as the UI, knowingly.** nginx
proxies `/listen/*` to the local Icecast on the same port 80 the tunnel already
routes, so publishing the host published the stream with it; `/api/nowplaying`
advertises that URL as `listen_url`, so every embed and player uses it by
default. This was measured from outside the network on 2026-08-10 (200,
`content-type: audio/mpeg`, `icy-br: 192`, 27 666 B/s sustained over 15 s) and
**decided 2026-08-10: keep it**. It is the sustained non-HTML streaming
Cloudflare's ToS §2.8 restricts; the accepted risk is that Cloudflare may
throttle or object at scale. Documents older than that decision — including
doc 13 — still assert the hostname carries the UI only; doc 11 is the correction
and doc 14 records it in the incident index. The fallbacks are a direct path
(a port forward to a Cilium LB-IPAM address) or the off-site relay; the home
uplink was measured at ≥ 16.6 Mbps, i.e. ≥ 80 concurrent listeners at 192 kbps.

## Traps

- **Do not pin the image below `0.23.6`.** CVE-2026-42606 (CVSS 8.1) lets any
  client poison `X-Forwarded-Host` to redirect password-reset links to an
  attacker host, taking over admin accounts and wiping 2FA. That matters here
  specifically because this instance is reachable from the internet through the
  tunnel. The tag is pinned and Renovate bumps it.
- **`strategy.type: Recreate` must stay.** `RollingUpdate` deadlocks on the RWO
  volumes.
- **`fsGroup: 1000` must stay.** Remove it and a fresh install fails in the
  schema migration, not at mount time — the pod looks like it booted and then
  dies in `azuracast:setup`.
- **Do not add a container `securityContext`.** `runAsNonRoot` or a capability
  drop stops supervisord booting.
- **Do not add `enforce: restricted` to the namespace.** The pod will not start.
- **`MYSQL_RANDOM_ROOT_PASSWORD` must not be removed.** Without a
  `MARIADB_*ROOT_PASSWORD` option the first-boot init aborts and every process
  in the container stays down.
- **Port `80` in `service.yaml` is what cloudflared targets** for
  `mve-azuracast.eliorion.fr`. That route lives in the Zero Trust dashboard, not
  in git, so nothing here will fail a build if the port changes.
- **Extra stations need extra Service ports.** `8000` is the first
  auto-assigned station mount (`AUTO_ASSIGN_PORT_MIN`); further stations get
  `8005`, `8010`, … and each needs its own entry in `service.yaml`.
- **Do not put `tailscale.com/expose` on the `azuracast` Service** — it would
  publish the admin console on `:80` to the whole tailnet. The annotation
  belongs on `azuracast-stream`, which carries `:8000` only.
- **Do not convert the workload to a StatefulSet.** `volumeClaimTemplates` are
  immutable; the PVCs would stop being resizable.
- **Do not lower the startup probe's `failureThreshold: 60`.** It is what keeps
  the liveness probe from killing the pod during the first-boot MariaDB
  initialisation and schema migration.
- **The AzuraCast setting "Use Web Proxy for Radio"** moves audio onto the
  port-80 path. That path is already public through the tunnel, so this setting
  changes how much of the audience arrives over Cloudflare.

## Operating it

```bash
kubectl kustomize apps/staging                  # must build
flux get kustomizations                         # databases → db-migrations → apps Ready
kubectl -n azuracast get pods,pvc,svc
kubectl -n azuracast logs deploy/azuracast | head -50   # first boot: MariaDB init + migrations
kubectl -n tailscale get pods                   # ts-azuracast-stream-… proxy registered
```

Reachability checks:

```bash
curl -sI https://mve-azuracast.eliorion.fr/                          # web UI, through the tunnel
curl -sI http://azuracast-stream.tail45b0ca.ts.net:8000/radio.mp3    # want 200, from the tailnet
```

**First run:** the container boots into a setup wizard which asks for the site
base URL. Enter `https://mve-azuracast.eliorion.fr` — that value is what
security-critical emails (password resets) are built from.

**A station created by the wizard is not broadcastable yet.** It has
`has_started = 0`, so `writeConfiguration()` throws *"Station has not started
yet."*, writes no supervisord config, and `azuracast:radio:restart` fails with
`AzuraCast.ERROR: Supervisor fault: BAD_NAME: station_1` — a symptom that names
nothing about the cause. `scripts/azuracast-load-test/seed-media.sh` performs
the whole sequence (generate tones, `azuracast:sync:task check_media --force`,
attach to the wizard's `default` playlist, set `has_started`, restart); doc 13
has the detail.

Ground truth for listener counts is Icecast's `status-json.xsl`, not
`/api/nowplaying` — the latter is a periodically rebuilt cache that reports peak
alongside current.

Capacity: 0.20 Mbps per listener at 192 kbps, and bandwidth is the only thing
that scales. The lever is bitrate, not hardware. The load-test and uplink
procedures are in
[`../../../documentations/13-azuracast-load-test.md`](../../../documentations/13-azuracast-load-test.md)
and
[`../../../documentations/11-azuracast-public-relay.md`](../../../documentations/11-azuracast-public-relay.md);
the remote sweep deliberately saturates the household internet connection while
it runs.

### Overlays

Only `apps/staging/azuracast/` exists — there is no production overlay. That
overlay is a bare passthrough: `resources: [../../base/azuracast/]`, no
namespace directive, no patches, no secrets. Every resource in the base already
sets `namespace: azuracast` explicitly, so staging and base render identically.
