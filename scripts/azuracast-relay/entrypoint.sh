#!/bin/sh
# Render the config from the environment, then hand off to Icecast.
set -eu

# No apostrophes in these messages: inside ${var:?...} bash treats a single
# quote as opening a quoted section, and the script fails to parse.
: "${MASTER_HOST:?set MASTER_HOST — the tailnet name of the master, e.g. azuracast-stream.tailXXXX.ts.net}"
: "${MASTER_PORT:=8000}"
: "${MOUNT:=/radio.mp3}"
: "${RELAY_PUBLIC_HOST:?set RELAY_PUBLIC_HOST — the public hostname listeners will use}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"
: "${SOURCE_PASSWORD:?set SOURCE_PASSWORD}"
: "${RELAY_PASSWORD:?set RELAY_PASSWORD}"

# MAX_CLIENTS is the quota control, not a performance setting. At 0.202 Mbps per
# listener a continuously-occupied slot costs ~65 GB/month, so this number
# multiplied by 65 GB is the worst case this host can bill you. Size it against
# the plan's transfer allowance, not against what the CPU could handle.
: "${MAX_CLIENTS:=50}"

envsubst < /etc/icecast/icecast.xml.template > /tmp/icecast.xml

echo "relay: ${MASTER_HOST}:${MASTER_PORT}${MOUNT} -> public ${RELAY_PUBLIC_HOST}:8000${MOUNT}, cap ${MAX_CLIENTS}"
exec icecast -c /tmp/icecast.xml
