# AzuraCast listener load test

Measures what a listener actually costs. Three rigs live here:

- an **in-cluster sweep** (`listener-sim.yaml` + `run-sweep.sh`) that measures
  what the *server* costs — CPU, RAM, egress — from 0 to 1000 concurrent
  Icecast connections;
- a **remote sweep** (`listener-sim-remote.yaml` + `run-remote-sweep.sh`) that
  pushes the same stream out through two off-site tailnet HTTP proxies, so the
  bytes cross the real home uplink and the rig finds where that uplink gives out;
- a **live sampler** (`watch-live.sh`) for a real broadcast, where listeners
  arrive on their own and nothing is driven.

All of it targets the `sysadmin` station's 192 kbps MP3 mount on the `azuracast`
namespace. The written-up results are in
[`documentations/13-azuracast-load-test.md`](../../documentations/13-azuracast-load-test.md)
(server cost) and
[`documentations/11-azuracast-public-relay.md`](../../documentations/11-azuracast-public-relay.md)
(uplink capacity, and the state of public access). This README is the rig: how
it is wired, and how to run it.

## This is deliberately not Flux-managed

Nothing here sits under a path any Flux Kustomization reconciles
(`clusters/staging/*.yaml` covers `apps/`, `infrastructure/`, `monitoring/` and
`clusters/staging/flux-system` only). It is applied by hand and deleted when the
run is over.

That is a considered exception to the repo's "never `kubectl apply`" rule, not an
oversight: a measurement harness is not desired cluster state, and putting it in
git-as-truth would leave a load generator permanently in the cluster. If you see
the `azuracast-loadtest` namespace on a cluster and no one is running a test,
it is leftover — delete it.

## Files

| File | What it is |
|---|---|
| `namespace.yaml` | The `azuracast-loadtest` namespace. Nothing else. |
| `listener-sim.yaml` | In-cluster generator `Deployment`. `curlimages/curl:8.19.0`, one `curl` per simulated listener against `http://azuracast.azuracast.svc.cluster.local:8000/radio.mp3`, count from the `LISTENERS` env var. |
| `listener-sim-remote.yaml` | Two remote generator `Deployment`s (`listener-sim-site-b`, `listener-sim-site-c`), one `ConfigMap` each carrying only `SITE`, all at `replicas: 0`. |
| `seed-media.sh` | Gives the station something to broadcast, and makes it broadcastable. Idempotent. |
| `run-sweep.sh` | Drives the in-cluster sweep, one CSV row per step → `results.csv`. |
| `collect.sh` | Captures one row for the current listener count. Called by `run-sweep.sh`, usable by hand. |
| `run-remote-sweep.sh` | Drives the remote sweep, ramping both sites together → `remote-results.csv`. |
| `watch-live.sh` | Samples a real broadcast through the public relay → `live.csv` (not committed). |
| `results.csv` | The 2026-08-09 in-cluster run, 0 → 1000 listeners. |
| `remote-results.csv` | The 2026-08-10 two-site remote run. |
| `remote-results-site-c.csv` | The follow-up attribution run, site C alone (`SITES=c OUT=remote-results-site-c.csv`). |

Every script takes the cluster through
`sudo env KUBECONFIG=$KUBECONFIG_PATH kubectl …`, with `KUBECONFIG_PATH`
defaulting to `/workspaces/homelabv1/bootstraping/kubeconfig`.

## In-cluster sweep

```bash
cd scripts/azuracast-load-test

# 1. Give the station something to broadcast (idempotent). Ends with a gate:
#    mount 200, station_1 processes RUNNING, is_online true.
./seed-media.sh

# 2. Stand up the generator.
sudo env KUBECONFIG=../../bootstraping/kubeconfig kubectl apply -f namespace.yaml -f listener-sim.yaml

# 3. Sweep. Writes results.csv.
./run-sweep.sh
```

`run-sweep.sh` port-forwards `svc/kube-prometheus-stack-prometheus` in
`monitoring` to `localhost:9090` for the duration and kills it on exit. Defaults:
`STEPS="0 1 10 20 50 100 500 1000"`, `SETTLE=120`, `WINDOW=180`, `PER_POD=250`,
output `results.csv` (or `$1`). Eight steps at 120 s settling plus a 180 s rate
window is about **40 minutes**; the older six-step form took ~35.

The window has to be at least as long as the `rate()` range in `collect.sh`'s
queries (3 m) or the numbers are averaged over data that predates the step.

