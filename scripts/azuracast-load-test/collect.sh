#!/usr/bin/env bash
# Capture one measurement row for the current listener count.
#
#   ./collect.sh <N>            # N = intended listener count, for the label only
#
# Assumes Prometheus is reachable at $PROM (port-forward it first — see README).
# Everything is read over a 3-minute rate window, so let the step settle before
# calling this.
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

# Ground truth for how many listeners actually connected. Never trust the
# intended number: a shortfall means clients died or a cap refused them, and a
# row measured against the wrong denominator is worse than no row.
#
# Asks Icecast, not AzuraCast. /api/nowplaying is a periodically-rebuilt cache
# and it disagrees — with one client connected it reported 2 while Icecast
# reported 1, because the AzuraCast figure lags and carries peak alongside
# current. status-json.xsl is the socket count, live.
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
