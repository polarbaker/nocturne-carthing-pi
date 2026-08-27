# Now: Nocturne Companion (phone over Bluetooth)

After the flash, the Car Thing boots Nocturne 4.1.3 and waits for a Companion
pairing. The app handles setup, Spotify auth, voice commands and OTA updates —
no computer needed from here on.

## ⚠️ Unplug it from the Pi first
**The Car Thing must not be connected to a computer while you pair.** USB
connection conflicts with the Bluetooth pairing. Move it to a USB **wall
charger** before starting — it only needs power, not a host.

Make sure the charger and cable can actually carry current: the device
requests 500 mA and browns out on weak phone chargers or charge-only cables.

## Requirements
* **Spotify Premium.** Nocturne drives the Spotify API — free accounts will not work.
* **Nocturne Lifetime ($9.99 one-time)** or **Nocturne+ ($1.99/month)** for app access.
* iOS **16.1+** or Android **13+**.

## Getting the app — neither store listing is public yet
* **iOS** — distributed through **TestFlight** while the App Store release is
  finished. Join from https://usenocturne.com/app on the iPhone/iPad itself.
* **Android** — **closed Google Play beta**. Two steps, and the order matters:
  1. Join the `nocturne-testing` Google Group **with the same Google account
     you use on the Play Store**.
  2. Then install Nocturne from the Play Store listing.
  Joining with a different account is the usual reason the listing 404s.

## Then
Open the app and follow its pairing flow. Once paired it does Spotify login and
OTA firmware updates itself — you should not need `flashthing` again unless
something goes badly wrong.

## Keep in sync
Firmware **v4.1.3** wants **Nocturne Companion** updated to match, and if you
later add the Pi 4 bridge, **Nocturne Connector v2.1.1-1**. Mismatched versions
across the three is the most common source of "it pairs but nothing loads".

## Recovery, if ever needed
Buttons **1 + 4** while plugging in → Amlogic mask-ROM mode → reflash with
`~/carthing/flash-when-ready.sh`. Mask-ROM lives in silicon; a bad flash cannot
take it away. Backups of the pre-Nocturne device are in `~/carthing/backup/`.
