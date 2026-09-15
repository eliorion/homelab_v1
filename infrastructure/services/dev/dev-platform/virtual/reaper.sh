#!/bin/sh
# busybox ash has pipefail; without it a failed `kubectl get` reaps nothing and exits 0.
# shellcheck disable=SC3040
set -euo pipefail

MAX_AGE_SECONDS=${MAX_AGE_SECONDS:-4500}
NOW=$(date -u +%s)

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# A run creates its namespaces with label e2e.eliorion.fr/run and annotation
# e2e.eliorion.fr/started-at (epoch seconds) in the same request. A missing or unparsable
# annotation counts as expired.
namespaces=$(kubectl get namespaces -l e2e.eliorion.fr/run \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.metadata.annotations.e2e\.eliorion\.fr/started-at}{"\n"}{end}')

echo "$namespaces" | while read -r ns started; do
  [ -n "$ns" ] || continue
  case "$started" in
    '' | *[!0-9]*) started=0 ;;
  esac
  age=$((NOW - started))
  if [ "$age" -gt "$MAX_AGE_SECONDS" ]; then
    log "reap $ns (age ${age}s)"
    kubectl delete namespace "$ns" --wait=false
  fi
done
