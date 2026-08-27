# Spotify Car Thing + Nocturne Connector on a Raspberry Pi

Running a Spotify Car Thing on [Nocturne](https://usenocturne.com) firmware with
the **Nocturne Connector** on a headless Raspberry Pi 4 — no phone, no companion
app, no subscription. Plus the hardening and self-healing needed to make it
survive reboots and power cycles unattended.

These are field notes from an actual build, including the wrong turns. Several
widely-repeated beliefs about this hardware turned out to be false, and those are
documented as prominently as the things that worked.

## Layout

| Path | What |
|---|---|
| `docs/README.md` | The rebuild: stock firmware → Nocturne, burn mode, flashing |
| `docs/CONNECTOR-PIC.md` | Connector on a Pi, headless, entirely by REST API |
| `docs/SETUP-PHONE.md` | The phone route, for comparison |
| `docs/USING-AND-SECURING.md` | Day-to-day use and the security surface |
| `docs/HARDENING-AND-RELIABILITY.md` | Firewalling, DNS, and the self-healing work |
| `docs/pihole-scope-nocturne-to-group.md` | Scoping the allowlist to one client |
| `scripts/pi-connector/` | Watchdog, relink helper, nftables ruleset |
| `scripts/car-thing/` | systemd units for the Car Thing itself |
| `scripts/pihole-nocturne-allowlist.sh` | Allowlists the domains Nocturne needs |

## Findings worth the click

**`/api/bluetooth/connections` lies.** It returns `{"connections":[]}` while the
RFCOMM link is up and streaming RPC. `/api/device/status` is authoritative. Any
health check built on the former will tear down a working link.

**There is no `/api/status`.** Unknown `/api/*` paths return **200 with a 0-byte
body**, identical to a real route, so a typo'd health check looks like it passes.
`/api/info` is the real one.

**The Car Thing's radio comes up with page scan disabled.** `UP RUNNING` with no
`PSCAN`, so it answers no pages and appears in no scans — every connect attempt
times out at *exactly* 5.12s forever. `hciconfig hci0 piscan` fixes it and the
link then connects in ~1.3s. Read the connect timing as a diagnostic: 5.12s means
absent, ~1.3s means present. It is binary.

**`rssi:-100` is the discovery filter floor, not a measurement.** The Connector
scans with `RSSI>=-100`. A real reading side-by-side is about -71. Chasing -100
as a distance problem wastes a lot of time.

**"USB conflicts with Bluetooth" is false.** The two work fine together once page
scan is enabled. The correlation everyone repeats is coincidence.

**Test a Pi-hole block by differencing against upstream**, never in isolation. A
domain resolving through Pi-hole does not prove filtering is off, and NXDOMAIN
from both Pi-hole and upstream means the name simply does not exist.

## Reliability model

Two cron jobs on the Pi (`*/5`) plus one systemd timer on the Car Thing. Between
them a cold boot self-heals end to end — bring up USB, re-enable the Car Thing's
page scan, reconnect, close the radio again — with no human involvement. Verified
against real reboots, not simulations.

## Scope and safety

Written for a single home setup. Adapt addresses, MACs and interface names before
using any of it. All identifiers here are placeholders.

`scripts/pi-connector/connector-relink` SSHes to the Car Thing as root **without
authentication**, because that is how the Nocturne firmware ships. That is only
acceptable because the link is a point-to-point USB connection unreachable from
the LAN. Do not expose it.

Firmware images, eMMC dumps and third-party binaries are deliberately not in this
repo — see `.gitignore`.
