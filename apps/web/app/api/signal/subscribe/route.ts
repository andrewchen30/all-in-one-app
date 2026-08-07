import {
  HEARTBEAT_INTERVAL_MS,
  Role,
  SSE_PING_INTERVAL_MS,
  type SseEvent,
} from "@aio/protocol";
import { broker, CAMERA_MAILBOX } from "@/lib/broker";
import { checkSignalAuth, iceServers } from "@/lib/config";

// Long-lived streaming response: must never be cached or prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Platform ceiling. The stream is cut when we hit it and the client reconnects;
// see SignalClient, which treats a clean end as "reconnect immediately".
export const maxDuration = 300;

/**
 * GET /api/signal/subscribe?deviceId=<id>&role=camera|viewer
 *
 * Opens the downstream half of signaling as Server-Sent Events. The upstream
 * half is POST /api/signal/send.
 *
 * Holding this stream open IS the liveness signal — there is no separate
 * heartbeat endpoint. While the stream lives we refresh the session's presence
 * on a timer, and presence expires PRESENCE_TTL_MS after the stream dies.
 */
export async function GET(request: Request): Promise<Response> {
  if (!checkSignalAuth(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId");
  const roleResult = Role.safeParse(url.searchParams.get("role"));

  if (!deviceId || !roleResult.success) {
    return new Response("deviceId and role are required", { status: 400 });
  }
  const role = roleResult.data;

  const sessionId = crypto.randomUUID();
  // The camera answers on a well-known address so a viewer can reach it
  // without discovery; viewers are addressed by their ephemeral session id.
  const mailbox = role === "camera" ? CAMERA_MAILBOX : sessionId;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Controller already closed (client vanished mid-write).
          closed = true;
        }
      };

      const teardown = async () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        if (ping) clearInterval(ping);
        await broker.drop(deviceId, role, sessionId);
        await broker.broadcastPresence(deviceId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", () => void teardown());

      unsubscribe = await broker.subscribe(deviceId, mailbox, send);
      await broker.touch(deviceId, role, sessionId);

      // Tell the client who it is and how to reach the network. ICE servers are
      // issued here rather than baked into client code so TURN credentials stay
      // server-side and can be rotated without a client release.
      send({ t: "ready", sessionId, iceServers: iceServers() as never });
      send({ t: "presence", ...(await broker.presence(deviceId)) });

      // Let everyone else know the population changed.
      await broker.broadcastPresence(deviceId);

      heartbeat = setInterval(() => {
        void broker.touch(deviceId, role, sessionId);
      }, HEARTBEAT_INTERVAL_MS);

      // Keeps intermediaries from reaping an idle connection, and gives the
      // client a positive signal that the stream is still healthy.
      ping = setInterval(() => send({ t: "ping" }), SSE_PING_INTERVAL_MS);
    },

    async cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      if (ping) clearInterval(ping);
      await broker.drop(deviceId, role, sessionId);
      await broker.broadcastPresence(deviceId);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disables response buffering on proxies that honour it; without this a
      // proxy may hold events until the stream ends, defeating the point.
      "x-accel-buffering": "no",
    },
  });
}
