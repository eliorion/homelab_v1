#!/usr/bin/env bash
# Collapse an fio bandwidth log into per-bucket mean MB/s. See README.md.
#
#   ./plot-bw.sh results/<...>-seq_bw.1.log [bucket_minutes]
#
# fio bw logs are "time_ms, KiB/s, ddir, bs" — column 2 is KiB/s, not MB/s.
set -euo pipefail

LOG="${1:?usage: plot-bw.sh <fio bw log> [bucket_minutes]}"
BUCKET_MIN="${2:-5}"

awk -F'[, ]+' -v b="$((BUCKET_MIN * 60 * 1000))" -v bm="$BUCKET_MIN" '
  $2 != "" { i = int($1 / b); sum[i] += $2; n[i]++; if (i > max) max = i }
  END {
    printf "%8s  %10s  %s\n", "minute", "MB/s", "samples"
    for (i = 0; i <= max; i++)
      if (n[i]) printf "%8d  %10.1f  %d\n", i * bm, sum[i] / n[i] / 1024, n[i]
  }
' "$LOG"
