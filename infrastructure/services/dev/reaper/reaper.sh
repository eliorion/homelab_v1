#!/bin/sh
# busybox ash has pipefail; without it a failed `kubectl get` reaps nothing and exits 0.
# shellcheck disable=SC3040
set -euo pipefail

TTL_SECONDS=${TTL_SECONDS:-86400}
LEASE_SECONDS=${LEASE_SECONDS:-7200}
MAX_PREVIEWS=${MAX_PREVIEWS:-3}
NOW=$(date -u +%s)
TAB=$(printf '\t')

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

reap() {
  if [ "$1" = preview-canary ]; then
    log "never reaping preview-canary"
    return 0
  fi
  log "delete $1: $2"
  kubectl delete namespace "$1" --wait=false || log "delete $1 failed"
}

# name, phase, deployed (epoch), deployed source, lease state. jq's fromdateiso8601 only
# parses YYYY-MM-DDTHH:MM:SSZ; anything else falls back to creationTimestamp.
kubectl get namespaces -o json | jq -r --argjson now "$NOW" --argjson lease "$LEASE_SECONDS" '
  def epoch: try fromdateiso8601 catch null;
  .items[]
  | select(.metadata.name | test("^preview-pr-[0-9]+$"))
  | (.metadata.annotations // {}) as $a
  | ($a["preview.eliorion.fr/last-deployed"] // "" | epoch) as $deployed
  | ($a["preview.eliorion.fr/phase-since"] // "" | epoch) as $since
  | [ .metadata.name,
      (.status.phase // "Active"),
      ($deployed // (.metadata.creationTimestamp | epoch)),
      (if $deployed then "last-deployed" else "creationTimestamp" end),
      (if $a["preview.eliorion.fr/phase"] == "testing" and $since != null and ($now - $since) < $lease
       then "leased" else "free" end)
    ]
  | @tsv' > /tmp/previews

: > /tmp/survivors
while IFS="$TAB" read -r name phase deployed source lease; do
  if [ "$phase" = Terminating ]; then
    log "skip $name: already Terminating (not counted)"
    continue
  fi
  age=$((NOW - deployed))
  if [ "$age" -le "$TTL_SECONDS" ]; then
    log "keep $name: ${age}s since $source, TTL ${TTL_SECONDS}s"
  elif [ "$lease" = leased ]; then
    log "keep $name: expired (${age}s since $source) but its testing lease is held"
  else
    reap "$name" "expired, ${age}s since $source > TTL ${TTL_SECONDS}s"
    continue
  fi
  printf '%s\t%s\t%s\n' "$deployed" "$name" "$lease" >> /tmp/survivors
done < /tmp/previews

count=$(wc -l < /tmp/survivors)
excess=$((count - MAX_PREVIEWS))
if [ "$excess" -le 0 ]; then
  log "done: $count preview(s), cap $MAX_PREVIEWS"
  exit 0
fi

log "$count previews exceed cap $MAX_PREVIEWS: reaping the $excess oldest by last deploy"
sort -n /tmp/survivors > /tmp/oldest-first
while IFS="$TAB" read -r deployed name lease; do
  [ "$excess" -gt 0 ] || break
  if [ "$lease" = leased ]; then
    log "keep $name: over cap but its testing lease is held"
    continue
  fi
  reap "$name" "over cap $MAX_PREVIEWS, oldest last deploy ($(date -u -d "@$deployed" +%Y-%m-%dT%H:%M:%SZ))"
  excess=$((excess - 1))
done < /tmp/oldest-first

[ "$excess" -le 0 ] || log "still $excess over cap: every remaining preview holds a testing lease"
