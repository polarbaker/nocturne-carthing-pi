#!/usr/bin/env bash
# Install (or re-install) the weather overlay onto the Car Thing.
#
# RE-RUN THIS AFTER ANY NOCTURNE UPDATE. Three mechanisms replace
# /opt/nocturne/webapps/ui wholesale - a UI OTA, a bandaid OTA, and
# nocturne-floor-sync on the first boot after a full OS update. None of them
# merge, so the overlay is silently deleted and the weather just stops
# appearing. Nothing errors. This script is the fix.
#
#   ./install.sh            install / re-install
#   ./install.sh --remove   revert the device to stock
set -euo pipefail

PI=${PI:-10.0.0.15}          # Pi C, on the LAN
CT=${CT:-10.42.1.90}         # Car Thing, over the USB link from Pi C
UI=/opt/nocturne/webapps/ui
HERE="$(cd "$(dirname "$0")" && pwd)"
MARK='<!-- nocturne-weather -->'

pi()  { ssh -o BatchMode=yes -o ConnectTimeout=8 "root@$PI" "$@"; }
ct()  { pi "ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=8 root@$CT '$*'"; }

echo "== preflight =="
# The Car Thing is only reachable over the USB link, and usb0 loses its lease
# whenever the Bluetooth link is healthy (connector-relink only brings it up when
# the link is down). So ensure it here rather than assuming.
pi "ip link set usb0 up 2>/dev/null; ip -4 addr show usb0 | grep -q inet || udhcpc -i usb0 -n -q -t4 -T2 >/dev/null 2>&1" || true
if ! ct "true" 2>/dev/null; then
  echo "FAIL: cannot reach the Car Thing at $CT." >&2
  echo "      Plug in the USB DATA cable (a charge-only cable enumerates nothing)." >&2
  exit 1
fi
echo "  Car Thing reachable"

if [ "${1:-}" = "--remove" ]; then
  echo "== removing =="
  ct "rm -f $UI/weather-overlay.js"
  # Restore the pristine index.html if we have it, else strip our line.
  ct "if [ -f $UI/index.html.stock ]; then cp $UI/index.html.stock $UI/index.html; else sed -i '/nocturne-weather/d' $UI/index.html; fi"
  ct "systemctl restart chromium-kiosk"
  echo "  removed; device is back to stock"
  exit 0
fi

echo "== installing =="
# Keep one pristine copy, taken before we ever touch it. Never overwrite it,
# or a re-run after a partial install would enshrine a patched file as "stock".
ct "[ -f $UI/index.html.stock ] || cp $UI/index.html $UI/index.html.stock"

scp -q -o BatchMode=yes "$HERE/weather-overlay.js" "root@$PI:/tmp/weather-overlay.js"
pi "scp -o StrictHostKeyChecking=no -o BatchMode=yes /tmp/weather-overlay.js root@$CT:$UI/weather-overlay.js" >/dev/null
echo "  overlay copied"

# Idempotent patch: always rebuild from the stock copy so repeated runs cannot
# stack duplicate script tags. Cache-bust with a timestamp because the static
# server sends no Cache-Control and Chromium will happily serve a stale file.
V=$(date +%s)
# Patch locally rather than with a remote sed: the command has to survive two
# levels of shell quoting to reach the Car Thing, and embedded quotes in a sed
# expression do not make it intact.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pi "scp -o StrictHostKeyChecking=no -o BatchMode=yes root@$CT:$UI/index.html.stock /tmp/index.stock" >/dev/null
scp -q -o BatchMode=yes "root@$PI:/tmp/index.stock" "$TMP/index.stock"
python3 - "$TMP/index.stock" "$TMP/index.html" "$V" <<'EOF'
import sys
src, dst, v = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(src).read()
tag = '  <script src="/weather-overlay.js?v=%s"></script>\n  <!-- nocturne-weather -->\n</body>' % v
assert '</body>' in html, 'no </body> in index.html'
open(dst, 'w').write(html.replace('</body>', tag, 1))
EOF
scp -q -o BatchMode=yes "$TMP/index.html" "root@$PI:/tmp/index.new"
pi "scp -o StrictHostKeyChecking=no -o BatchMode=yes /tmp/index.new root@$CT:$UI/index.html" >/dev/null

if ! ct "grep -q weather-overlay $UI/index.html"; then
  echo "FAIL: index.html patch did not apply" >&2; exit 1
fi
echo "  index.html patched (v=$V)"

ct "systemctl restart chromium-kiosk"
echo "  kiosk restarted"
echo
echo "Done. Press the lock button on the Car Thing to see it."
