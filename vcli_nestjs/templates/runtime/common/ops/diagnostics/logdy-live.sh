#!/bin/sh
set -eu
# Run only after installing/reviewing Logdy v0.17.1 separately.
# This documented socket mode is a live FIFO, not a retained evidence database.
# Selected native profile keeps feed and UI private. Compose is a separate root-owned topology.
exec logdy socket 58233 --ip=127.0.0.1 --ui-ip=127.0.0.1 --port=58080 --no-updates --no-analytics --max-message-count=1000
