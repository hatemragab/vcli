#!/bin/sh
set -eu
# Run only after installing/reviewing Logdy v0.17.1 separately.
# This documented socket mode is a live FIFO, not a retained evidence database.
: "${LOGDY_FEED_IP:?Set the private Docker host-gateway IP reachable by Vector; firewall port 58233 to this project network}"
exec logdy socket 58233 --ip="$LOGDY_FEED_IP" --ui-ip=127.0.0.1 --port=58080 --no-updates --no-analytics --max-message-count=1000
