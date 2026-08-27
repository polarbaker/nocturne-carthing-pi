# Car Thing rebuild — Nocturne 4.1.3

Device: Spotify Car Thing (superbird), serial `<DEVICE_SERIAL>`, on Pi A (`raspberrypi`).

## What was here before
Stock Spotify Buildroot 2019.02.1 (kernel 4.9.113, May 2020) running a Chromium
kiosk on a **DeskThing client v0.10.4** webapp (built 2024-12-21). Dead in the
water — DeskThing's client talks to a server on port 8891 and nothing was
serving it. Original Spotify webapp preserved on-device at
`/usr/share/qt-superbird-app/webapp-orig`.

## Why Nocturne and not DeskThing/GlanceThing
| | version | date | arm64 Linux server build? |
|---|---|---|---|
| **Nocturne** | **4.1.3** | **2026-08-21** | n/a — it *is* the firmware |
| DeskThing | 0.11.17 | 2025-08-13 | **no** (amd64 .deb / x64 AppImage only) |
| GlanceThing | 0.0.16 | 2026-04-11 | **no** (x64 only) |

Both desktop-server options are stale *and* have no aarch64 build, so neither
can be hosted on a Pi 5. Nocturne is a full Yocto firmware replacement and is
the actively developed project.

## Backups — `backup/`
Taken over ADB before flashing (`backup/dump.sh`, re-runnable):

* `partitions/` — `bootloader`, `env`, `fip_a`, `fip_b`, `dtbo_a`, `dtbo_b`,
  `logo`, `misc` (small), and `settings` (250 MB; holds the Bluetooth pairing
  and device-unique config).
* `var-lib.tar.gz` — `/var/lib` (BT pairing for `AA:BB:CC:11:22:33`, qt app settings).
* `deskthing-webapp.tar.gz` — the DeskThing v0.10.4 webapp that was installed.

Note the eMMC partition nodes live at `/dev/env`, `/dev/settings`, … **not**
`/dev/block/by-name/` on this firmware.

## Flashing
`flashthing-cli` v0.6.0, **native aarch64** — this Pi flashes it directly, no
second computer needed. udev rules installed via `sudo flashthing-cli --setup`
(`/etc/udev/rules.d/98-superbird.rules`).

```
sudo ~/carthing/tools/flashthing-cli ~/carthing/images/nocturne_image_v4.1.3.zip
```

`~/carthing/flash-when-ready.sh` waits for Amlogic mode then runs the above.

### Entering USB burn mode
**Hold preset buttons 1 and 4 while plugging in the USB cable.** Screen stays
black — that is correct. There is no software path: this firmware has no
`fw_setenv`, and the U-Boot env gates it on a GPIO:

```
check_button=if gpio input GPIOA_3; then run do_usb_burning; fi;
usb_burning=update 1000
```

USB IDs by mode: `1d6b:1014` = the old modded gadget (normal boot),
`1b8e:c003` = Amlogic mask-ROM / burn mode, `18d1:4e40` = stock normal boot.
(superbird-tool only recognises `18d1:4e40` as "normal", so it would not have
seen this device before the reflash.)

## Recovery
`flashthing-cli --unbrick`, or buttons 1+4 again — mask-ROM is in silicon and
cannot be bricked by a bad flash.

## Connectivity
Nocturne needs **Spotify Premium** plus an internet path. Two options:

1. **Now — phone over Bluetooth.** Nocturne Companion, iOS 16.1+ / Android 13+.
   $9.99 one-time or $1.99/month. Portable, works in the car.
2. **Later — Nocturne Connector on Pi C.** Free, no subscription.
   See `CONNECTOR-PIC.md`.

### Backup gap — read this
`mmcblk0boot0` / `mmcblk0boot1` (the eMMC **hardware** boot partitions) were
**not** captured. The first backup attempt used the wrong device path
(`/dev/block/by-name/…`, which does not exist on this firmware) and produced
0-byte files; by the time that was fixed the flash had already written
`superbird-boot.bin` to both hwparts. Everything else in `partitions/` is a
real dump. This is low impact — those held the stock Amlogic bootloader, which
is published, and mask-ROM recovery does not depend on them.

