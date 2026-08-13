#!/usr/bin/env bash
# Pull the listener-side test results out of Icecast's access log, as CSV.
#
#   ./collect-reports.sh [> reports.csv]      # run on the VPS, in this directory
#
# The test page reports by requesting /report?kbps=…, which 404s deliberately —
# the query-string keys below must match web/index.html. See README.md.
set -euo pipefail

echo "time,ip_prefix,kbps,stalls,maxgap_s,ttfb_s,mb,verdict"

docker compose logs --no-color --no-log-prefix relay 2>/dev/null \
  | grep -F "GET /report?" \
  | while read -r line; do
      # Icecast common-log: <ip> - - [<time>] "GET /report?<query> HTTP/1.1" 404 …
      ip=$(printf '%s' "$line" | awk '{print $1}')
      ts=$(printf '%s' "$line" | sed -E 's/.*\[([^]]*)\].*/\1/')
      q=$(printf '%s' "$line" | sed -E 's/.*GET \/report\?([^ ]*) .*/\1/')

      get() { printf '%s' "$q" | tr '&' '\n' | grep -m1 "^$1=" | cut -d= -f2- || true; }

      # Truncate to the first two octets.
      prefix=$(printf '%s' "$ip" | cut -d. -f1,2).x.x

      printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
        "$ts" "$prefix" "$(get kbps)" "$(get stalls)" "$(get maxgap)" \
        "$(get ttfb)" "$(get mb)" "$(get verdict)"
    done
