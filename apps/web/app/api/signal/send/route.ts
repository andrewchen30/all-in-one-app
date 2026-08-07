import { SendRequest } from "@aio/protocol";
import { broker } from "@/lib/broker";
import { checkSignalAuth } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/signal/send
 *
 * Upstream half of signaling. Body is a SendRequest: which device, which
 * mailbox, and the SignalMessage to drop in it.
 *
 * The server does not interpret SDP or ICE candidates — it is a dumb relay, so
 * a WebRTC change on the peers never requires a server deploy.
 */
export async function POST(request: Request): Promise<Response> {
  if (!checkSignalAuth(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = SendRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { deviceId, to, msg } = parsed.data;
  await broker.publish(deviceId, to, { t: "signal", msg });

  // Fire-and-forget by design: if nobody is listening on `to`, the message is
  // dropped and the sender retries. Reporting "delivered" here would be a lie,
  // since delivery to an SSE stream is not an acknowledgement of processing.
  return Response.json({ ok: true });
}
