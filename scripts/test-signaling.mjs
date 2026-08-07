// End-to-end test of the signaling layer: two SSE subscribers (a camera and a
// viewer) exchange a hello + offer + answer + ICE through the broker.
const BASE = "http://localhost:3000";
const DEVICE = "test-device";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function subscribe(role) {
  const res = await fetch(
    `${BASE}/api/signal/subscribe?deviceId=${DEVICE}&role=${role}`,
    { headers: { accept: "text/event-stream" } },
  );
  if (!res.ok) throw new Error(`${role} subscribe failed: ${res.status}`);

  const events = [];
  const waiters = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5).trim());
            events.push(ev);
            for (let i = waiters.length - 1; i >= 0; i--) {
              if (waiters[i].pred(ev)) {
                waiters[i].resolve(ev);
                waiters.splice(i, 1);
              }
            }
          }
        }
      }
    } catch {
      /* stream closed */
    }
  })();

  return {
    events,
    cancel: () => reader.cancel().catch(() => {}),
    wait(pred, ms = 4000) {
      const existing = events.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error("timeout waiting for event")), ms);
      });
    },
  };
}

async function send(to, msg) {
  const res = await fetch(`${BASE}/api/signal/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: DEVICE, to, msg }),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const camera = await subscribe("camera");
const camReady = await camera.wait((e) => e.t === "ready");
check("camera receives ready + sessionId", Boolean(camReady.sessionId));
check(
  "camera receives iceServers",
  Array.isArray(camReady.iceServers) && camReady.iceServers.length > 0,
  JSON.stringify(camReady.iceServers),
);

const viewer = await subscribe("viewer");
const viewReady = await viewer.wait((e) => e.t === "ready");
check("viewer receives ready", Boolean(viewReady.sessionId));

// The camera should be told a viewer joined.
const presence = await camera.wait(
  (e) => e.t === "presence" && e.viewerCount >= 1,
);
check("camera sees viewer in presence", presence.viewerCount >= 1, `count=${presence.viewerCount}`);
check("presence reports camera online", presence.cameraOnline === true);

// Viewer -> camera hello
await send("camera", { t: "hello", from: viewReady.sessionId, role: "viewer" });
const hello = await camera.wait((e) => e.t === "signal" && e.msg.t === "hello");
check("hello relayed viewer -> camera", hello.msg.from === viewReady.sessionId);

// Camera -> viewer offer (addressed to that viewer's session id only)
await send(viewReady.sessionId, {
  t: "offer",
  from: "camera",
  sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
});
const offer = await viewer.wait((e) => e.t === "signal" && e.msg.t === "offer");
check("offer relayed camera -> viewer", offer.msg.sdp.startsWith("v=0"));

// Viewer -> camera answer + ICE
await send("camera", { t: "answer", from: viewReady.sessionId, sdp: "v=0\r\nANSWER\r\n" });
const answer = await camera.wait((e) => e.t === "signal" && e.msg.t === "answer");
check("answer relayed viewer -> camera", answer.msg.sdp.includes("ANSWER"));

await send("camera", {
  t: "ice",
  from: viewReady.sessionId,
  candidate: { candidate: "candidate:1 1 udp 2130706431 192.168.1.5 54321 typ host", sdpMid: "0", sdpMLineIndex: 0 },
});
const ice = await camera.wait((e) => e.t === "signal" && e.msg.t === "ice");
check("ice candidate relayed", ice.msg.candidate.candidate.includes("typ host"));

// A second viewer must NOT receive the first viewer's mail.
const viewer2 = await subscribe("viewer");
await viewer2.wait((e) => e.t === "ready");
await send(viewReady.sessionId, { t: "bye", from: "camera", reason: "targeted" });
await viewer.wait((e) => e.t === "signal" && e.msg.t === "bye");
const leaked = viewer2.events.some((e) => e.t === "signal" && e.msg.t === "bye");
check("mailboxes are isolated between viewers", !leaked);

// Malformed payloads are rejected, not relayed.
const bad = await fetch(`${BASE}/api/signal/send`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceId: DEVICE, to: "camera", msg: { t: "nope" } }),
});
check("invalid signal message rejected with 400", bad.status === 400, `got ${bad.status}`);

// Presence must drop when the camera stream ends.
camera.cancel();
await new Promise((r) => setTimeout(r, 600));
const after = await viewer.wait(
  (e) => e.t === "presence" && e.cameraOnline === false,
  4000,
).catch(() => null);
check("camera going away flips presence offline", after !== null);

viewer.cancel();
viewer2.cancel();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
