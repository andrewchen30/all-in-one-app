import type { Role, SseEvent } from "@aio/protocol";

/**
 * A signaling broker moves small JSON messages between two peers that are each
 * holding an SSE stream open, and tracks who is currently connected.
 *
 * Why this is an interface rather than "just use a Map":
 *
 * Serverless functions scale horizontally. Two SSE subscriptions from the same
 * device can — and in production will — land on different function instances,
 * so in-process state cannot route a message from the viewer's instance to the
 * camera's. `MemoryBroker` is correct only in a single long-lived process
 * (`next dev`, or `next start` on one box). Anything multi-instance needs a
 * shared broker with pub/sub; see redis.ts.
 */
export interface SignalBroker {
  /** Deliver an event to one mailbox. Fire-and-forget: no delivery guarantee,
   *  which is fine because signaling is idempotent-ish and peers retry. */
  publish(deviceId: string, mailbox: string, event: SseEvent): Promise<void>;

  /** Listen on a mailbox. Resolves to an unsubscribe function. */
  subscribe(
    deviceId: string,
    mailbox: string,
    onEvent: (event: SseEvent) => void,
  ): Promise<() => void>;

  /** Refresh a session's liveness. Called on connect and on every heartbeat. */
  touch(deviceId: string, role: Role, sessionId: string): Promise<void>;

  /** Forget a session immediately (clean disconnect). */
  drop(deviceId: string, role: Role, sessionId: string): Promise<void>;

  presence(deviceId: string): Promise<Presence>;

  /** Notify every current subscriber of a device that presence changed. */
  broadcastPresence(deviceId: string): Promise<void>;
}

export interface Presence {
  cameraOnline: boolean;
  /** Epoch ms, or null if this device's camera has never checked in. */
  cameraLastSeen: number | null;
  viewerCount: number;
}

/** A mailbox address. The camera node has a single well-known mailbox per
 *  device; each viewer gets one keyed by its ephemeral session id. */
export const CAMERA_MAILBOX = "camera";
