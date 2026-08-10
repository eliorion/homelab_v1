#!/usr/bin/env bash
# Find where the home uplink gives out, using the two off-site tailnet proxies
# as real remote listeners. No VPS, no port forward, nothing exposed.
#
#   ./run-remote-sweep.sh
#
# Ramps both sites together and stops as soon as listeners can no longer keep
# up — there is no point measuring past the ceiling, and holding a saturated
# uplink degrades everything else in the house.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HERE/remote-results.csv}"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-/workspaces/homelabv1/bootstraping/kubeconfig}"
# Per site. Total concurrent listeners is twice this.
STEPS="${STEPS:-1 5 15 30 60 100 150 250}"
# Which remote sites take part. Both by default; SITES=c retires the weak line.
SITES="${SITES:-b c}"
# Total listeners is per-step x participating sites, not x2 — a single-site run
# would otherwise label every row with double the load it applied.
NSITES="$(echo "$SITES" | wc -w)"
SETTLE="${SETTLE:-150}"
# 192 kbps is 24 000 B/s of payload. Below this a real player is draining its
# buffer, and will eventually go silent.
FLOOR="${FLOOR:-23000}"
KUBECTL="$(command -v kubectl)"

k() { sudo env KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL" "$@"; }

# Median, not mean: one stalled listener among fifty should not be able to drag
# the headline number down, and fifty struggling ones should not be able to hide
# behind one fast one.
median_rate() {
  k -n azuracast-loadtest logs -l "app=listener-sim-remote,site=$1" \
      --tail=-1 --since="${SETTLE}s" --prefix=false 2>/dev/null \
    | awk '/^rate /{print $2}' \
    | sort -n \
    | awk '{v[NR]=$1} END{ if (NR==0) print "0"; else print v[int((NR+1)/2)] }'
}
count_reports() {
  k -n azuracast-loadtest logs -l "app=listener-sim-remote,site=$1" \
      --tail=-1 --since="${SETTLE}s" --prefix=false 2>/dev/null | grep -c '^rate ' || true
}

k -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090 >/dev/null 2>&1 &
trap 'kill %1 2>/dev/null || true' EXIT
sleep 5
q() {
  curl -sG "http://localhost:9090/api/v1/query" --data-urlencode "query=$1" \
    | sed -E 's/.*"value":\[[0-9.]+,"([^"]*)".*/\1/'
}

[ -f "$OUT" ] || echo "per_site,total,site_b_median_Bps,site_c_median_Bps,reports_b,reports_c,master_cpu_cores,master_tx_KiB_s,verdict" > "$OUT"

for N in $STEPS; do
  grep -q "^${N}," "$OUT" && { echo "===> per-site $N already recorded, skipping"; continue; }
  echo "===> per site $N  (total $((N * NSITES)))"

  k -n azuracast-loadtest set env deploy/listener-sim-site-b "LISTENERS=$N" >/dev/null
  k -n azuracast-loadtest set env deploy/listener-sim-site-c "LISTENERS=$N" >/dev/null

  # SITES selects which remote sites take part. The two-site discriminator only
  # works when both lines are comparable; the first run showed site b topping out
  # around 1 Mbps while site c was still clean at 12, which leaves b unable to act
  # as the control. `SITES=c` retires it and ramps the healthy site alone.
  for S in b c; do
    if echo "$SITES" | grep -qw "$S"; then
      k -n azuracast-loadtest scale "deploy/listener-sim-site-$S" --replicas=1 >/dev/null
      k -n azuracast-loadtest rollout status "deploy/listener-sim-site-$S" --timeout=180s >/dev/null
    else
      k -n azuracast-loadtest scale "deploy/listener-sim-site-$S" --replicas=0 >/dev/null
    fi
  done

  # Long enough for at least one full reporting window to close on every client.
  sleep "$SETTLE"

  B=$(median_rate b); C=$(median_rate c)
  RB=$(count_reports b); RC=$(count_reports c)
  CPU=$(q 'sum(rate(container_cpu_usage_seconds_total{namespace="azuracast",container="azuracast"}[3m]))')
  TX=$(q  'sum(rate(container_network_transmit_bytes_total{namespace="azuracast"}[3m]))')

  # Judge only the sites actually taking part; a parked site reports 0 and would
  # otherwise read as a saturated one.
  SHORT=0; ACTIVE=0
  for S in b c; do
    echo "$SITES" | grep -qw "$S" || continue
    ACTIVE=$((ACTIVE + 1))
    R=$([ "$S" = b ] && echo "${B:-0}" || echo "${C:-0}")
    [ "$R" -lt "$FLOOR" ] && SHORT=$((SHORT + 1))
  done

  VERDICT=ok
  # Every participating site short means the shared leg — the uplink. Some but
  # not all means those sites' own connections are the limit, and the uplink has
  # more to give. With one site participating the distinction cannot be drawn,
  # so say so rather than claiming the uplink.
  if [ "$SHORT" -eq "$ACTIVE" ] && [ "$ACTIVE" -gt 1 ]; then VERDICT=uplink-saturated
  elif [ "$SHORT" -eq "$ACTIVE" ]; then VERDICT=single-site-limit-unattributed
  elif [ "$SHORT" -gt 0 ]; then VERDICT=one-site-limited
  fi

  printf '%s,%s,%s,%s,%s,%s,%.4f,%.1f,%s\n' \
    "$N" "$((N * NSITES))" "$B" "$C" "$RB" "$RC" "${CPU:-0}" \
    "$(echo "${TX:-0}" | awk '{print $1/1024}')" "$VERDICT" | tee -a "$OUT"

  if [ "$VERDICT" = "uplink-saturated" ] || [ "$VERDICT" = "single-site-limit-unattributed" ]; then
    echo "===> ceiling found at $((N * NSITES)) concurrent listeners — stopping"
    break
  fi
done

k -n azuracast-loadtest scale deploy/listener-sim-site-b deploy/listener-sim-site-c --replicas=0 >/dev/null
echo "===> done (generators scaled to 0)"
column -s, -t "$OUT"
