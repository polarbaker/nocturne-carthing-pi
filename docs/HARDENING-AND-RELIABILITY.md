# Nocturne Connector (Pi C) — security hardening

Date: 2026-08-27
Host: `nocturne-connector`, Alpine 3.24.1, **10.0.0.15**
Admin box: `admin-pi` / this Pi — 10.0.0.216, wlan0 MAC `AA:BB:CC:77:88:99`

## Credentials

**The Connector image ships with root password `nocturne`.** That is a published
default, so anything on your LAN can log in as root until you change it. Rotate
it first, before anything else:

    # generate one and store it in a password manager
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24

    # set it (from a machine that already has key access)
    echo "root:<new-password>" | ssh root@<PI_IP> chpasswd

Then install your key and turn password login off entirely, so the password
becomes break-glass only for a directly attached keyboard or serial console:

    ssh-copy-id -i ~/.ssh/id_ed25519.pub root@<PI_IP>
    # then the drop-in below, and: rc-service sshd reload

Order matters — install and *test* the key before disabling password auth, or a
typo locks you out of a headless box.

## What changed

| File | Host | Backup |
|---|---|---|
| `/etc/nftables.nft` | Pi C | `/etc/nftables.nft.bak-preclaude` |
| `/etc/ssh/sshd_config.d/99-hardening.conf` | Pi C | (new file — delete to revert) |
| `/root/.ssh/authorized_keys` | Pi C | (added admin key) |
| `/etc/nftables.conf` | admin box | `/etc/nftables.conf.bak-preclaude` |

