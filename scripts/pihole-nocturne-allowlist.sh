#!/usr/bin/env bash
# Steps 10 + 11: allowlist the domains Nocturne / Spotify / NTP need on Pi-hole,
# verify they resolve through it, then point Pi C's resolver at Pi-hole.
#
# Prompts for the Pi-hole admin password. It is never echoed, written to disk,
# or passed as an argv (which would show in `ps`).
#
#   ./pihole-nocturne-allowlist.sh              # allowlist + verify + switch DNS
#   ./pihole-nocturne-allowlist.sh --no-switch  # allowlist + verify only
#   ./pihole-nocturne-allowlist.sh --revert-dns # put Pi C back on the ISP resolver
#   PIHOLE=10.0.0.87 ./pihole-nocturne-allowlist.sh
set -uo pipefail

PIHOLE="${PIHOLE:-10.0.0.3}"
PIC="${PIC:-10.0.0.15}"
FALLBACK_DNS="${FALLBACK_DNS:-<isp-dns-1>}"
MODE="${1:-}"

pic() { ssh -o BatchMode=yes -o ConnectTimeout=8 "root@${PIC}" "$@"; }

# ---------------------------------------------------------------- revert path
if [ "$MODE" = "--revert-dns" ]; then
  echo "reverting Pi C to DHCP-provided DNS..."
  pic "sed -i 's/^RESOLV_CONF=\"no\"/#RESOLV_CONF=\"no\"/' /etc/udhcpc/udhcpc.conf; \
       printf 'search <your-search-domain>\nnameserver <isp-dns-1>\nnameserver <isp-dns-2>\n' > /etc/resolv.conf"
  echo "done. Pi C resolv.conf:"; pic 'cat /etc/resolv.conf'
  exit 0
fi

# ------------------------------------------------------------------- allowlist
# If you are already logged into the Pi-hole UI, you can hand over that live
# session instead of the password:
#     PIHOLE_SID='<sid>' ~/pihole-nocturne-allowlist.sh
# Find it in Chromium: F12 -> Network -> click any /api/ request -> Request
# Headers -> the "sid:" value. (Or Application -> Session Storage.)
if [ -n "${PIHOLE_SID:-}" ]; then
  SID="$PIHOLE_SID"
  probe=$(curl -s -m 10 -o /dev/null -w '%{http_code}' \
            "http://${PIHOLE}/api/info/version" -H "sid: ${SID}")
  if [ "$probe" != "200" ]; then
    echo "that sid is not valid for ${PIHOLE} (HTTP ${probe}) - it may have expired." >&2
    echo "Reload the Pi-hole UI and copy a fresh one." >&2
    exit 1
  fi
  echo "using your existing Pi-hole session."
else

read -rsp "Pi-hole admin password for ${PIHOLE}: " PW
echo

