import { z } from "zod";

/**
 * Signaling protocol — carried over HTTP.
 *
 * Transport shape: SSE downstream (`GET /api/signal/subscribe`) + JSON POST
 * upstream (`POST /api/signal/send`). Deliberately NOT WebSocket:
 *
 *  - Serverless functions are short-lived and horizontally scaled, so a raw WS
 *    would need a shared broker anyway. SSE + POST needs the same broker but
 *    is trivially debuggable with curl and reconnects for free in browsers.
 *  - Signaling volume is a handful of messages per session; the only thing
 *    that must be long-lived is the camera's *presence*, which is a heartbeat.
 */

export const Role = z.enum(["camera", "viewer"]);
export type Role = z.infer<typeof Role>;

/** Envelope every signaling message shares. `from` is the sender's ephemeral
 *  session id (not the device id) so a camera can answer one specific viewer. */
const base = {
  from: z.string().min(1).max(64),
};

export const SignalMessage = z.discriminatedUnion("t", [
  /** Sent by a viewer to announce itself; the camera replies with an offer. */
  z.object({ ...base, t: z.literal("hello"), role: Role }),

  z.object({ ...base, t: z.literal("offer"), sdp: z.string() }),
  z.object({ ...base, t: z.literal("answer"), sdp: z.string() }),

  z.object({
    ...base,
    t: z.literal("ice"),
    candidate: z.object({
      candidate: z.string(),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    }),
  }),

  /** Graceful teardown so the other side drops the peer immediately instead of
   *  waiting for an ICE timeout. */
  z.object({ ...base, t: z.literal("bye"), reason: z.string().optional() }),
]);
export type SignalMessage = z.infer<typeof SignalMessage>;

/** POST /api/signal/send body. `to` selects the mailbox:
 *   - "camera"      → the device's single camera node
 *   - a session id  → one specific viewer */
export const SendRequest = z.object({
  deviceId: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  msg: SignalMessage,
});
export type SendRequest = z.infer<typeof SendRequest>;

// ---------------------------------------------------------------------------
// Server -> client SSE events
// ---------------------------------------------------------------------------

export const PresenceEvent = z.object({
  t: z.literal("presence"),
  cameraOnline: z.boolean(),
  /** Epoch ms of the camera's last heartbeat, null if never seen. */
  cameraLastSeen: z.number().nullable(),
  viewerCount: z.number(),
});
export type PresenceEvent = z.infer<typeof PresenceEvent>;

export const ReadyEvent = z.object({
  t: z.literal("ready"),
  /** The ephemeral session id the server assigned to this subscription. */
  sessionId: z.string(),
  /** ICE servers to use, including short-lived TURN credentials when
   *  configured. Handed out here so credentials never sit in client code. */
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
});
export type ReadyEvent = z.infer<typeof ReadyEvent>;

export const SseEvent = z.discriminatedUnion("t", [
  ReadyEvent,
  PresenceEvent,
  z.object({ t: z.literal("signal"), msg: SignalMessage }),
  z.object({ t: z.literal("ping") }),
]);
export type SseEvent = z.infer<typeof SseEvent>;

export function parseSseEvent(raw: string): SseEvent | null {
  try {
    const result = SseEvent.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Camera presence is considered stale after this long without a heartbeat.
 *  Must be comfortably longer than HEARTBEAT_INTERVAL_MS to tolerate a
 *  cellular hiccup without flapping the viewer's "offline" badge. */
export const PRESENCE_TTL_MS = 45_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** SSE keepalive. Also bounds how long a stream sits idle before the platform
 *  may reap it; clients reconnect transparently. */
export const SSE_PING_INTERVAL_MS = 20_000;