1. **Root password rotated.** Shipped default `nocturne` no longer works.
2. **Admin SSH key installed**, then password auth turned off entirely.
3. **Pi C firewall** — input/forward policy is now `drop`. Allowed: loopback,
   established, the Car Thing on `usb0`, and the admin box (matched by both IP
   and MAC, so a DHCP lease change won't lock you out). Everything else on the
   LAN is dropped silently.
4. **Car Thing passthrough locked down.** The DNAT rules on ports 2022→22 and
   2222→9222 were open to the entire LAN. Port 9222 is the Car Thing's Chrome
   DevTools socket — full remote control of its browser, no auth. Now restricted
   to the admin box.
5. **NAT-inheritance hole closed on the admin box.** This Pi masquerades
   `10.9.9.0/24` (lab-host) and the NetworkManager hotspot range onto wlan0, so
   those hosts reached Pi C wearing 10.0.0.216 and inherited admin access.
   Verified before (HTTP 200 + port 22 open from lab-host) and after (blocked).
6. **Egress isolation ("standalone").** Pi C and the Car Thing may now reach the
   internet and exactly three LAN hosts — gateway `10.0.0.1`, Pi-hole
   `10.0.0.3`, admin box `10.0.0.216`. Every other LAN peer is dropped in both
   directions. Verified: github/api.spotify.com reachable, 10.0.0.87 and
   10.0.0.31 blocked, chrony still synced.

Both rulesets persist across reboot: Pi C via OpenRC `nftables` in the default
runlevel reading `/etc/nftables.nft` (`save_on_stop=no`, so it won't be
overwritten); admin box via `nftables.service` (enabled) reading
`/etc/nftables.conf`.

## Revert

    # Pi C
    ssh root@10.0.0.15 'nft -f /etc/nftables.nft.bak-preclaude'
    ssh root@10.0.0.15 'rm /etc/ssh/sshd_config.d/99-hardening.conf && rc-service sshd reload'
    # admin box
    sudo cp /etc/nftables.conf.bak-preclaude /etc/nftables.conf && sudo nft -f /etc/nftables.conf

## Still open

- ~~Car Thing~~ **RESOLVED 2026-08-27 14:28.** Cause was the USB link, exactly as
  `~/carthing/` warned. `lsusb` on Pi C showed `1d6b:0104 Vanta Labs Nocturne`
  behind a `2109:3431 USB2.0 Hub` — the Car Thing was plugged into Pi C. It was
  powered and enumerating but neither advertising Bluetooth (a scan found 47
  devices without it) nor answering ARP on 172.16.42.2. Moving it to its own
  power supply fixed it immediately: the gadget and `usb0` disappeared, and it
  re-paired and reconnected **on its own** with no pair/connect call needed.
  Only `trust` was set, so it auto-reconnects on future boots.

  **Correction to an earlier reading in this file:** the absence of `info` files
  under `/var/lib/bluetooth/<adapter>/` was *not* evidence the bond had been
  deleted. There are still zero `info` files now, with the link up and working —
  zero bond files is simply the normal state for this setup. The adapter
  directory mtime tracks `cache/` writes, not pairing changes, so it is not a
  reliable timestamp for "when the pairing went away." The USB conflict was the
  whole story.

## Robustness work (2026-08-27, after the repeated dropouts)

**Pi C is required. It cannot be shut off.** Its only Car Thing transport is
`services/bluetooth-service.ts` (RFCOMM) — there is no USB data path; the
`usb0`/172.16.42.x network exists solely for adb (2022→22) and DevTools
(2222→9222). Pi C holds the Spotify OAuth token and the dealer WebSocket, and
answers the Car Thing's `RPC call: spotify.player.state` every 15s. No Pi C, no
Spotify data, error screen.

**Never plug the Car Thing into Pi C's USB.** That was the 2026-08-27 outage.

`/etc/bluetooth/main.conf` (backup: `main.conf.bak-preclaude`):

| Setting | Was | Now | Why |
|---|---|---|---|
| `PageTimeout` | 8192 (5.12s) | 16384 (10.2s) | Failures were at *exactly* 5.12s — the link was timing out, not being refused |
| `FastConnectable` | false | true | Far more aggressive page scanning, so reconnects land quickly |
| `AutoEnable` | unset | true | Adapter powers on at boot unconditionally |
| `ControllerMode` | dual | **dual (reverted)** | Tried `bredr`. It broke discovery outright — a scan returned **0 devices** where dual returns ~41. Most nearby devices are BLE advertisers, and classic devices are invisible unless actively in pairing mode. Do not set `bredr` here. |

Wi-Fi is on **5 GHz (ch 44, -40 dBm)**, so the usual Pi 4 problem where 2.4 GHz
Wi-Fi and Bluetooth share one antenna is *not* a factor here. Ruled out, don't
re-investigate.

**Watchdog:** `/usr/local/bin/connector-watchdog`, cron `*/5`, logs to
`/var/log/connector-watchdog.log`. Restarts `connector-api` if `/api/info` fails
twice, and restarts bluetooth if the adapter drops out of `Powered: yes`. It
deliberately does **not** check whether the Car Thing is linked — the Car Thing
is often legitimately away, and restarting for that would cause the very dropouts
this prevents. Disable by removing the line from `/etc/crontabs/root`
(backup: `root.bak-preclaude`).

**Still open:** Pi C is permanently discoverable *and* pairable
(`DiscoverableTimeout: 0`) — that is how a nearby iPhone got a pairing prompt.
Worth closing once the Car Thing link is stable.

**Thermal, not distance — the Car Thing was stacked on top of Pi C.** Pi C idled
at **79C with load average 0.00** (open-air Pi 4 idles 45-55C; soft throttle at
80C), despite having a heatsink. Nothing was generating the heat — 97% idle,
`schedutil`, cores at 600-1000 MHz — it simply could not escape. Unstacking took
it to **64C and still falling**.

The Pi 4's Wi-Fi/BT chip antenna is on that same board, so the stack plausibly
explains the `rssi:-100` at touching distance too (it should read -30 to -50 at
zero range). Note `-100` is also exactly the Connector's discovery filter floor
(`RSSI>=-100`), so treat it as "at or below the floor", not a precise reading.

**Keep them side by side with air around Pi C, never stacked.**

## Endpoint reference (the ones that actually exist)

`/api` mounts only `/api/info`. **There is no `/api/status`** — unknown paths
return **200 with a 0-byte body**, identical to a real route, so a typo'd health
check looks like a passing one. Verified: `/api/status` and `/api/totally-fake`
both give `200`/0 bytes; `/api/info` gives `200`/43 bytes.

    GET  /api/info                  {"version":"v2.1.1-1","osVersion":"3.24.1"}
    GET  /api/spotify/status        linked / polling / unlinked
    GET  /api/bluetooth/status      adapter powered + discovering
    GET  /api/bluetooth/devices     scan results
    GET  /api/bluetooth/connections active RFCOMM links
    GET  /api/analytics/status      {"enabled":false}   <- telemetry check
    POST /api/analytics/enabled     {"enabled":false}   <- telemetry set
- ~~Pi-hole allowlist + DNS switch~~ **DONE 2026-08-27.** Pi C now resolves via
  Pi-hole 10.0.0.3 (fallback <isp-dns-1>), pinned with `RESOLV_CONF="no"` so
  udhcpc cannot overwrite it on lease renewal. All 10 required entries are in
  the allowlist, and all 10 verified resolving with zero blocked. Control probe
  `ads.google.com` → `0.0.0.0` confirms filtering is live, so the allowlist is
  doing real work rather than sitting in front of a passthrough resolver.

  Method note, worth keeping: judge a block by **differencing Pi-hole against
  upstream**, never in isolation. Three separate false alarms came from ignoring
  this — `doubleclick.net` resolves through Pi-hole (looks like filtering is off;
  it isn't), and `api.supabase.co` / `audio-ak.scdn.co` are NXDOMAIN on Pi-hole
  *and* the ISP resolver (those names simply do not exist). Only `0.0.0.0`/NXDOMAIN from
  Pi-hole where upstream returns a real A record is a genuine block.

  Also: `UNIQUE constraint failed: domainlist.domain, domainlist.type` from the
  Pi-hole UI means **already present**, not an error — that is why
  `api.spotify.com`, `github.com`, and the supabase regex returned HTTP 400 from
  the API. Check the row's type reads Allow, since the constraint covers
  (domain, type) and a Deny row would collide identically.
- **Router port forwarding** not verified — check the admin UI at 10.0.0.1 for
  any rule pointing at 10.0.0.15. No UPnP IGD responds on the LAN, so nothing
  can self-map a port. Note that even a stray forward would fail: inbound WAN
  traffic arrives with the router's MAC and a non-LAN source, so Pi C drops it.

## Topology notes

- The router is an **ISP-supplied gateway** — no VLAN support. Its guest network
  isolates clients from the main LAN, which would cut off the admin box too, so
  it is not useful here.
- **`10.9.9.0/24` is not a private wire.** The admin Pi's `eth0` is on a switch
  carrying the house LAN (its neighbour table holds 10.0.0.x hosts with distinct
  MACs), so that subnet is just a second range on a shared segment. Plugging Pi C
  into that switch would *not* isolate it.
- Pi C is a **Pi 4 with an unused `eth0`**. A true air-gapped setup would be a
  dedicated cable or switch between Pi C and a second NIC on the admin box
  (a USB-Ethernet adapter, since `eth0` is taken). The egress rules above get
  most of that benefit for free.

## Reliability gaps found and fixed (2026-08-27)

**The core defect: nothing persists the Car Thing's address.** `/data` holds only
`setup-state.json`, `auth-session.json`, `analytics-enabled.json`. BlueZ writes no
bond file for this device either. So after any reboot or `bluetoothd` restart the
Connector has **no target and makes zero connection attempts** — it has not failed
to connect, it has forgotten who to connect to. Confirmed: last retry was 1421s
old and it had stopped entirely.

Fix: `/usr/local/bin/connector-relink`, cron `*/5`, log
`/var/log/connector-relink.log`. If there is no link *and* no retry in the last
120s, it rediscovers the Car Thing and reconnects. Rate limited to one attempt
per 15 min (scanning makes the adapter discoverable). Always stops discovery
afterwards. Verified end to end.

**Diagnostic that matters most — read the connect timings, not the signal:**

    failure: exactly 5.12s   -> page timeout, device did not answer at all
    success: 1.3s            -> device answered instantly

It is binary. A weak link gives slow, variable connects; this gives "absent" or
"instant". So RSSI/distance was a red herring — when the Car Thing is awake it
connects immediately regardless.

**Two bugs in my own first attempt, both worth remembering:**
1. The "is it already retrying?" guard used `tail -40 | grep -c` with **no age
   check**. A stale line from hours earlier caused a permanent false early exit.
2. Log stamps are UTC (`...T19:33:59.888Z`) but busybox `date -d` parses as
   **local**, putting every comparison 4 hours out. Parse with
   `date -u -D "%Y-%m-%dT%H:%M:%S"`.

**Also fixed:** manual scans were leaving `discovering: true` permanently, which
kept Pi C discoverable and pairable to the whole room. `stop-scan` works; it was
simply never called. The relink helper always calls it.

**`/api/bluetooth/*` has no sleep/wake/power control** — the RPC surface is
`device.time.get`, `device.info`, `spotify.*`, `ota.*`, `notification.show`.
The Connector cannot rouse a sleeping Car Thing. That side is physical.

## RESOLVED 2026-08-27 20:15Z — link up, system reliable

    connected : true          id : rfcomm-client:AA:BB:CC:11:22:33
    device    : Nocturne (QS1Q) v4.1.3+20260821174253  serial <DEVICE_SERIAL>
    rssi      : -71           <- healthy

**The `-100` RSSI was an artefact, not a measurement.** It is exactly the
Connector's discovery filter floor (`RSSI>=-100`). With the Car Thing unstacked
and on its own supply the real figure is **-71**, which is fine. Distance was
never the problem, and the whole "move them closer" line of reasoning was wrong.

**What actually fixed it:** the Car Thing had to be put into pairing mode from
its own UI. It was booted and rendering "Phone disconnected" but its radio was
idle by design — BlueZ had not seen it advertise since 14:56. A new cable and a
5V/2A brick made no difference, so the power theory was wrong too. Once it
advertised, `trust` + `connect` succeeded immediately.

### The endpoint trap that would have caused dropouts

**`/api/bluetooth/connections` returns `{"connections":[]}` even while the link
is up and carrying RPC.** It does not track the outbound `rfcomm-client`.
`/api/device/status` is authoritative — use it and match `"connected":true`.

`connector-relink` originally polled the wrong one, so it would have torn down
and rebuilt a perfectly healthy link every 15 minutes — manufacturing the exact
dropouts it exists to prevent. Fixed and verified: it now exits in 0s against a
live link without touching it.

### Final state

| | |
|---|---|
| Car Thing | connected, rssi -71, trusted (auto-reconnects) |
| Connector | v2.1.1-1, Spotify linked, telemetry off |
| Pi C temp | 66C (was 79C stacked) |
| DNS | via Pi-hole 10.0.0.3, pinned |
| Clock | synced |
| Discovery | off (no longer left on by scans) |
| Automations | `connector-watchdog` + `connector-relink`, both `*/5`, both verified |

## ROOT CAUSE FOUND 2026-08-27 — Car Thing page scan disabled

Everything before this was chasing symptoms. The actual fault:

**The Car Thing's Bluetooth adapter comes up `UP RUNNING` with page scan and
inquiry scan DISABLED.** It answers no pages and appears in no scans, so every
Connector attempt times out at *exactly* 5.12s forever. `hciconfig hci0 piscan`
restores both and the link connects in ~1.3s.

Its own BlueZ settings already say `Discoverable=true` / `DiscoverableTimeout=0`,
so something at runtime (almost certainly `nocturned`) turns the scans off.

### Things that were believed and are WRONG

* **"USB conflicts with Bluetooth."** It does not. Connected successfully with
  USB attached once page scan was enabled. The correlation was coincidental.
* **"RSSI -100 means it is too far away."** -100 is the Connector's discovery
  filter floor, not a reading. Real value side by side is -71.
* **"The cable is browning out the radio."** No. The first cable was bad, the
  second was **power-only** (powers the screen, no data lines - zero kernel
  events on plug-in, not even an error). Power was never the issue.

### Getting into the Car Thing

* It **serves DHCP**: it is `10.42.1.90/29`, Pi C gets `.91`. The shipped
  `/etc/network/interfaces` on Pi C had a static `172.16.42.1/24`, an address the
  Car Thing never answers on. Fixed to `allow-hotplug usb0` + `dhcp`, with
  `NO_GATEWAY="usb0"` in `/etc/udhcpc/udhcpc.conf` so its lease cannot steal the
  default route from wlan0.
* **Root SSH on the Car Thing takes no authentication at all.** `ssh root@10.42.1.90`
  just works. Only port 22 is open (nocturned binds 8080 to localhost).
* Its rootfs is **read-only**; `/var` and `/opt/nocturne` are writable. So the
  scan fix cannot be installed as a boot unit on that side - it has to come from
  Pi C over USB.
* Pi C's busybox ash has **no `/dev/tcp`**, so port probes there need `nc`.
  `/dev/tcp` silently reports every port closed.

### The fix, automated

`connector-relink` now, in order: exit if linked -> if the Car Thing is reachable
over USB, check `hciconfig` flags, run `piscan` if missing, connect -> else fall
back to the retry guard and an over-the-air scan.

The USB repair runs **before** the "is it already retrying?" guard, because those
retries can never succeed while page scan is off.

Verified end to end: with scans forced off and the link down, one run restored
`PSCAN ISCAN` and reached `connected:true`, logging `relink OK via USB path`.

**Keep the Car Thing plugged into Pi C with a DATA cable.** That is what makes
this self-healing; without USB, Pi C cannot repair the radio and the on-screen
pairing dance comes back.

## Reboot test 2026-08-27 — passed, after one more fix

Pi C rebooted from 22.5h uptime; SSH back in ~50s. Everything persisted:
firewall (4 drop chains), key-only SSH, Pi-hole DNS, clock, both cron jobs,
Connector, telemetry off, lab-host still blocked (HTTP 000).

**One gap the reboot exposed:** `allow-hotplug usb0` does **not** fire when the
Car Thing is already attached at boot. The interface gets created but left
`DOWN` with `qdisc noop`, so the whole USB repair path silently disappeared
exactly when it was needed — after a reboot. Depending on boot ordering was the
mistake.

Fixed in `connector-relink`: it now brings `usb0` up and runs `udhcpc` itself if
the gadget is enumerated but the interface has no address. Verified from the real
post-reboot state:

    usb0 down but gadget present - bringing it up
    Car Thing radio not connectable (flags: UP RUNNING) - enabling piscan
    relink OK via USB path

    -> usb0 10.42.1.91/29, flags UP RUNNING PSCAN ISCAN,
       connected:true deviceCount:1, default route still via wlan0

So a cold boot now self-heals end to end within one cron cycle (max 5 min):
bring up USB -> DHCP -> re-enable the Car Thing's page scan -> connect.

## Bluetooth exposure closed 2026-08-27

Pi C was permanently **discoverable and pairable** to anyone in RF range
(`DiscoverableTimeout: 0`), and its PairingAgent auto-authorises services. A
nearby iPhone (`DD:EE:FF:00:11:22`) hit that agent with PIN prompts earlier in
the day, so this was live, not theoretical.

**The Connector forces it open on every start** —
`services/bluetooth-service.ts:176-177` calls `setDiscoverable(true)` and
`setPairable(true)`, and `bluetooth/dbus-adapter.ts:189-208` sets both timeouts
to 0. Editing the vendor source would be reverted by the next OTA, and setting
`Discoverable=false` in `/var/lib/bluetooth/<adapter>/settings` does not hold:
verified it reverts to `yes` the moment bluetoothd and the Connector restart.

Handled in `connector-relink` instead: whenever the link is up it turns both off.
Neither is needed in normal operation, because the Connector dials **out** to the
Car Thing. Worst-case exposure is one cron interval (5 min) after a restart.

Verified end to end - broke the link, disabled the Car Thing's scans, restarted
both services:

    run 1 -> relink OK via USB path                    (link restored)
    run 2 -> Discoverable: no, Pairable: no, link up   (radio closed)

Recovery and hardening coexist; closing the radio does not block relink, which
recovers over USB rather than by being discovered.

**Also corrected:** the firewall still referenced the Car Thing at
`172.16.42.2`. It is `10.42.1.90` (`10.42.1.88/29`). `define CARTHING` and the
usb0 forward rule now match reality; before this the Car Thing had no route out
at all and the admin DNAT rules on 2022/2222 were dead.

**Note on `usb0`:** `udhcpc -q` is one-shot with no renewal daemon, so the lease
lapses and the interface goes addressless while the Bluetooth link is up. That is
harmless — relink brings it back on demand, since the USB path is only needed
when the link is *down*. Verified recovering from exactly that state.

## Pi-hole allowlist scope

The allowlist is network-wide. `(\.|^)supabase\.co$` covers every Supabase-hosted
app, not just Nocturne's backend, so it slightly widens what all your devices can
reach. Steps to scope the ten entries to Pi C alone via a Pi-hole group are in
`~/pihole-scope-nocturne-to-group.md`. The trap there: Pi C must be in **both**
`Default` and the new group, or it stops being filtered entirely.

## Unattended self-heal verified 2026-08-27 (second reboot test)

Worst case constructed deliberately: Car Thing page scan disabled, then Pi C
rebooted. Post-boot state was `link=false, usb0=down, Discoverable=yes,
ctflags` unreadable (no USB path to even ask). Nothing was touched by hand.

**Cron recovered it unattended in 205 seconds:**

    17:25:00 usb0 down but gadget present - bringing it up
    17:25:10 relink OK via USB path

Everything else persisted across the reboot: firewall (4 drop chains), key-only
SSH, Pi-hole DNS, clock, both cron jobs, Connector, telemetry off, LAN still
blocked.

**Gap the test exposed and closed:** the run that reconnects used to exit
immediately, so the radio stayed discoverable until the *next* tick - up to 5
minutes of needless exposure after every recovery. `close_radio()` is now called
on every successful reconnect as well as on the already-linked path. Verified in
a single run:

    Car Thing radio not connectable (UP RUNNING) - enabling piscan
    relink OK via USB path
    closing discoverable/pairable
    -> connected:true, Discoverable: no, Pairable: no

**Behavioural note:** the Car Thing's page scan reads `UP RUNNING` (no PSCAN)
even while connected. `nocturned` appears to toggle scans around connection
state, so do not treat a missing PSCAN as a fault on its own - check
`/api/device/status` for the truth.

## Can the Car Thing live away from Pi C? YES (verified 2026-08-27)

Tested properly: `usb0` down, Car Thing unreachable by IP, relink cron disabled —
pure Bluetooth. Result: **`relink OK via direct connect`, `connected:true`.**

**How it actually reconnects, which is not obvious:**

1. The Car Thing **initiates** toward Pi C roughly every 15s. Pi C logs
   `[PairingAgent] Auto-authorizing /org/bluez/hci0/dev_AA_BB_CC_11_22_33`.
   That is what teaches BlueZ the device object.
2. Once BlueZ knows it, `POST /api/bluetooth/connect/<addr>` succeeds **with no
   scan, no discovery, no USB and no bond**.
3. But the Connector does **not** page it by itself after a restart — it has no
   target and sits idle. Something has to issue the connect. That is relink.

So relink now tries a **direct connect first** (step 2), before the USB repair
and before any scan. That is the step that makes separation viable.

**Timing:** right after a Pi C restart the direct connect *fails*, because BlueZ
has not yet heard from the Car Thing. It succeeds once an auto-authorize has
landed — about 15-45s. With cron at `*/5`, worst case recovery is ~5 min.

**Two beliefs corrected during this test:**
* An earlier "the Connector recovered on its own" claim was **wrong** — checking
  timestamps, `relink OK via USB path` logged at 21:40:06 and relink sleeps 5s
  after connecting, so relink issued that connect at 21:40:01. The USB path did
  it, not the Connector.
* **Pairing does not create a durable bond.** Pi C's bond count went 0 -> 1 on
  `pair`, then back to **0** after a bluetoothd restart. BlueZ discards it. What
  persists is the `cache/` entry, and that is enough.

### Car Thing side, made self-sufficient

`/etc/systemd/system/carthing-pscan.{service,timer}` — re-asserts
`hciconfig hci0 pscan` every 2 min (`OnBootSec=30s`). Verified: page scan
sabotaged, timer restored it unaided.

**`pscan`, deliberately not `piscan`.** Page scan makes it connectable to Pi C,
which already knows the address. Inquiry scan would also advertise it to everyone
in range, which it does not need. Consequence: relink's over-the-air *scan* path
cannot find it — that is fine, because the direct-connect path does not need to.

Installing this required `mount -o remount,rw /` on the Car Thing (rootfs is
read-only), then remounting `ro`. **A firmware OTA will wipe these units.** If
reconnection gets flaky after a Nocturne update, check them first.