Above `PER_POD` listeners the load shards across replicas: a thousand `curl`
processes in one container is ~1–3 GB of RSS and starts measuring the
generator's own scheduling limits rather than what AzuraCast costs to serve. The
anti-affinity only excludes the AzuraCast node, so replicas co-schedule on the
other two. Pick an `N` that divides evenly by the replica count — the script
warns rather than failing when it does not.

The run is resumable: steps already present in the CSV are skipped, so an
interrupted shell does not cost the whole 40 minutes.

Watch a single step by hand instead:

```bash
kubectl -n azuracast-loadtest set env deploy/listener-sim LISTENERS=50
kubectl -n azuracast-loadtest logs -l app=listener-sim --tail=3
PROM=http://localhost:9090 ./collect.sh 50     # needs the port-forward running
```

### Reading the output

`results.csv` columns: `intended, actual_listeners, cpu_cores, mem_MiB, tx_KiB_s, rx_KiB_s`.

**`actual_listeners` is the one to check first.** If it does not match
`intended`, that row is measuring something other than what its label says —
discard it and find out why before touching anything else.

It is read from Icecast's `status-json.xsl`, not AzuraCast's `/api/nowplaying`.
The latter is a periodically-rebuilt cache and disagrees: with a single client
connected it reported `2` while Icecast reported `1`, because it lags and carries
peak alongside current. Use the socket count.

Per-listener cost is the *slope* across the rows, not `total / N` on any single
row. Liquidsoap's encoding cost is paid once whether one listener is connected or
a hundred, so dividing a single row's total by its N folds that fixed cost into
the per-listener figure and overstates it — badly at small N.

### Sanity anchors

Decide these before running, so a broken run looks broken rather than plausible:

- **Egress ≈ `N × 24 KiB/s`** (the mount is 192 kbps). 100 listeners ≈ 2.4 MB/s
  ≈ **19.2 Mbps**. Materially under means the clients are not consuming in real
  time — throttled, buffering, or the mount dropped — and the run is void.
- **CPU near-flat**, with a shallow slope. Encoding is per-stream; Icecast's
  per-listener work is socket writes. A steep CPU slope is a finding, not the
  expectation.
- **RAM grows slowly** — per-connection buffers, plus MariaDB churn from listener
  rows and the ~15s now-playing recompute.

The expected conclusion is that this is **bandwidth-bound, not CPU-bound**, and
`results.csv` is that conclusion measured.

## Remote sweep

The in-cluster sweep proves what the server costs, but every byte stays inside
the building. `listener-sim-remote.yaml` sends the audio out and back:

```
Icecast ──uplink──► remote tailnet proxy ──downlink──► curl (in cluster)
```

so the home uplink carries `N × 192 kbps` exactly as it would for `N` real
remote listeners. The clients reach
`http://azuracast-stream.tail45b0ca.ts.net:8000/radio.mp3` — the tailnet-exposed
Icecast Service in
[`apps/base/azuracast/service-stream-tailscale.yaml`](../../apps/base/azuracast/service-stream-tailscale.yaml)
— through the HTTP proxies on `:8888` from
[`infrastructure/controllers/staging/tailscale-operator/egress-proxies.yaml`](../../infrastructure/controllers/staging/tailscale-operator/egress-proxies.yaml):
`tailscale-proxy-00` (site b, a residential line) and
`tailscale-proxy-scrape-c` (site c, node C). Both exist for the scraper's egress
pools; the load test borrows them as real internet endpoints somewhere else.

**Two deployments, one per site, deliberately ramped together.** If one site
degrades and the other does not, the limit is that site's own connection, not the
uplink — a single generator could not tell those apart. `SITE` arrives via
`envFrom` on a per-site ConfigMap and is what the log-scraping helpers select on.

```bash
sudo env KUBECONFIG=../../bootstraping/kubeconfig kubectl apply -f namespace.yaml -f listener-sim-remote.yaml
./run-remote-sweep.sh
```

Defaults: `STEPS="1 5 15 30 60 100 150 250"` (**per site** — total is
`per_site × participating sites`), `SITES="b c"`, `SETTLE=150`, `FLOOR=23000`,
output `remote-results.csv` (`$OUT`). The script scales both generators to 0 on
exit.

Each simulated listener re-opens the stream every `WINDOW` (120 s in the
manifest) and prints the throughput it actually achieved via `curl -w`. The
headline per site is the **median** of those readings, not the mean: one stalled
listener among fifty should not drag the number down, and fifty struggling ones
should not hide behind one fast one. `FLOOR` is 23000 B/s against the 24000 B/s
a 192 kbps mount pays out — below it a real player is draining its buffer and
will eventually go silent.

Verdicts, per step:

| Verdict | Meaning |
|---|---|
| `ok` | Every participating site is at or above `FLOOR`. |
| `one-site-limited` | Some but not all sites are short: that site's own connection is the limit and the uplink has more to give. |
| `uplink-saturated` | Every participating site is short with more than one site active — the shared leg, i.e. the uplink. |
| `single-site-limit-unattributed` | The only participating site is short. The distinction cannot be drawn, so the script says so rather than blaming the uplink. |

The sweep stops at the first `uplink-saturated` or
`single-site-limit-unattributed`: there is no point measuring past the ceiling,
and holding a saturated uplink degrades everything else in the house.

`SITES=c` retires site b. That is not hypothetical — the 2026-08-10 run found
site b folding at roughly 1 Mbps while site c was still clean at 12, which left b
unable to act as a control, so the attribution run in `remote-results-site-c.csv`
ramped c alone. Doc 11 works the conclusion through.

## Watching a real broadcast

```bash
RELAY=https://radio.example.com ./watch-live.sh [minutes]
```

Drives nothing; samples every `EVERY` seconds (default 10) for `MINUTES`
(default 60) into `$OUT` (default `live.csv` next to the script), then prints the
peak row. Columns:
`iso_time, relay_listeners, master_cpu_cores, master_mem_MiB, master_tx_KiB_s`.

The listener count comes from the **relay's** `status-json.xsl`, not the master's:
with a relay in front, the master has exactly one listener — the relay — however
many people are actually connected. Reading the master would report `1` all
evening. The relay itself is [`scripts/azuracast-relay/`](../azuracast-relay/).

## Traps

- **`/api/nowplaying` is not the listener count.** It is a periodically-rebuilt
  cache carrying peak alongside current. Ground truth is Icecast's
  `status-json.xsl`.
- **The generator runs with requests only, no CPU limit.** A limit throttles the
  readers, Icecast's send buffer backs up, and measured egress falls below the
  real cost of serving them — a believable, wrong, low number.
- **Anti-affinity against the AzuraCast pod is `required`, not `preferred`.** On
  the same node the stream crosses a veth pair instead of a NIC (network figures
  too low) and the generator's CPU competes with the subject. Both errors flatter
  the result.
- **No `|| echo 0` fallback on the remote `curl`.** `--max-time` makes curl exit
  28 on every completed window, but `-w` has already printed the real rate; a
  fallback fires alongside it, puts a phantom zero after every reading, halves
  the median and reports saturation at one listener.
- **The remote `WINDOW` is 120 s for a reason.** Icecast bursts ~64 KiB on
  connect; a short window turns that into several percent of inflated throughput.
- **`listener-sim-remote.yaml` ships `replicas: 0`.** Re-applying it parks the
  generators, so scale *after* applying, not before.
- **`seed-media.sh` sets `has_started=1` directly in the database.** A station
  created by the setup wizard has it at `0`; `writeConfiguration()` then throws
  `Station has not started yet.`, writes no supervisord config, and
  `azuracast:radio:restart` fails with `Supervisor fault: BAD_NAME: station_1` —
  which names the symptom and nothing about the cause.
- **`collect.sh` needs the Prometheus port-forward already up** (`$PROM`,
  default `http://localhost:9090`) and reads over a 3-minute `rate()` window, so
  let a step settle before calling it by hand.

## seed-media.sh

Generates 5 × 5 min sine tones (261, 329, 392, 440, 523 Hz) at 192 kbps with the
image's own ffmpeg into
`/var/azuracast/stations/$STATION/media/loadtest-N.mp3`, imports them with
`azuracast:sync:task check_media --force`, attaches them to playlist 1 — the
`default` playlist the setup wizard creates — starts the station and gates on the
mount answering, `station_1` processes running and `is_online` true.

Synthetic tones rather than real music: no licensing question, reproducible, and
the measurement is unaffected, since Liquidsoap re-encodes to the mount's fixed
bitrate whatever the source was. There is no CLI for playlist membership, so the
script writes the same `station_playlist_media` rows the UI would. It is
idempotent — ffmpeg overwrites and the scan skips known files.

## Teardown

```bash
kubectl delete ns azuracast-loadtest
kubectl -n azuracast exec deploy/azuracast -- sh -c \
  'rm -f /var/azuracast/stations/sysadmin/media/loadtest-*.mp3'
kubectl -n azuracast exec deploy/azuracast -- azuracast_cli azuracast:sync:task check_media --force
```

Leaving the tones in place is harmless but they occupy the 20 Gi
`azuracast-stations` volume and will keep playing to anyone who tunes in.

## Overlays

None. There is no `base/`+`staging/` split and no kustomization: the manifests
are applied directly with `kubectl apply -f`, against `staging` only.
