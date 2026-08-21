#!/usr/bin/env bash
# Checkpoint the kernel ring buffer and the device-name mapping while the soak
# runs, and alarm only on events newer than the run start. See README.md.
#
#   SINCE=2026-08-17T20:30 ./watch-dmesg.sh [interval_seconds] [node_suffix ...]
#
# SINCE is mandatory and must be an ISO prefix: dmesg keeps the whole boot's
# history, so without it every past reset re-alarms on every pass, forever.
#
# Non-optional for a 72h run: a reset storm wraps the ring buffer, and that is
# exactly the run whose evidence matters.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export TALOSCONFIG="${TALOSCONFIG:-/workspaces/homelabv1/bootstraping/clusterconfig/talosconfig}"
RESULTS="$HERE/results"
mkdir -p "$RESULTS"

SINCE="${SINCE:?set SINCE to the run start, e.g. SINCE=2026-08-17T20:30}"
INTERVAL="${1:-3600}"
shift || true
NODES="${*:-101 102}"

# Deliberately specific. A bare "reset" also matches "Power-on or device reset
# occurred", which every iSCSI Longhorn volume logs on attach — 40+ false alarms
# per pass on a healthy cluster.
BAD='uas_eh_abort_handler|uas_eh_device_reset_handler|reset (Super|high)Speed USB device|I/O error, dev sd|command timeout|Synchronize Cache.*failed|XFS.*(error|shutdown|corruption)'

while :; do
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  for N in $NODES; do
    IP="192.168.1.$N"
    OUT="$RESULTS/dmesg-$N-$TS.log"
    talosctl -n "$IP" dmesg > "$OUT" 2>&1 || { echo "[$TS] $IP UNREACHABLE"; continue; }
    talosctl -n "$IP" read /proc/mounts 2>/dev/null | grep /var/mnt > "$RESULTS/mounts-$N-$TS.log" || true
    talosctl -n "$IP" get disks 2>/dev/null > "$RESULTS/disks-$N-$TS.log" || true

    NEW="$(awk -v since="$SINCE" -v bad="$BAD" '
      match($0, /\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?\]/) {
        t = substr($0, RSTART + 1, RLENGTH - 2)
        if (t >= since && $0 ~ bad) print
      }' "$OUT")"
    if [ -n "$NEW" ]; then
      echo "[$TS] $IP ==> NEW KERNEL EVENT since $SINCE"
      echo "$NEW" | tail -5
    fi

    # A mounted device that no longer appears in `get disks` means the bridge
    # re-enumerated: the mount is stale and every I/O to it returns EIO.
    while read -r dev _; do
      base="$(basename "$dev")"; base="${base%%[0-9]*}"
      grep -q "Disk[[:space:]]*${base}[[:space:]]" "$RESULTS/disks-$N-$TS.log" \
        || echo "[$TS] $IP ==> STALE MOUNT: $dev is mounted but $base is gone"
    done < <(awk '{print $1, $2}' "$RESULTS/mounts-$N-$TS.log" 2>/dev/null || true)
  done
  echo "[$TS] checkpoint done, sleeping ${INTERVAL}s"
  sleep "$INTERVAL"
done
