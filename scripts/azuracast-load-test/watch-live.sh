#!/usr/bin/env bash
# Sample a live broadcast: how many people are listening, and what it costs the
# master. Drives no load; writes a time series to $OUT and prints the peak row.
#
#   RELAY=https://radio.example.com ./watch-live.sh [minutes]
set -euo pipefail

RELAY="${RELAY:?set RELAY — the public base URL of the relay, e.g. https://radio.example.com}"
MINUTES="${1:-60}"
EVERY="${EVERY:-10}"
OUT="${OUT:-$(dirname "$0")/live.csv}"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-/workspaces/homelabv1/bootstraping/kubeconfig}"
KUBECTL="$(command -v kubectl)"

k() { sudo env KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL" "$@"; }

k -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090 >/dev/null 2>&1 &
trap 'kill %1 2>/dev/null || true' EXIT
sleep 5

q() {
  curl -sG "http://localhost:9090/api/v1/query" --data-urlencode "query=$1" \
    | sed -E 's/.*"value":\[[0-9.]+,"([^"]*)".*/\1/'
}

[ -f "$OUT" ] || echo "iso_time,relay_listeners,master_cpu_cores,master_mem_MiB,master_tx_KiB_s" > "$OUT"

END=$(( $(date +%s) + MINUTES * 60 ))
echo "watching $RELAY for ${MINUTES}m, sampling every ${EVERY}s -> $OUT"

while [ "$(date +%s)" -lt "$END" ]; do
  # Count from the relay, never the master: the master's only listener is the
  # relay itself, so it reports 1 whatever the real audience is.
  LISTENERS=$(curl -fsS --max-time 5 "$RELAY/status-json.xsl" 2>/dev/null \
    | tr ',' '\n' | grep -m1 '"listeners"' | sed -E 's/[^0-9]*([0-9]+).*/\1/' || echo "")

  CPU=$(q 'sum(rate(container_cpu_usage_seconds_total{namespace="azuracast",container="azuracast"}[3m]))')
  MEM=$(q 'sum(container_memory_working_set_bytes{namespace="azuracast",container="azuracast"})')
  TX=$(q  'sum(rate(container_network_transmit_bytes_total{namespace="azuracast"}[3m]))')

  printf '%s,%s,%.4f,%.1f,%.1f\n' \
    "$(date -Is)" "${LISTENERS:-NA}" "${CPU:-0}" \
    "$(echo "${MEM:-0}" | awk '{print $1/1048576}')" \
    "$(echo "${TX:-0}"  | awk '{print $1/1024}')" | tee -a "$OUT"

  sleep "$EVERY"
done

echo "--- peak ---"
awk -F, 'NR>1 && $2!="NA" && $2+0>m {m=$2; l=$0} END{print l}' "$OUT"
