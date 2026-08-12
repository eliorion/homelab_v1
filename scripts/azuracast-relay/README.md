# Public relay — real listeners, without exposing the cluster

Runs on your own server outside the house. Pulls **one** copy of the stream from
the cluster over the tailnet and fans it out to the public.

```
listeners ──► VPS : Icecast relay ──tailnet──► azuracast-stream.<tailnet>.ts.net:8000
  (public)         (this directory)                    (cluster, never public)
```

## How it is wired

Nothing here is Flux-managed: this runs with `docker compose` on a machine
outside the cluster.

| File | What it is |
|---|---|
| `Dockerfile` | `alpine:3.22` + `apk add icecast gettext curl`. Copies `icecast.xml.template` to `/etc/icecast/`, `web/` to `/usr/share/icecast/web/`, `entrypoint.sh` to `/entrypoint.sh`. `EXPOSE 8000`, `USER icecast`. |
| `entrypoint.sh` | Refuses to start without `MASTER_HOST`, `RELAY_PUBLIC_HOST`, `ADMIN_PASSWORD`, `SOURCE_PASSWORD`, `RELAY_PASSWORD`; defaults `MASTER_PORT=8000`, `MOUNT=/radio.mp3`, `MAX_CLIENTS=50`. Renders the template with `envsubst` into `/tmp/icecast.xml`, logs one summary line, `exec icecast -c /tmp/icecast.xml`. |
| `icecast.xml.template` | The whole Icecast config, every variable substituted at start. |
| `docker-compose.yml` | Service `relay`, `build: .`, `restart: unless-stopped`, publishes `8000:8000`, passes the `.env` values through, healthchecks `http://localhost:8000/status-json.xsl` every 30 s (5 s timeout, 3 retries), caps container logs at 5 × 20 MB. |
| `.env.example` | Template for `.env`, which is never committed. |
| `web/index.html` | The listener connection-test page, served at `/` through the `<alias>`. |
| `collect-reports.sh` | Turns the test page's reports into CSV on stdout. |

Icecast comes from Alpine's own package rather than one of the relay images on
Docker Hub: those are either an untagged `latest` or frozen in 2023, and this
host is publicly reachable. `gettext` is in the image only for `envsubst` —
rendering at start is what keeps every password in the environment and out of
any `icecast.xml` on disk or in a layer.

What the template sets, and why those values:

- `<clients>` and `<max-listeners>` both take `MAX_CLIENTS`; `<sources>` is 2
  (the relay pull, plus headroom).
- `burst-on-connect` 1 with `burst-size` 65535 sends a small backlog to each new
  listener so players start instantly. It costs one burst per listener, not per
  second — but it does inflate the first seconds of any measurement.
- `<relay>` with `on-demand=1` pulls nothing while nobody is listening, so an
  idle relay costs the home uplink nothing. The first listener waits a second or
  so for the pull to establish.
- The access log goes to the container's stdout and the error log to stderr, so
  `docker compose logs` is the whole story — and the access log is where the
  listener reports land.
- `<chroot>0</chroot>` because the process already runs as the unprivileged
  `icecast` user inside a container.

## Why a relay and not a port forward

The home uplink carries **one stream, 0.2 Mbps, no matter how many people
listen** — the audience is served by the VPS's bandwidth, not yours. It also
means nothing at home is reachable from the internet: the relay dials out to the
tailnet, and no router port is opened.

With `on-demand=1` the relay does not even pull while nobody is listening.

## The number that decides everything: transfer, not speed

Bandwidth is not the constraint on a rented server — the **monthly transfer
allowance** is. One listener occupying a slot continuously is:

> 0.202 Mbps × 30 days ≈ **65 GB per listener-month**

| Continuous listeners | Transfer per month |
|---:|---:|
| 10 | 0.65 TB |
| 50 | 3.3 TB |
| 100 | 6.5 TB |
| 1 000 | 65 TB |

Most VPS plans include 1–20 TB. **Check yours before setting `MAX_CLIENTS`** —
that setting is a spend control, not a performance tuning knob. A 1 TB plan
sustains roughly 15 continuous listeners before overage.

## Setup

```bash
# on the VPS
tailscale up                      # join the same tailnet as the cluster
cp .env.example .env && $EDITOR .env
docker compose up -d --build
curl -sS localhost:8000/status-json.xsl | head -c 200
```

`MASTER_HOST` comes from the `azuracast-stream` Service the cluster publishes
(`apps/base/azuracast/service-stream-tailscale.yaml`). Confirm the relay can
reach it before starting:

```bash
curl -sI http://azuracast-stream.<tailnet>.ts.net:8000/radio.mp3   # want 200
```

Listeners then use `http://<your-host>:8000/radio.mp3`, and the same host serves
the connection test page at `/`.

## Put TLS in front

Icecast serves plain HTTP. If listeners will use a browser, terminate TLS with
whatever reverse proxy the host already runs (Caddy, nginx, Traefik) and proxy to
`127.0.0.1:8000`. Browsers block audio loaded over HTTP from an HTTPS page, so a
mixed setup fails in exactly the confusing way — page loads, sound never starts.

## Security, since this is a public link

- **The admin console shares port 8000.** It is password-protected, but block
  `/admin` at the reverse proxy or firewall as well. Nothing about the test needs
  it reachable from outside.
- **`MAX_CLIENTS` is the only thing between you and an unbounded bill.** Set it
  deliberately.
- **`<public>0</public>`** keeps the mount out of the public Icecast directories.
  People you invite can listen; crawlers will not find it.
- **The master stays private.** Never add a port forward "just for the test" —
  the whole point of this design is that there is nothing at home to reach.
- **Licensing is your call.** Broadcasting music publicly generally needs rights;
  the generated test tones do not.

## Collecting results

Two halves, and you want both:

```bash
# listener side — what each tester's connection actually managed
./collect-reports.sh > reports.csv

# server side — from the repo, on your workstation
RELAY=https://radio.example.com ../azuracast-load-test/watch-live.sh 90
```

`collect-reports.sh` reads the results out of Icecast's access log. The test page
reports by requesting `/report?kbps=…`, which 404s — deliberately, so there is no
endpoint to write, secure or keep running. Only the six numbers shown on screen
are sent, and the collector truncates IPs to two octets — enough to tell testers
apart and to spot one network behaving differently, not enough to identify
anyone.

**Read the audience size from the relay, never from AzuraCast.** The master sees
exactly one listener — the relay — however many people are connected.
`watch-live.sh` already does this; the AzuraCast dashboard will disagree, and it
is the one that is wrong.
