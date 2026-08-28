#!/bin/sh
# Run one CDP expression against the Car Thing's Chromium.
#
# CDP binds to 127.0.0.1 on the device, so it needs an SSH tunnel. Keeping the
# tunnel inside this script's own process tree matters: a backgrounded `ssh -fN`
# started from a remote shell dies when that shell exits, which fails silently
# and looks like CDP being unreachable.
#
# Usage: /root/cdp.sh '<js expression>'
set -u
EXPR="${1:?usage: cdp.sh <expression>}"

ssh -N -o StrictHostKeyChecking=no -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -L 9223:127.0.0.1:9223 root@10.42.1.90 &
TUNNEL=$!
trap 'kill "$TUNNEL" 2>/dev/null' EXIT INT TERM

# Wait for the forward to actually accept, rather than a blind sleep.
i=0
while [ $i -lt 20 ]; do
    wget -q -T1 -O /dev/null http://127.0.0.1:9223/json/version 2>/dev/null && break
    i=$((i+1)); sleep 0.5
done
[ $i -ge 20 ] && { echo "tunnel never came up" >&2; exit 1; }

bun /root/cdp-eval.js "$EXPR"
