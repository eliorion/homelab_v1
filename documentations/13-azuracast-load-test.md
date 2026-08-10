# AzuraCast — what a listener actually costs

Measured 2026-08-09 on `staging`, AzuraCast `0.23.8`, station `sysadmin`,
one 192 kbps MP3 mount, Icecast frontend + Liquidsoap backend.

**The answer in one line: this is bandwidth-bound and nothing else.** A thousand
concurrent listeners cost about a tenth of a CPU core and 12 MiB of RAM, and
193 Mbps of egress.

## Results

| Listeners | CPU cores | RAM MiB | Egress KiB/s | Egress Mbps |
|---:|---:|---:|---:|---:|
| 0 | 0.117 | 648.7 | 0.7 | — |
| 1 | 0.135 | 651.5 | 25.2 | 0.2 |
| 10 | 0.127 | 653.1 | 246.1 | 2.0 |
| 20 | 0.132 | 677.8 | 491.4 | 4.0 |
| 50 | 0.140 | 654.6 | 1 227.3 | 10.1 |
| 100 | 0.140 | 655.5 | 2 453.5 | 20.1 |
| 500 | 0.184 | 662.3 | 12 273.4 | 100.5 |
| 1000 | 0.210 | 668.3 | 24 682.0 | 202.1 |

Icecast's own socket count matched the intended figure at every step, so no row
is measuring a different population than its label claims.

Least-squares slope across all eight points — the per-listener marginal cost,
which is the number to extrapolate with:

| | Per listener | Fixed (idle) |
|---|---|---|
| CPU | **0.086 millicores** | 0.130 cores |
| RAM | **12 KiB** | 656 MiB |
| Egress | **24.7 KiB/s** (0.20 Mbps) | ~0 |

Use the slope, not `total ÷ N`. Liquidsoap encodes the stream once whether one
listener is connected or a thousand; that fixed ~0.13 cores is the intercept, and
folding it into a per-listener figure overstates the marginal cost enormously at
small N.

## Reading it

**Egress is the only thing that scales.** 24.7 KiB/s per listener against the
24 KiB/s a 192 kbps mount predicts — the extra ~3% is TCP and HTTP overhead. That
agreement is also the evidence the test was valid: clients were consuming in real
time, not buffering or stalling.

**CPU is effectively flat.** Going from 0 to 1000 listeners added 0.09 cores.
Extrapolated, 10 000 listeners would want ~1 core. On this hardware CPU will
never be the reason to stop adding listeners.

**RAM is flatter still** — 12 KiB per listener, so 1000 listeners cost ~12 MiB
against a 650 MiB idle footprint that is MariaDB, PHP-FPM and Liquidsoap. The
677.8 MiB reading at N=20 is noise wider than the entire trend it sits in.

## What this means for capacity

Everything below follows from the one number that matters: **0.20 Mbps per
listener at 192 kbps.**

| Constraint | Ceiling |
|---|---|
| Node NIC (1 Gbps, `node_network_speed_bytes`) | ~5 000 listeners at 100%, ~4 000 at a sane 80% |
| 100 Mbps uplink | ~500 listeners |
| 20 Mbps uplink | ~100 listeners |
| CPU (8 cores on this node) | far past any of the above |

So the question "how many listeners can I serve?" is entirely "how much upload
bandwidth do I have?" — the pod's resource requests (`500m` / `1Gi`) are
comfortable to four figures and need no change.

The lever, if the uplink is the limit, is **bitrate, not hardware**: a 128 kbps
mount is 0.132 Mbps per listener (+50% listeners for the same pipe), 96 kbps is
0.099 (+100%). Adding a second, lower-bitrate mount costs one more Liquidsoap
encoder — a fixed CPU cost, not a per-listener one.

### If listeners come from the internet

The measured egress *is* the sustained uplink requirement — 1000 listeners is
193 Mbps continuously, which is beyond a residential uplink regardless of what
the cluster can do.

It also cannot go through the Cloudflare tunnel. That is exactly the sustained
non-HTML streaming Cloudflare's ToS §2.8 restricts, and
`infrastructure/services/staging/cloudflare/README.md` records that
`mve-azuracast.eliorion.fr` carries the web UI only — including the
"Use Web Proxy for Radio" setting that would silently move audio onto it. Public
streaming means a LAN/LB-IPAM path plus a port forward, or a relay/CDN in front.

## Method

Rig lives in `scripts/azuracast-load-test/` — deliberately outside every Flux
path, applied by hand, deleted after; see its README for why that is a considered
exception rather than drift.

A listener is one `curl` holding the Icecast mount open and consuming at the
stream's own pace, targeting `azuracast.azuracast.svc:8000` directly rather than
the nginx `/listen/*` proxy (which would measure nginx). Generators carry required
anti-affinity against the AzuraCast pod: on the same node the traffic would cross
a veth pair instead of a NIC, and the generator's CPU would compete with the
subject. Above 250 listeners the load shards across pods — a thousand curl
processes in one container measures the generator's limits, not the server's.

Each step settled 2 min, then a 3 min Prometheus rate window.

### Two things that would have produced believable, wrong numbers

- **`/api/nowplaying` is not the listener count.** It is a periodically-rebuilt
  cache carrying peak alongside current; with one client connected it reported 2
  while Icecast reported 1. Ground truth is Icecast's `status-json.xsl`.
- **A CPU limit on the generator** would throttle the readers, back up Icecast's
  send buffer, and drag measured egress below the real cost. The generator runs
  with requests only.

## Getting the station broadcastable

Not obvious, and the failure mode is silent — recorded here because the load test
could not start until it was solved.

A station created by the setup wizard has `has_started = 0`. `writeConfiguration()`
throws `Station has not started yet.` and writes no supervisord config, so
`azuracast:radio:restart` fails with:

```
AzuraCast.ERROR: Supervisor fault: BAD_NAME: station_1
```

which names the symptom and not one thing about the cause. `seed-media.sh`
handles the whole sequence: generate tones with the bundled ffmpeg, import via
`azuracast:sync:task check_media --force`, attach to the wizard's `default`
playlist (no CLI exists for playlist membership), set `has_started`, restart.