# Build the JSON with a real encoder. printf breaks on passwords containing
# a double quote or backslash, which looks identical to a wrong password.
# Password goes over stdin, never argv, so it stays out of `ps`.
AUTH=$(printf '%s' "$PW" | python3 -c '
import json,sys,urllib.request,urllib.error
pw=sys.stdin.read()
host=sys.argv[1]
body=json.dumps({"password":pw}).encode()
req=urllib.request.Request(f"http://{host}/api/auth",data=body,
                           headers={"Content-Type":"application/json"})
try:
    print(urllib.request.urlopen(req,timeout=10).read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
except Exception as e:
    print(json.dumps({"error":{"message":str(e)}}))
' "$PIHOLE")
unset PW

SID=$(printf '%s' "$AUTH" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
s=d.get("session") or {}
print(s.get("sid") or "")
')

if [ -z "$SID" ]; then
  echo >&2
  echo "auth failed. Pi-hole said:" >&2
  printf '%s\n' "$AUTH" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print("  (unparseable response)"); sys.exit()
s=d.get("session") or {}
if "error" in d: print("  error:",d["error"].get("message"))
if s:
    print("  message:",s.get("message"))
    print("  totp (2FA) required:",s.get("totp"))
' >&2
  cat >&2 <<'HINT'

Things to check, in order:
  * Is this the WEB INTERFACE password for 10.0.0.3? Try the other Pi-hole:
        PIHOLE=10.0.0.87 ~/pihole-nocturne-allowlist.sh
  * If "totp (2FA) required" is true, create an app password instead:
        Pi-hole UI -> Settings -> Web interface / API -> Configure app password
    then use that here.
  * Pi-hole rate-limits after repeated failures; wait a minute between tries.
  * If you have shell access to the Pi-hole box, this shows/sets the password:
        sudo pihole setpassword
HINT
  exit 1
fi
echo "authenticated to ${PIHOLE}."
fi
cleanup() { curl -s -m 5 -X POST "http://${PIHOLE}/api/auth/logout" -H "sid: ${SID}" >/dev/null 2>&1; }
trap cleanup EXIT

add() { # add <exact|regex> <domain>
  # JSON must be built by an encoder, not string-pasted: regex entries contain
  # backslashes (\. etc) which are invalid JSON escapes if emitted literally,
  # and Pi-hole answers the malformed body with a bare HTTP 400.
  python3 - "$PIHOLE" "$SID" "$1" "$2" <<'PY'
import json,sys,urllib.request,urllib.error
host,sid,kind,domain=sys.argv[1:5]
body=json.dumps({"domain":domain,"comment":"Nocturne Connector / Car Thing",
                 "groups":[0],"enabled":True}).encode()
req=urllib.request.Request(f"http://{host}/api/domains/allow/{kind}",data=body,
        headers={"Content-Type":"application/json","sid":sid},method="POST")
label=f"  {domain:<44}"
try:
    r=urllib.request.urlopen(req,timeout=10)
    d=json.loads(r.read().decode() or "{}")
    items=d.get("domains") or []
    # Pi-hole echoes the stored row back; treat a match as authoritative.
    print(f"{label}ok" if items else f"{label}ok (no echo)")
except urllib.error.HTTPError as e:
    raw=e.read().decode()
    try: msg=json.loads(raw)["error"]["message"]
    except Exception: msg=raw[:120].replace("\n"," ")
    if "UNIQUE" in msg.upper() or "exist" in msg.lower():
        print(f"{label}already present")
    else:
        print(f"{label}FAILED (HTTP {e.code}) {msg}")
except Exception as e:
    print(f"{label}FAILED ({e})")
PY
}

echo "exact allows:"
for d in pool.ntp.org api.spotify.com accounts.spotify.com \
         spclient.wg.spotify.com usenocturne.com github.com \
         objects.githubusercontent.com; do
  add exact "$d"
done

echo "wildcard allows (regex):"
add regex '(\.|^)pool\.ntp\.org$'
add regex '(\.|^)scdn\.co$'
add regex '(\.|^)supabase\.co$'

# --------------------------------------------------------------------- verify
echo
echo "resolving each domain through ${PIHOLE} (0.0.0.0 / empty = still blocked):"
FAIL=0
for d in pool.ntp.org 0.pool.ntp.org api.spotify.com accounts.spotify.com \
         spclient.wg.spotify.com i.scdn.co usenocturne.com github.com \
         objects.githubusercontent.com; do
  ip=$(python3 - "$PIHOLE" "$d" <<'PY'
import socket,struct,sys
srv,name=sys.argv[1],sys.argv[2]
pkt=b'\xab\xcd\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00'+b''.join(
    bytes([len(p)])+p.encode() for p in name.split('.'))+b'\x00\x00\x01\x00\x01'
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(4)
try:
    s.sendto(pkt,(srv,53)); d,_=s.recvfrom(2048)
except Exception: print(""); raise SystemExit
an=struct.unpack('!H',d[6:8])[0]
if not an: print(""); raise SystemExit
i=12
while d[i]: i+=d[i]+1
i+=5
for _ in range(an):
    i+=2; typ=struct.unpack('!H',d[i:i+2])[0]; i+=8
    dl=struct.unpack('!H',d[i:i+2])[0]; i+=2
    if typ==1: print(socket.inet_ntoa(d[i:i+4])); raise SystemExit
    i+=dl
print("")
PY
)
  if [ -z "$ip" ] || [ "$ip" = "0.0.0.0" ]; then
    printf '  %-32s BLOCKED\n' "$d"; FAIL=1
  else
    printf '  %-32s %s\n' "$d" "$ip"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo; echo "Some domains are still blocked. NOT switching Pi C's DNS." >&2
  echo "Fix those in the Pi-hole UI first, then re-run." >&2
  exit 1
fi
echo "all required domains resolve through Pi-hole."

[ "$MODE" = "--no-switch" ] && { echo "--no-switch given; leaving Pi C on the ISP resolver."; exit 0; }

# ------------------------------------------------------------ switch Pi C DNS
echo
echo "pointing Pi C at ${PIHOLE} (fallback ${FALLBACK_DNS})..."
# udhcpc rewrites resolv.conf on every lease renewal; RESOLV_CONF="no" stops it.
pic "sed -i 's/^#\\?RESOLV_CONF=\"no\"/RESOLV_CONF=\"no\"/' /etc/udhcpc/udhcpc.conf; \
     printf 'nameserver %s\nnameserver %s\n' '${PIHOLE}' '${FALLBACK_DNS}' > /etc/resolv.conf" || {
  echo "failed to update Pi C" >&2; exit 1; }

echo "Pi C resolv.conf now:"; pic 'cat /etc/resolv.conf' | sed 's/^/  /'

echo
echo "post-switch checks:"
pic 'wget -q -T 8 -O /dev/null https://github.com' \
  && echo "  DNS + internet          ok" || echo "  DNS + internet          FAILED"
pic 'chronyc tracking 2>/dev/null | head -2' | sed 's/^/  /'
printf '  connector               '; curl -s -m 8 "http://${PIC}/api/info" || echo FAILED
echo
echo "Done. Revert DNS with:  $0 --revert-dns"
