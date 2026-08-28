# Weather on the Nocturne lock screen

Adds current temperature, conditions, today's high/low and the date underneath
the clock on the Car Thing's lock screen. Nocturne itself is untouched — this
appends one element outside React's tree and one `<script>` line to the shipped
`index.html`.

## Install / re-install

    ./install.sh            # install, or re-apply after a Nocturne update
    ./install.sh --remove   # revert the device to stock

Needs the **USB data cable** between the Car Thing and Pi C (a charge-only cable
enumerates nothing). Once installed the cable is not needed — weather arrives
over Bluetooth.

## How it works

| | |
|---|---|
| `weather-service.ts` | On Pi C at `server/services/`. Fetches Open-Meteo every 15 min, keeps the last good reading, pushes `weather.update` via the Connector's existing `broadcastToDevices()`. |
| `nocturne-manager.ts` | 4 added lines - see below. Vendor file, not redistributed here. |
| `weather-overlay.js` | On the Car Thing at `/opt/nocturne/webapps/ui/`. Draws the readout. |
| `install.sh` | Idempotent installer. Always rebuilds `index.html` from `index.html.stock`, so repeat runs cannot stack duplicate tags. |

The Car Thing has no Wi-Fi. Data reaches it over Bluetooth RFCOMM: the daemon
passes unknown event topics through untouched, so no daemon change was needed.

## The four lines to add to `nocturne-manager.ts`

That file is the Connector's own source and is not redistributed here. On the Pi
it lives at `/etc/nocturne-connector/api/server/nocturne-manager.ts`. Back it up
first, then add:

```ts
// 1. beside the other service imports
import { WeatherService } from "./services/weather-service";

// 2. beside the other readonly service fields
readonly weatherService = new WeatherService((topic, data) => this.broadcastToDevices(topic, data));

// 3. first line inside initializeOnline()
this.weatherService.start();

// 4. inside onCall(), immediately BEFORE the `Unknown method` fallthrough
if (method === "weather.get") {
  return { result: this.weatherService.current ?? null };
}
```

The Connector runs TypeScript directly (`bun run server/index.ts`, no build step),
so deploying is a copy plus `rc-service connector-api restart`. Note the restart
drops the Bluetooth link for a minute; it recovers on its own.

## Set your location

`weather-service.ts` ships with a **Greenwich placeholder** - set `LATITUDE` and
`LONGITUDE` to your own before this is useful.

Then deploy it:

    scp weather-service.ts root@10.0.0.15:/etc/nocturne-connector/api/server/services/
    ssh root@10.0.0.15 'rc-service connector-api restart'

## Things that cost real time — do not rediscover them

**The daemon silently drops RPC requests whose `id` is not a UUID.** No error, no
response, nothing in any log. `weather.get` with `id: "wx3"` vanished; with
`crypto.randomUUID()` it worked immediately.

**A `MutationObserver` on `document.body` with `subtree:true` is too expensive
here.** Nocturne mutates constantly (ambient-light events alone are several a
second) and an unthrottled observer drove the device load high enough to stall
the main thread — CDP stopped responding entirely. A 400 ms poll is bounded and
imperceptible.

**Keep the overlay JS pure ASCII.** `atob()` yields a binary string, so a UTF-8
`°` (0xC2 0xB0) arrives as `Â°` when injected via CDP. Escaped as `°` it is
immune to that and to any charset guessing.

**Ask for weather more than once.** A single `weather.get` on WebSocket open is
not enough: after a device reboot the page loads before the Bluetooth link is up,
the request fails with "No active app session", and the panel stays blank until
the next 15-minute push. The overlay now retries every 30 s until it has data.

**Darkening the background needs `z-index: 5`, not a higher value.** The app's
content lives in a stacking context at `z-10` and `GradientBackground` paints
below it, so a body-level scrim at 5 lands *between* them - darkening the album
art without dimming the clock drawn on top. Anything >= 10 covers the clock and
makes legibility worse, not better.

**`pointer-events: none` is mandatory.** LockView owns swipe-to-skip and
tap-to-play. Without it the overlay silently eats those gestures — the screen
looks right and the controls just stop working.

## What deletes this

- **A Nocturne UI update** replaces `/opt/nocturne/webapps/ui` wholesale (UI OTA,
  bandaid OTA, or `nocturne-floor-sync`). Re-run `install.sh` with the cable in.
  As of install, rootfs floor is `4.1.2` and the bandaid floor is `4.1.3`, so
  floor-sync does **not** fire on normal boots.
- **A Connector update** on Pi C writes a raw rootfs image and takes
  `weather-service.ts` with it. Re-copy from this directory.

Both failures are silent — the weather just stops appearing. That is why this
directory lives on the admin Pi and not on either device.
