import { PRESENCE_TTL_MS, type Role, type SseEvent } from "@aio/protocol";
import {
  CAMERA_MAILBOX,
  type Presence,
  type SignalBroker,
} from "./types";

type Listener = (event: SseEvent) => void;

interface DeviceState {
  /** mailbox -> listeners. A mailbox may briefly have two listeners while a
   *  client reconnects before the old stream is reaped. */
  mailboxes: Map<string, Set<Listener>>;
  /** sessionId -> last-seen epoch ms, per role. */
  camera: Map<string, number>;
  viewers: Map<string, number>;
}

/**
 * Single-process broker. Correct for `next dev` and for a single-instance
 * deployment; see types.ts for why that caveat matters.
 *
 * Held on globalThis so Next.js hot-reload does not orphan live SSE streams by
 * swapping in a fresh module instance underneath them.
 */
const store: Map<string, DeviceState> = (globalThis as any).__aioBroker ??
  ((globalThis as any).__aioBroker = new Map<string, DeviceState>());

function device(deviceId: string): DeviceState {
  let d = store.get(deviceId);
  if (!d) {
    d = { mailboxes: new Map(), camera: new Map(), viewers: new Map() };
    store.set(deviceId, d);
  }
  return d;
}

function prune(d: DeviceState): void {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [id, seen] of d.camera) if (seen < cutoff) d.camera.delete(id);
  for (const [id, seen] of d.viewers) if (seen < cutoff) d.viewers.delete(id);
}

export class MemoryBroker implements SignalBroker {
  async publish(
    deviceId: string,
    mailbox: string,
    event: SseEvent,
  ): Promise<void> {
    const listeners = device(deviceId).mailboxes.get(mailbox);
    if (!listeners) return;
    for (const listener of listeners) {
      // One misbehaving stream must not stop delivery to the others.
      try {
        listener(event);
      } catch {
        /* stream already closed; the reaper will clean it up */
      }
    }
  }

  async subscribe(
    deviceId: string,
    mailbox: string,
    onEvent: Listener,
  ): Promise<() => void> {
    const d = device(deviceId);
    let listeners = d.mailboxes.get(mailbox);
    if (!listeners) {
      listeners = new Set();
      d.mailboxes.set(mailbox, listeners);
    }
    listeners.add(onEvent);

    return () => {
      listeners.delete(onEvent);
      if (listeners.size === 0) d.mailboxes.delete(mailbox);
    };
  }

  async touch(deviceId: string, role: Role, sessionId: string): Promise<void> {
    const d = device(deviceId);
    const map = role === "camera" ? d.camera : d.viewers;
    map.set(sessionId, Date.now());
  }

  async drop(deviceId: string, role: Role, sessionId: string): Promise<void> {
    const d = device(deviceId);
    (role === "camera" ? d.camera : d.viewers).delete(sessionId);
  }

  async presence(deviceId: string): Promise<Presence> {
    const d = device(deviceId);
    prune(d);
    const lastSeen = Math.max(0, ...d.camera.values());
    return {
      cameraOnline: d.camera.size > 0,
      cameraLastSeen: lastSeen > 0 ? lastSeen : null,
      viewerCount: d.viewers.size,
    };
  }

  async broadcastPresence(deviceId: string): Promise<void> {
    const p = await this.presence(deviceId);
    const event: SseEvent = { t: "presence", ...p };
    const d = device(deviceId);
    for (const mailbox of [...d.mailboxes.keys()]) {
      await this.publish(deviceId, mailbox, event);
    }
  }
}

export { CAMERA_MAILBOX };
