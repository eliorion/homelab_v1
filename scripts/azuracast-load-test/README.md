# AzuraCast listener load test

Measures what a listener actually costs — CPU, RAM, egress — at 0, 1, 10, 20, 50
and 100 concurrent Icecast connections.

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

## Run

```bash
cd scripts/azuracast-load-test

# 1. Give the station something to broadcast (idempotent). Ends with a gate:
#    mount 200, station_1 processes RUNNING, is_online true.
./seed-media.sh

# 2. Stand up the generator.
sudo env KUBECONFIG=../../bootstraping/kubeconfig kubectl apply -f namespace.yaml -f listener-sim.yaml

# 3. Sweep. ~35 min. Writes results.csv.
./run-sweep.sh
```

Watch a single step by hand instead:

```bash
kubectl -n azuracast-loadtest set env deploy/listener-sim LISTENERS=50
kubectl -n azuracast-loadtest logs -l app=listener-sim --tail=3
PROM=http://localhost:9090 ./collect.sh 50     # needs the port-forward running
```

## Reading the output

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

The expected conclusion is that this is **bandwidth-bound, not CPU-bound**.

## Teardown

```bash
kubectl delete ns azuracast-loadtest
kubectl -n azuracast exec deploy/azuracast -- sh -c \
  'rm -f /var/azuracast/stations/sysadmin/media/loadtest-*.mp3'
kubectl -n azuracast exec deploy/azuracast -- azuracast_cli azuracast:sync:task check_media --force
```

Leaving the tones in place is harmless but they occupy the 20 Gi
`azuracast-stations` volume and will keep playing to anyone who tunes in.
