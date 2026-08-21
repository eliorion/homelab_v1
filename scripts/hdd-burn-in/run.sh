#!/usr/bin/env bash
# Drive one fio phase against one raw block device on one node. See README.md.
#
#   ./run.sh <phase> <node> <dev> [size]
#
#   phase  sync | fsync | seq | soak | pull
#   node   1 | 2 | 3
#   dev    kernel device name, e.g. sdl — verify against `talosctl get disks`
#   size   seq only, fio --size, e.g. 300G
#
# Every phase except `pull` WRITES TO THE RAW DEVICE from LBA 0 and destroys
# whatever is on it. Results land on the node's own /var/log/hdd-burnin, never on
# the disk under test, so the log writes cannot perturb the measurement.
#
# NOFOLLOW=1 returns as soon as the Job is applied — required for `soak`, and for
# running both bays of one dock concurrently.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export KUBECONFIG="${KUBECONFIG:-/workspaces/homelabv1/bootstraping/kubeconfig}"
export TALOSCONFIG="${TALOSCONFIG:-/workspaces/homelabv1/bootstraping/clusterconfig/talosconfig}"
RESULTS="$HERE/results"
OUTDIR=/var/log/hdd-burnin

PHASE="${1:-}"
NODE="${2:-}"
export DEV="${3:-}"
SIZE="${4:-300G}"

[ -n "$PHASE" ] && [ -n "$NODE" ] && [ -n "$DEV" ] || { sed -n '2,17p' "$0"; exit 2; }

export NODE_HOSTNAME="staging-controlplane-${NODE}"
NODE_IP="192.168.1.10${NODE}"
export JOB_NAME="fio-${PHASE}-n${NODE}-${DEV}"
TAG="n${NODE}-${DEV}"

if [ "$PHASE" = pull ]; then
  mkdir -p "$RESULTS"
  for f in $(talosctl -n "$NODE_IP" list "$OUTDIR" 2>/dev/null | awk 'NR>1 {print $NF}' | grep -E "^${TAG}-.*\.(json|log)$"); do
    talosctl -n "$NODE_IP" read "$OUTDIR/$f" > "$RESULTS/$f"
    echo "pulled $RESULTS/$f ($(wc -c <"$RESULTS/$f") bytes)"
  done
  exit 0
fi

# Refuse to touch a device that is not the USB disk the caller thinks it is.
TRANSPORT="$(talosctl -n "$NODE_IP" get disks "$DEV" -o json 2>/dev/null | jq -r '.spec.transport')"
[ "$TRANSPORT" = usb ] || { echo "REFUSING: $NODE_IP $DEV has transport '$TRANSPORT', expected 'usb'"; exit 1; }

case "$PHASE" in
  sync)
    export DEADLINE=900
    export FIO_ARGS="fio --name=sync --filename=/dev/target --rw=write --bs=4k --direct=1 --sync=1 --iodepth=1 --numjobs=1 --ioengine=psync --runtime=300 --time_based --size=1G --write_lat_log=/out/$TAG-sync --log_avg_msec=1000 --output-format=json | tee /out/$TAG-sync.json"
    ;;
  fsync)
    export DEADLINE=600
    export FIO_ARGS="fio --name=fsync --filename=/dev/target --rw=write --bs=4k --direct=0 --fdatasync=1 --iodepth=1 --numjobs=1 --ioengine=psync --runtime=60 --time_based --size=1G --output-format=json | tee /out/$TAG-fsync.json"
    ;;
  seq)
    export DEADLINE=43200
    export FIO_ARGS="fio --name=seq --filename=/dev/target --rw=write --bs=1M --direct=1 --size=${SIZE} --ioengine=libaio --iodepth=4 --write_bw_log=/out/$TAG-seq --log_avg_msec=1000 --output-format=json | tee /out/$TAG-seq.json"
    ;;
  soak)
    export DEADLINE=262800
    export FIO_ARGS="fio --name=soak --filename=/dev/target --size=100G --rw=randrw --rwmixread=70 --bs=64k --direct=1 --iodepth=8 --numjobs=2 --ioengine=libaio --runtime=259200 --time_based --ramp_time=60 --group_reporting --write_bw_log=/out/$TAG-soak --write_lat_log=/out/$TAG-soak --log_avg_msec=10000 --output-format=json | tee /out/$TAG-soak.json"
    ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac

kubectl apply -f "$HERE/namespace.yaml"
kubectl -n hdd-burnin delete job "$JOB_NAME" --ignore-not-found --wait=true
# shellcheck disable=SC2016  # envsubst's allowlist must stay literal
envsubst '$JOB_NAME $NODE_HOSTNAME $DEV $FIO_ARGS $DEADLINE' \
  < "$HERE/fio-job.yaml" | kubectl apply -f -

echo "===> $JOB_NAME on $NODE_HOSTNAME:/dev/$DEV"
[ "${NOFOLLOW:-0}" = "1" ] && { echo "    NOFOLLOW=1 — follow with: kubectl -n hdd-burnin logs -f job/$JOB_NAME"; exit 0; }

kubectl -n hdd-burnin wait --for=condition=Ready pod -l job-name="$JOB_NAME" --timeout=180s
kubectl -n hdd-burnin logs -f "job/$JOB_NAME"
