#!/usr/bin/env bash
# Walk the listener sweep end to end and write one CSV row per step.
#
#   ./run-sweep.sh [out.csv]
#
# Takes roughly 35 minutes: six steps, each 2 min settling plus a 3 min rate
# window. The window has to be at least as long as the rate() range in the
# queries or the numbers are averaged over data that predates the step.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/results.csv}"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-/workspaces/homelabv1/bootstraping/kubeconfig}"
STEPS="${STEPS:-0 1 10 20 50 100 500 1000}"
SETTLE="${SETTLE:-120}"
WINDOW="${WINDOW:-180}"
PER_POD="${PER_POD:-250}"
KUBECTL="$(command -v kubectl)"

k() { sudo env KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL" "$@"; }

k -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090 >/dev/null 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT
sleep 5

# Resumable: the run is ~35 min of mostly waiting, and losing it to an
# interrupted shell means starting over. Steps already in the CSV are skipped,
# so re-running picks up where it stopped.
[ -f "$OUT" ] || echo "intended,actual_listeners,cpu_cores,mem_MiB,tx_KiB_s,rx_KiB_s" > "$OUT"

for N in $STEPS; do
  if grep -q "^${N}," "$OUT"; then
    echo "===> step N=$N already recorded, skipping"
    continue
  fi
  echo "===> step N=$N"
  if [ "$N" -eq 0 ]; then
    k -n azuracast-loadtest scale deploy/listener-sim --replicas=0
  else
    # Shard across pods above PER_POD. A thousand curl processes in one
    # container is ~1-3 GB of RSS and starts measuring the generator's own
    # scheduling limits rather than what AzuraCast costs to serve. Anti-affinity
    # only excludes the AzuraCast node, so replicas co-schedule on the other two.
    REPLICAS=$(( (N + PER_POD - 1) / PER_POD ))
    PER=$(( (N + REPLICAS - 1) / REPLICAS ))
    if [ $(( REPLICAS * PER )) -ne "$N" ]; then
      echo "  warn: ${REPLICAS}x${PER} = $((REPLICAS * PER)), not $N — pick an N that divides evenly"
    fi
    echo "  ${REPLICAS} pod(s) x ${PER} listeners"
    k -n azuracast-loadtest set env deploy/listener-sim "LISTENERS=$PER"
    k -n azuracast-loadtest scale deploy/listener-sim --replicas="$REPLICAS"
    k -n azuracast-loadtest rollout status deploy/listener-sim --timeout=180s
  fi

  sleep "$SETTLE"
  sleep "$WINDOW"
  PROM=http://localhost:9090 "$HERE/collect.sh" "$N" | tee -a "$OUT"
done

echo "===> done"
column -s, -t "$OUT"
