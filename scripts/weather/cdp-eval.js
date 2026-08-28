#!/usr/bin/env bun
// Evaluate an expression in the Car Thing's Chromium page and print the result.
//
// Raw WebSocket on purpose: Playwright's connectOverCDP is known to hang against
// this cast_shell build (it never finishes the Target.* handshake). A plain
// socket speaking Runtime.evaluate works fine.
//
// Usage:  bun cdp-eval.js '<js expression>'
// Assumes an SSH tunnel:  ssh -fN -L 9223:127.0.0.1:9223 root@10.42.1.90

const PORT = process.env.CDP_PORT || 9223;
const expression = process.argv[2];
if (!expression) { console.error("usage: bun cdp-eval.js '<expr>'"); process.exit(2); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target"); process.exit(1); }

// The debugger URL comes back pointing at 127.0.0.1 which is correct through the
// tunnel - do not rewrite the host.
const ws = new WebSocket(page.webSocketDebuggerUrl);

const done = (code) => { try { ws.close(); } catch {} process.exit(code); };
const timer = setTimeout(() => { console.error("timeout waiting for CDP"); done(3); }, Number(process.env.CDP_TIMEOUT || 90000));

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== 1) return;                       // ignore unsolicited events
  clearTimeout(timer);
  if (msg.error) { console.error("CDP error:", JSON.stringify(msg.error)); return done(1); }
  const r = msg.result;
  if (r?.exceptionDetails) {
    console.error("page threw:", r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return done(1);
  }
  const v = r?.result?.value;
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  done(0);
};

ws.onerror = (e) => { console.error("ws error:", e?.message || e); done(1); };
