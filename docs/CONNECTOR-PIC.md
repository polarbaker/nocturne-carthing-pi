# Nocturne Connector on Pi C (the Raspberry Pi 4) — running

Purpose: run the Car Thing with **no phone, no TestFlight, no subscription**.

## Status: DONE on this side (2026-08-26)
`nocturne-connector_v2.1.1-1.img.gz` written to Pi C's microSD (`/dev/sda`,
29.8 GB) on Pi A. 2,822,766,592 bytes, verified layout:

```
sda1  128M vfat   (boot)
sda2    1G ext4   (root A)
sda3    1G ext4   (root B)
sda4  512M ext4   (data)
```

The card previously held Pi C's Debian 13 install (`hostname: pi4`) and was
wiped with explicit approval. Target was confirmed against the running root
(`/dev/mmcblk0p2`) before writing — see the shared-UUID hazard in the two-Pi notes.

Wi-Fi pre-seeded: `wpa_supplicant.conf` on the boot partition, SSID
`<YOUR_WIFI_SSID>`, WPA-PSK, `country=US`, mode 600.

**Format matters.** `scripts/services/wifi-import.sh` looks for
`wpa_supplicant{,.conf,.txt}` on the boot partition and *inserts*
`ctrl_interface=/run/wpa_supplicant` and `update_config=1` if they are not
present **verbatim**. Writing the usual
`ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev` form gets you a
**duplicate `ctrl_interface` directive**. The file was written in the exact form
the script expects. On first boot it copies the config to
`/data/etc/wpa_supplicant/`, symlinks it, and **deletes it from the boot
partition** — so the PSK does not linger on the FAT partition.

## Next steps (physical)
1. Move the microSD from Pi A's card reader into the **Pi 4**.
2. Power Pi C on. Give it a few minutes on first boot.
3. Browse to **http://<device>.local** and follow the on-screen setup.
4. **Move the Car Thing off Pi A to a USB wall charger.** A computer USB
   connection conflicts with Bluetooth pairing, and once the Connector is up the
   Car Thing does not need Pi A at all.

## How it actually works — verified from the image, not the docs
The Connector is **Alpine Linux 3.24** running a **Bun + Elysia** server from
`/etc/nocturne-connector/api` (`bun run server/index.ts`, started by an OpenRC
service). It reaches the Car Thing over **Bluetooth RFCOMM/SPP through BlueZ
D-Bus** — `server/bluetooth/rfcomm-server.ts`, `dbus-adapter.ts`. **Not** over
USB, which is why it needs a Pi with a Bluetooth radio.

It performs the Spotify OAuth itself (`routes/spotify.ts`,
`services/auth-service.ts`) and proxies the API.

**No paywall.** Grepping the entire server source for
`entitlement|subscription|lifetime|nocturne+|paywall|premium` returns **zero
hits**, matching the install page's claim that the Connector route needs no paid
tier. It does redeem a pairing code against `usenocturne.com/api/pair/redeem`,
so a Nocturne **account** is still involved — no evidence it costs anything.

**Spotify Premium is still required** on every path. That is Spotify's API
restriction, not Nocturne's.

The firmware accepts a Pi connector: the UI's test is
`isConnector === true || device_type === "macos_connector"`, and the Pi
connector advertises `"connector"` with the `isConnector` flag set — the
`macos_` name is a legacy special case, not a Mac-only gate.

## Version pinning
Connector **v2.1.1-1** pairs with Nocturne firmware **v4.1.3**. Update them
together; mismatches are the usual cause of "it pairs but nothing loads".

## ✅ WORKING — setup completed 2026-08-27T15:57:39Z, entirely by API

Final state: `authenticated: true` (<your-email>),
`setupComplete: true`, Spotify `linked` (<account-holder>), Car Thing
`connected: true` as `rfcomm-client:AA:BB:CC:11:22:33`.

### The headless recipe (no display on Pi C, no web wizard)
All actions are **POST**; all `/status` reads are GET. Base `http://10.0.0.15`.

```
POST /api/auth/pair            {"code":"<8-char code from usenocturne.com>"}
POST /api/spotify/authorize    -> {authState:{userCode, verificationUri}}
                                  enter userCode at spotify.com/pair
POST /api/bluetooth/scan       -> then GET /api/bluetooth/devices
POST /api/bluetooth/connect/AA:BB:CC:11:22:33
POST /api/bluetooth/stop-scan
POST /api/setup/complete
```

### Three things that cost real time — do not rediscover them
1. **The Nocturne account IS required, despite appearances.**
   `POST /api/spotify/authorize` returns `success:true` and a valid-looking
   device code while `authenticated:false` — but the flow **never completes**,
   because the code is `base64("<userCode>,<nocturne-uuid>")` and there is no
   account session to bind that UUID to. Two codes were burned this way.
   **Pair the account first, then Spotify.** It is free — zero hits across the
   whole connector source for `entitlement|subscription|lifetime|paywall|premium`.
2. **Spotify device codes expire in ~10-15 min and the Connector keeps polling a
   dead one without surfacing the expiry.** `/api/spotify/status` still says
   `"status":"polling"` on an expired code, which looks identical to "waiting".
   If nothing happens within a few minutes: `POST /api/spotify/cancel` then
   `POST /api/spotify/authorize` for a fresh one.
3. **`connect` and `unpair` are path-parameterised** —
   `/api/bluetooth/connect/<ADDR>`, `/api/bluetooth/unpair/<ADDR>`. They do
   **not** appear in a grep for quoted `"/api/bluetooth/..."` literals in the UI
   bundle because they are template literals. Grepping only for quoted strings
   makes it look like there is no way to initiate a connection at all.

`pairing-confirm` / `pairing-reject` were never needed — the Car Thing paired
without a PIN prompt on `connect`.

### Note on `bandaid`
The Car Thing reports `version 4.1.3+20260821174253`, `imageVersion
4.1.2+20260813141938`, `bandaidVersion 4.1.3+20260821174253` — i.e. the bandaid
overlay lifts the 4.1.2 base to 4.1.3, and it is reporting as present and
correct despite the flash-time write failure at LBA 0x266000. Worth re-checking
if odd behaviour ever shows up, but it is not currently faulted.
