#!/usr/bin/env bash
# Give the station something to broadcast, using the image's own ffmpeg.
#
# Synthetic tones rather than real music: no licensing question, reproducible,
# and the measurement is unaffected — Liquidsoap re-encodes to the mount's fixed
# bitrate no matter what the source was.
#
# Idempotent. Safe to re-run; ffmpeg overwrites and the scan skips known files.
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG_PATH:-/workspaces/homelabv1/bootstraping/kubeconfig}"
STATION="${STATION:-sysadmin}"
KUBECTL="$(command -v kubectl)"

k() { sudo env KUBECONFIG="$KUBECONFIG_PATH" "$KUBECTL" "$@"; }

POD="$(k -n azuracast get pod -l app=azuracast -o jsonpath='{.items[0].metadata.name}')"
echo "pod: $POD"

echo "==> generating 5 x 5min tracks"
k -n azuracast exec "$POD" -- sh -c '
set -e
D=/var/azuracast/stations/'"$STATION"'/media
i=1
for F in 261 329 392 440 523; do
  ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=${F}:duration=300" \
    -b:a 192k -metadata title="Load Test Tone ${F}Hz" -metadata artist="Load Test ${i}" \
    "$D/loadtest-${i}.mp3"
  i=$((i+1))
done
chown azuracast:azuracast "$D"/loadtest-*.mp3
'

echo "==> importing into the media library"
k -n azuracast exec "$POD" -- azuracast_cli azuracast:sync:task check_media --force
sleep 10   # the scan dispatches per-file jobs to php-worker; let them drain

echo "==> assigning everything to the default playlist"
# The setup wizard already created playlist 1 ("default", enabled). There is no
# CLI for playlist membership, so this writes the same rows the UI would.
k -n azuracast exec "$POD" -- sh -c 'azuracast_db -e "
INSERT INTO station_playlist_media (playlist_id, media_id, weight, last_played, is_queued, folder_id)
SELECT 1, m.id, ROW_NUMBER() OVER (ORDER BY m.id), 0, 1, NULL
  FROM station_media m
 WHERE m.id NOT IN (SELECT media_id FROM station_playlist_media WHERE playlist_id = 1);"'

echo "==> starting the station"
# has_started is what the UI's Start Station button sets. Without it,
# writeConfiguration() throws "Station has not started yet." and no supervisord
# config is written, so azuracast:radio:restart fails with BAD_NAME: station_1.
k -n azuracast exec "$POD" -- sh -c \
  'azuracast_db -e "UPDATE station SET has_started=1, needs_restart=1 WHERE id=1;"'
k -n azuracast exec "$POD" -- azuracast_cli azuracast:radio:restart
sleep 20
k -n azuracast exec "$POD" -- azuracast_cli azuracast:sync:nowplaying:station 1 || true

echo "==> gate"
k -n azuracast exec "$POD" -- sh -c '
  echo "--- mount ---";      curl -sI --max-time 5 http://localhost:8000/radio.mp3 | head -2
  echo "--- processes ---";  supervisorctl status | grep station_1 || true
  echo "--- api ---";        curl -s http://localhost/api/nowplaying/'"$STATION"' \
                               | tr "," "\n" | grep -E "is_online|\"total\"" | head -3
'
