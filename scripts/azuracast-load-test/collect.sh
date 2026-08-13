#!/usr/bin/env bash
# Capture one measurement row for the current listener count.
#
#   ./collect.sh <N>            # N = intended listener count, for the label only
#
# Needs Prometheus reachable at $PROM (port-forward it first — see README) and
# reads over a 3-minute rate window, so let the step settle first.
set -euo pipefail

N="${1:?usage: collect.sh <listener-count>}"
PROM="${PROM:-http://localhost:9090}"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-/workspaces/homelabv1/bootstraping/kubeconfig}"
STATION="${STATION:-sysadmin}"
KUBECTL="$(command -v kubectl)"

k() { sudo env KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL" "$@"; }

q() {
  curl -sG "$PROM/api/v1/query" --data-urlencode "query=$1" \
    | sed -E 's/.*"value":\[[0-9.]+,"([^"]*)".*/\1/'
}

CPU=$(q 'sum(rate(container_cpu_usage_seconds_total{namespace="azuracast",container="azuracast"}[3m]))')
MEM=$(q 'sum(container_memory_working_set_bytes{namespace="azuracast",container="azuracast"})')
TX=$(q  'sum(rate(container_network_transmit_bytes_total{namespace="azuracast"}[3m]))')
RX=$(q  'sum(rate(container_network_receive_bytes_total{namespace="azuracast"}[3m]))')

# Ground truth listener count. Ask Icecast, never /api/nowplaying: that is a
# rebuilt cache carrying peak alongside current and it reports a higher number.
POD="$(k -n azuracast get pod -l app=azuracast -o jsonpath='{.items[0].metadata.name}')"
ACTUAL=$(k -n azuracast exec "$POD" -- sh -c \
  "curl -s http://localhost:8000/status-json.xsl | tr ',' '\n' | grep -m1 '\"listeners\"'" \
  | sed -E 's/[^0-9]*([0-9]+).*/\1/')

printf '%s,%s,%.4f,%.1f,%.1f,%.1f\n' \
  "$N" "${ACTUAL:-0}" "$CPU" \
  "$(echo "$MEM" | awk '{print $1/1048576}')" \
  "$(echo "$TX"  | awk '{print $1/1024}')" \
  "$(echo "$RX"  | awk '{print $1/1024}')"
# columns: intended,actual_listeners,cpu_cores,mem_MiB,tx_KiB_s,rx_KiB_s
