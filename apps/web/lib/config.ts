import "server-only";

/**
 * Server-side configuration. Everything here is read from the environment so a
 * deployment never carries credentials in source.
 */

/** ICE servers handed to clients in the SSE `ready` event.
 *
 *  STUN alone gets you a direct path most of the time on a home LAN. TURN is
 *  what makes "watch the camera from cellular" actually work: roughly 10-20%
 *  of NAT combinations cannot be hole-punched, and symmetric-NAT carrier-grade
 *  NAT on mobile is a common offender. Configure it before trusting remote
 *  viewing — see docs/ARCHITECTURE.md.
 */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: process.env.STUN_URL ?? "stun:stun.l.google.com:19302" },
  ];

  const turnUrl = process.env.TURN_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl.split(",").map((s) => s.trim()),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

export function turnConfigured(): boolean {
  return Boolean(
    process.env.TURN_URL &&
      process.env.TURN_USERNAME &&
      process.env.TURN_CREDENTIAL,
  );
}

/**
 * Shared-secret gate for the signaling endpoints.
 *
 * M0a-grade auth: one token, checked with a constant-time compare. It exists so
 * a deployed instance is not an open relay that anyone who guesses a deviceId
 * can join. It is NOT the final design — M2 replaces it with per-device pairing
 * codes and per-viewer tokens so you can revoke one viewer without rotating the
 * camera. Left unset, the endpoints are open, which is fine on localhost only.
 */
export function signalToken(): string | null {
  return process.env.SIGNAL_TOKEN ?? null;
}

export function checkSignalAuth(request: Request): boolean {
  const expected = signalToken();
  if (!expected) return true; // dev / unconfigured

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(presented, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  // Length is not secret here (the token length is fixed by config), but we
  // still avoid an early return on the first differing byte.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
