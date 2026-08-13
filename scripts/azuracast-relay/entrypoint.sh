#!/bin/sh
# Container entrypoint: renders icecast.xml from the environment, then execs Icecast.
# Required env: MASTER_HOST, RELAY_PUBLIC_HOST, ADMIN_PASSWORD, SOURCE_PASSWORD,
# RELAY_PASSWORD. Optional: MASTER_PORT, MOUNT, MAX_CLIENTS. See README.md.
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

# Spend control, not a performance setting: each occupied slot costs ~65 GB/month.
: "${MAX_CLIENTS:=50}"

envsubst < /etc/icecast/icecast.xml.template > /tmp/icecast.xml

echo "relay: ${MASTER_HOST}:${MASTER_PORT}${MOUNT} -> public ${RELAY_PUBLIC_HOST}:8000${MOUNT}, cap ${MAX_CLIENTS}"
exec icecast -c /tmp/icecast.xml
