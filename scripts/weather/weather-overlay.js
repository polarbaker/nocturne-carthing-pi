/* Weather on Nocturne's lock screen.
 *
 * Adds a weather line under the existing LockView clock. Does not modify or
 * replace any Nocturne UI - it appends one element to document.body, OUTSIDE
 * React's #root, so React never reconciles it away.
 *
 * Data arrives from the Nocturne Connector on the Pi over Bluetooth:
 *   - `weather.get` RPC on connect, for an immediate reading
 *   - `weather.update` events thereafter, pushed every 15 min
 *
 * Gotcha worth remembering: the daemon only routes a response back if the
 * request `id` is a UUID. A non-UUID id is dropped silently, no error.
 */
(() => {
  "use strict";
  if (window.__nocturneWeather) return;        // idempotent if injected twice
  window.__nocturneWeather = true;

  var STALE_MS = 3 * 60 * 60 * 1000;           // mark stale after 3h
  var last = null;                              // last good reading

  // --- icons -------------------------------------------------------------
  // Inline SVG, deliberately not emoji: the Nocturne image strips locale paks
  // and drops noto-sans-cjk, so colour emoji would very likely render as tofu.
  function svg(p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
           'stroke-linecap="round" stroke-linejoin="round" width="42" height="42">' + p + '</svg>';
  }
  var SUN = svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>');
  var MOON = svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>');
  var PCLD = svg('<circle cx="8.5" cy="8" r="3.1"/><path d="M8.5 1.9v1.4M2.5 8H3.9M4.3 3.8l1 1M12.7 3.8l-1 1"/><path d="M17.5 20H8a3.6 3.6 0 0 1 0-7.2 4.8 4.8 0 0 1 9.2 1.1 3 3 0 0 1 .3 6.1z"/>');
  var CLOUD = svg('<path d="M17.5 19H7.5a4 4 0 0 1 0-8 5.3 5.3 0 0 1 10.2 1.2 3.4 3.4 0 0 1-.2 6.8z"/>');
  var FOG = svg('<path d="M17.5 14H7.5a4 4 0 0 1 0-8 5.3 5.3 0 0 1 10.2 1.2A3.4 3.4 0 0 1 17.5 14z"/><path d="M4 18h16M6 21.5h12"/>');
  var RAIN = svg('<path d="M17.5 15H7.5a4 4 0 0 1 0-8 5.3 5.3 0 0 1 10.2 1.2 3.4 3.4 0 0 1-.2 6.8z"/><path d="M9 18.2l-.8 2.4M13 18.2l-.8 2.4M17 18.2l-.8 2.4"/>');
  var SNOW = svg('<path d="M17.5 15H7.5a4 4 0 0 1 0-8 5.3 5.3 0 0 1 10.2 1.2 3.4 3.4 0 0 1-.2 6.8z"/><path d="M9 19h.01M12.5 21h.01M16 19h.01M12.5 18h.01"/>');
  var STORM = svg('<path d="M17.5 14H7.5a4 4 0 0 1 0-8 5.3 5.3 0 0 1 10.2 1.2 3.4 3.4 0 0 1-.2 6.8z"/><path d="M13 16l-3 4h4l-3 4"/>');

  // WMO codes. Freezing drizzle (56/57) and freezing rain (66/67) get their own
  // wording rather than collapsing into plain rain - that is the distinction
  // that actually matters before you walk outside.
  function wmo(code, isDay) {
    if (code === 0) return [isDay ? SUN : MOON, isDay ? "clear" : "clear night"];
    if (code <= 2) return [PCLD, "partly cloudy"];
    if (code === 3) return [CLOUD, "overcast"];
    if (code <= 48) return [FOG, "fog"];
    if (code <= 55) return [RAIN, "drizzle"];
    if (code <= 57) return [SNOW, "freezing drizzle"];
    if (code <= 65) return [RAIN, "rain"];
    if (code <= 67) return [SNOW, "freezing rain"];
    if (code <= 77) return [SNOW, "snow"];
    if (code <= 82) return [RAIN, "showers"];
    if (code <= 86) return [SNOW, "snow showers"];
    if (code <= 94) return [STORM, "thunderstorm"];
    return [STORM, "thunderstorm, hail"];
  }

  // --- scrim -------------------------------------------------------------
  // Darkens the album-art gradient for legibility. z-index 5 is the trick: the
  // app's content lives in a stacking context at z-10 and GradientBackground
  // paints below that at auto, so a body-level element at 5 lands BETWEEN them -
  // darkening the background without dimming the clock drawn on top of it.
  // Anything >= 10 would sit over the clock and make it worse, not better.
  var scrim = document.createElement("div");
  scrim.id = "nocturne-weather-scrim";
  scrim.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:5",
    "pointer-events:none",
    "display:none",
    "background:radial-gradient(ellipse 78% 62% at 50% 52%," +
      "rgba(0,0,0,.62) 0%,rgba(0,0,0,.45) 45%,rgba(0,0,0,.18) 72%,transparent 100%)",
  ].join(";");
  document.body.appendChild(scrim);

  // --- overlay element ---------------------------------------------------
  var el = document.createElement("div");
  el.id = "nocturne-weather";
  el.style.cssText = [
    "position:fixed",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:30",              // clears all in-app layers (they are trapped in
                               // one stacking context), stays under the device
                               // switcher(40)/notifications(50)/voice(10000)/
                               // incoming call(20000)/sleep blackout(max)
    "pointer-events:none",     // MANDATORY: LockView owns swipe-to-skip and
                               // tap-to-play. An interactive overlay eats them.
    "display:none",
    "color:#fff",
    "text-shadow:0 2px 14px rgba(0,0,0,.75)",
    "font-variant-numeric:tabular-nums",
    "white-space:nowrap",
    "text-align:center",
    "line-height:1",
  ].join(";");
  document.body.appendChild(el);

  // Shift an epoch time by the location's UTC offset, then format in UTC - the
  // standard trick for rendering a specific timezone without a tz database.
  function fmtLocal(epochMs, opts, kind) {
    var off = last && typeof last.utcOffsetSeconds === "number" ? last.utcOffsetSeconds : 0;
    var d = new Date(epochMs + off * 1000);
    var o = {};
    for (var k in opts) o[k] = opts[k];
    o.timeZone = "UTC";
    return kind === "time" ? d.toLocaleTimeString(undefined, o) : d.toLocaleDateString(undefined, o);
  }

  function render() {
    if (!last) { el.innerHTML = ""; return; }
    var w = wmo(Number(last.code) || 0, last.isDay !== 0);
    var stale = last.fetchedAt && (Date.now() - last.fetchedAt > STALE_MS);
    // The device's system clock runs in UTC. Nocturne's clock only looks correct
    // because LockView pulls local time from the Pi via device.time.get. So
    // new Date() here would render UTC - which shows TOMORROW's date every
    // evening after 8pm EDT. Derive local time from the offset the Pi sends.
    var date = fmtLocal(Date.now(), { weekday: "long", month: "long", day: "numeric" }, "date");
    var dim = "rgba(255,255,255,.42)", soft = "rgba(255,255,255,.72)";

    el.innerHTML =
      '<div style="font-size:21px;font-weight:500;color:' + soft + ';margin-bottom:16px">' + date + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:16px">' +
        '<span style="display:block;opacity:' + (stale ? ".45" : "1") + '">' + w[0] + '</span>' +
        '<span style="font-size:44px;font-weight:600">' + Math.round(last.temp) + '\u00b0</span>' +
        '<span style="width:1px;height:32px;background:rgba(255,255,255,.18)"></span>' +
        '<span style="font-size:18px;color:' + soft + '">' + w[1] + '</span>' +
        '<span style="width:1px;height:32px;background:rgba(255,255,255,.18)"></span>' +
        '<span style="font-size:18px;color:' + soft + '">' + Math.round(last.high) + '\u00b0 ' +
          '<span style="color:' + dim + '">' + Math.round(last.low) + '\u00b0</span></span>' +
      '</div>' +
      (stale ? '<div style="font-size:12px;color:' + dim + ';margin-top:10px">weather unavailable \u2014 last reading ' +
                fmtLocal(last.fetchedAt, {hour:"numeric",minute:"2-digit"}, "time") + '</div>' : "");
  }

  // --- when to show ------------------------------------------------------
  // LockView is the only thing in the tree using text-[20vw]; Tailwind emits it
  // verbatim so the class is a stable handle. It is a React.lazy chunk, so it
  // mounts asynchronously - hence polling rather than a one-shot query at load.
  function lockClock() { return document.querySelector('[class~="text-[20vw]"]'); }

  // These cannot be beaten by z-index (the pairing PIN lives inside the app's
  // trapped stacking context), so they must be handled by hiding.
  function blocked() {
    return !!(document.querySelector('[class~="z-[20000]"]') ||   // incoming call
              document.querySelector('[class~="z-[100]"]') ||     // pairing PIN
              document.querySelector('#headlessui-portal-root > *'));
  }

  var lastSig = "";
  function update() {
    var clock = lockClock();
    if (!clock || blocked() || !last) {
      el.style.display = "none";
      scrim.style.display = "none";
      return;
    }
    scrim.style.display = "block";
    // Only rebuild the DOM when something actually changed. Re-rendering at the
    // poll rate would cause needless layout work on a device with a 192MB heap.
    var sig = [last.fetchedAt, last.temp, last.code, last.isDay, fmtLocal(Date.now(), { weekday:"short", month:"short", day:"numeric" }, "date"),
               Date.now() - last.fetchedAt > STALE_MS].join("|");
    if (sig !== lastSig) { render(); lastSig = sig; }
    el.style.display = "block";
    // Position under the real clock rather than guessing, so it survives any
    // future layout change to LockView.
    var r = clock.getBoundingClientRect();
    var top = Math.min(r.bottom + 18, window.innerHeight - 150);
    el.style.top = Math.round(top) + "px";
  }

  // Poll rather than MutationObserver. An observer on document.body with
  // subtree:true fires on every DOM change, and Nocturne mutates constantly
  // (ambient light readings alone are several per second) - measured on device,
  // an unthrottled observer drove load high enough to stall the main thread.
  // A 400ms poll is bounded, predictable, and imperceptible when you press lock.
  setInterval(update, 400);

  // --- data --------------------------------------------------------------
  function connect() {
    var ws;
    try { ws = new WebSocket("ws://localhost:5000"); } catch (e) { return setTimeout(connect, 15000); }

    function ask() {
      // The daemon silently drops requests whose id is not a UUID.
      var id = (crypto.randomUUID && crypto.randomUUID()) ||
               ("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
                 var r = (Math.random() * 16) | 0;
                 return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
               }));
      ws.__getId = id;
      try { ws.send(JSON.stringify({ type: "request", id: id, method: "weather.get", params: {} })); } catch (e) {}
    }

    ws.onopen = function () {
      ask();
      // Keep asking until we actually have a reading. A single request on open
      // is not enough: after a device reboot the page loads before the Bluetooth
      // link is up, so weather.get fails with "No active app session" and - with
      // one attempt only - the panel stays blank until the next 15-minute push.
      // Measured: exactly that happened on the first reboot test.
      ws.__retry = setInterval(function () {
        if (last) { clearInterval(ws.__retry); ws.__retry = null; return; }
        if (ws.readyState === 1) ask();
      }, 30000);
    };

    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      var d = null;
      if (m.type === "event" && m.topic === "weather.update") d = m.data;
      else if (m.type === "response" && m.id === ws.__getId) d = m.result;
      if (d && typeof d.temp === "number") { last = d; update(); }
    };

    // Never clear `last` on disconnect - stale weather beats a blank panel.
    ws.onclose = function () {
      if (ws.__retry) { clearInterval(ws.__retry); ws.__retry = null; }
      setTimeout(connect, 15000);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  connect();
})();
