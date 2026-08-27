# Car Thing — using it, wall-mounting it, and locking it down

State as of 2026-08-27: Nocturne 4.1.3 on the Car Thing, Connector v2.1.1-1 on
Pi C (`10.0.0.15`), Spotify linked, telemetry **disabled**.

---

## 1. Can it run off just Wi-Fi? — **No. It has no Wi-Fi radio at all.**

The Car Thing is **Bluetooth-only**. It never had Wi-Fi or Ethernet; the
original product was always a screen for a phone. That is the entire reason
Nocturne Connector exists.

So the wall-mounted Car Thing needs exactly **one cable: USB power.** All
network access is Bluetooth → Pi C → Wi-Fi → internet.

```
[Car Thing on wall] --Bluetooth--> [Pi C] --Wi-Fi--> [router] --> internet
      ^ USB power only                ^ must stay powered + in BT range
```

### Bluetooth range is the real constraint
Current signal is **-31 dBm** (they are inches apart). Practical guidance:

| RSSI | Meaning |
|---|---|
| -30 to -50 | excellent, same room |
| -50 to -70 | good, works through one interior wall |
| -70 to -80 | marginal — expect dropouts |
| below -80 | do not rely on it |

Class-2 Bluetooth is roughly 10 m / 33 ft line-of-sight, and **kitchens are
hostile** — the fridge, the microwave, and any metal cabinetry all attenuate
2.4 GHz badly, and the microwave actively jams it while running. Put Pi C in
the same room, ideally with line of sight. Re-check the number after mounting:

```
curl -s -X POST http://10.0.0.15/api/bluetooth/scan >/dev/null; sleep 6
curl -s http://10.0.0.15/api/bluetooth/devices | python3 -c "
import json,sys
d=[x for x in json.load(sys.stdin)['devices'] if x['address']=='AA:BB:CC:11:22:33']
print('RSSI', d[0]['rssi']) if d else print('not visible')"
curl -s -X POST http://10.0.0.15/api/bluetooth/stop-scan >/dev/null
```

---

## 2. Standalone-ness — what it takes

Both devices boot into their roles unattended; there is nothing to log into
after setup. To make it genuinely fire-and-forget:

* **Power the Car Thing from a real USB charger** — it requests 500 mA and
  browns out on weak or charge-only cables. A right-angle USB-C cable keeps the
  wall profile flat.
* **Pi C must stay powered.** It is the whole backend. If it dies, the Car
  Thing falls back to the "download the app" QR screen.
* **Clock sync is a hard dependency.** Pi C has no RTC. On a cold boot with no
  working NTP, `nocturned`'s API blocks on
  `Waiting for system clock to be synchronised` and serves nothing — this
  already cost an hour of misdiagnosis once. See the Pi-hole section.
* Consider a small UPS/battery for Pi C if kitchen power is flaky.

---

## 3. Using it

**Physical controls:** 4 preset buttons across the top, a rotary dial (turn to
scroll/adjust, press to select), a back button, and the touchscreen.
Press-and-hold a preset to assign the current context to it; tap to recall.

**Free on the Connector path:** the Nocturne UI, full playback control,
album art, progress bar, lyrics, like/heart, and Spotify Local Files.

**Paid, and worth knowing so you are not hunting for them:**
* **Voice control / wake words** — requires **Nocturne+** ($1.99/mo).
  The models *are* on the device (`hey_nocturne`, `ok_nocturne`, `hey_spotify`,
  `ok_spotify` all load at boot) but the feature is gated.
* **Mockingbird** (the pixel-recreation of the original Spotify UI) — also
  Nocturne+.
* The **Companion phone app** — Nocturne Lifetime ($9.99). Not needed here;
  the Connector replaces it.

**Manage it** at `http://10.0.0.15/` — device status, Spotify account,
OTA updates. Use the IP; mDNS does not resolve on this LAN.

---

## 4. Privacy and security

### Done already
* **Telemetry disabled** — `POST /api/analytics/enabled {"enabled":false}`,
  verified `{"enabled":false}`. It ships **on** by default.

### ⚠️ The real exposure: the Connector API has NO authentication
Anyone on your LAN can control this device completely, with no credentials.
Verified empirically — every state-changing call in this project was made from
a *different machine* with no token, cookie, or password:

```
POST /api/auth/pair              <- linked the Nocturne account
POST /api/spotify/authorize      <- started Spotify auth
POST /api/bluetooth/connect/...  <- paired the Car Thing
POST /api/setup/complete         <- completed setup
POST /api/analytics/enabled      <- toggled telemetry
POST /api/power/reboot           <- (exists — reboots Pi C)
POST /api/auth/delete-account    <- (exists — destroys the account)
```

There is no auth layer to turn on. Mitigate at the network:
* Put Pi C on an **IoT VLAN / guest SSID** isolated from your main network, or
* firewall port 80 on Pi C to only your admin machine, and
* **never expose Pi C to the internet.** Do not port-forward it.

`sshd` on Pi C also accepts `password` and `keyboard-interactive`, so set a
strong root password (or disable password auth) if you get console access.

### Pi-hole — what must resolve
Nocturne is **not** ad-supported and does not phone home for tracking once
analytics is off, but it needs these. Allowlist them:

| Domain | Why | Break if blocked |
|---|---|---|
| `pool.ntp.org` (+ `*.pool.ntp.org`) | chrony clock sync | **Pi C hangs at boot, serves nothing** |
| `api.spotify.com` | playback control | no control at all |
| `accounts.spotify.com` | OAuth / token refresh | login fails, silent expiry later |
| `*.scdn.co` | album art CDN | blank artwork |
| `spclient.wg.spotify.com` | Spotify client services | **often on blocklists** — playback state breaks |
| `usenocturne.com` | account pairing, OTA | cannot pair or update |
| `*.supabase.co` | Nocturne auth backend | cannot authenticate |
| `github.com`, `objects.githubusercontent.com` | OTA images | updates fail |

`spclient.wg.spotify.com` is the one to watch — several popular lists block it
as Spotify telemetry, and it takes working playback down with it.

The NTP entry is not optional. A blocked NTP lookup on a device with no RTC
does not degrade gracefully; it stalls the whole stack at boot.

---

## 5. Ways to improve it

* **Mount:** the Car Thing has a standard mount on the back; a low-profile
  right-angle USB-C cable keeps it flat to the wall.
* **Re-check RSSI after mounting** (command above) before committing to
  adhesive or screws.
* **Keep versions in step:** firmware 4.1.3 ↔ Connector v2.1.1-1. Update both
  together from the dashboard; mismatches cause "pairs but nothing loads".
* **OTA from the dashboard** — `flashthing` should never be needed again unless
  something goes badly wrong.
* If you later want the Car Thing's own USB network back (its DNAT shortcuts
  `10.0.0.15:2022` → Car Thing SSH and `:2222` → Chrome DevTools), note Pi C
  statically assigns `usb0 = 172.16.42.1/24` while the Car Thing hands out
  `10.42.1.x` — that subnet mismatch is why those ports are currently closed.
* **Recovery, always:** presets **1+4** while plugging in → mask-ROM →
  `~/carthing/flash-when-ready.sh`. Mask-ROM is in silicon; it cannot be bricked.