## Flash log — what actually happened
Attempt 1 (`flash-attempt1.log`) got most of the way:

* `boot0` ✅ 2 MB, `boot1` ✅ 2 MB
* `superbird.wic` ✅ **all 1,430,275,072 bytes in 147s** (~8 MB/s, sparse)
* `bandaid.ext4` ❌ **failed at LBA 0x266000** — ~59 MB into the 201 MB write.
  Three retries: `No response received for bulk command`, then
  `Operation timed out`, then it gave up.

Attempt 2 failed instantly with `USB error: Entity not found`: after the
aborted write the burn-mode U-Boot is wedged — it still enumerates as
`1b8e:c003` but answers nothing. **A stale enumeration is not a usable device.**
It must be physically unplugged and re-entered via buttons 1+4; that is the only
way to power-cycle a bus-powered device.

### ⚠️ `flashthing-cli` exits 0 on fatal errors
Both failures logged `ERROR` and still returned **exit status 0**. Never gate on
its exit code — grep the output for `ERROR`. `flash-when-ready.sh` does this.

### Ruled out: power
No over-current or under-voltage in `dmesg`; `usb_max_current_enable=1` (5 A PSU,
full 1.6 A USB budget); the Car Thing sits on its own root-hub port at 480 M,
not behind the VIA/Dell hub chain. The failure is a transient bulk-command
timeout in the Amlogic protocol during the sustained **non-sparse** 201 MB write.

### Fallback if it recurs
Re-run with `--sparse`. The `bandaid` region (LBA 2400256–2793472) is inside the
`erasing 2793472 sectors at LBA 0` that precedes the wic write, and the wic is
itself sparse-written, so that area is already zeroed — skipping all-zero chunks
there is safe and avoids the long sustained write.

## Post-flash state (2026-08-26)
Nocturne **4.1.2 (wrynose)**, kernel `7.0.2-superbird`, booted and running.
The `bandaid.ext4` failure turned out to be **non-fatal** — the rootfs is what
boots. Device is reachable three ways:

* **ADB** — still `<DEVICE_SERIAL>`, works as before.
* **SSH** — port 22 open on the device.
* **USB network** — gadget `1d6b:0104`, device `10.42.1.90`, Pi side `usb0`
  `10.42.1.91/29`. **The Car Thing runs the DHCP server**, same as the old firmware.

`nocturned.service` is the core daemon: webapp + WebSocket API on
**127.0.0.1:8080** (root `/opt/nocturne/webapps/ui`), Chromium kiosk in front of
it, plus BlueZ agent advertising iAP2 / ANCS / SPP as `Nocturne (QS1Q)`.

### The device shipped with no internet
Out of the box it had **only** a link-local route on `uncm0` — no default
gateway, no DNS. Fixed on Pi A by mirroring the existing Pi-to-Pi NAT:

```
sudo nft add rule ip pinat postrouting ip saddr 10.42.1.88/29 oifname "wlan0" masquerade
sudo adb -s <DEVICE_SERIAL> shell 'ip route add default via 10.42.1.91 dev uncm0'
sudo adb -s <DEVICE_SERIAL> shell 'resolvectl dns uncm0 1.1.1.1 8.8.8.8; resolvectl domain uncm0 "~."'
```

Verified: ping and DNS both work from the device. **None of this is persistent** —
the nft rule and the route vanish on reboot. That is fine, because it is *not*
the auth mechanism: the Connector proxies Spotify over Bluetooth. It is only
useful for clock sync and OTA while the device is tethered to Pi A.

### Why the setup screen demands the phone
`assets/AuthScreen-*.js` is the paid path, verbatim:
"Nocturne Lifetime or Nocturne+ is required.", "Scan the QR code with your
phone's camera.", QR → `https://usenocturne.com/app`, deep link
`nocturne://connect-spotify`.

The way around it is the Connector — see `CONNECTOR-PIC.md`.
