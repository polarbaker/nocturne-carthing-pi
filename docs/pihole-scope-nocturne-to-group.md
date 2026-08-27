# Scoping the Nocturne allowlist to Pi C only

## Why

Pi-hole allowlist entries apply to **every client on the network**. Three of the
Nocturne entries are wildcards:

| Entry | Scope | Concern |
|---|---|---|
| `(\.\|^)pool\.ntp\.org$` | time servers | none |
| `(\.\|^)scdn\.co$` | Spotify CDN only | none |
| `(\.\|^)supabase\.co$` | **every app hosted on Supabase** | this one |

That last one is the reason to bother. It is not just Nocturne's backend — it
covers any Supabase-hosted endpoint, including analytics or tracking domains
Pi-hole was previously blocking for your other devices.

The exact entries this applies to are the ones commented
`Nocturne Connector / Car Thing`.

## Steps (Pi-hole v6 web UI, ~10 minutes)

### 1. Make a group

**Groups** → name it `nocturne` → **Add**.

### 2. Put Pi C in it — in *addition* to Default

**Clients** → **Add a new client** → pick Pi C, `10.0.0.15`.

Then set its groups to **both `Default` and `nocturne`**.

This is the part that is easy to get wrong. Clients can belong to several groups
and receive the union of their rules. Pi C must stay in `Default` so it keeps
your normal blocklists; `nocturne` only adds the allowances on top. If you remove
Pi C from `Default`, it stops being filtered at all — the opposite of the goal.

> Pi C has a DHCP lease, so its IP could change. Either give it a DHCP
> reservation on the router, or add the client by **MAC** instead of IP so the
> group assignment survives a lease change.

### 3. Move the Nocturne entries into that group

**Domains** → for each of the ten entries commented
`Nocturne Connector / Car Thing`:

- edit it
- set its group assignment to **`nocturne` only**
- **un-tick `Default`**

Result: only Pi C gets these allowances; every other device is filtered as before.

## Verify it worked

From a machine that is *not* Pi C, a wildcard-covered host should now be treated
by your normal rules again, while Pi C still resolves everything it needs.

The check that actually matters is that Pi C did not lose anything — especially
NTP, because Pi C has **no RTC** and a bad clock stops the Connector serving the
Car Thing entirely:

    ssh root@10.0.0.15 'nslookup pool.ntp.org 10.0.0.3; chronyc tracking | head -2'

If `pool.ntp.org` fails to resolve, Pi C is in the wrong group — put it back in
`Default` and re-check.

## If it goes wrong

Re-tick `Default` on those ten domain entries and everything reverts to the
current network-wide behaviour. Nothing here is destructive.
