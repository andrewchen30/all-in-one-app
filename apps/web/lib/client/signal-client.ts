"use client";

import {
  parseSseEvent,
  type PresenceEvent,
  type Role,
  type SignalMessage,
} from "@aio/protocol";

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline";

export interface SignalClientOptions {
  deviceId: string;
  role: Role;
  /** Bearer token for the signaling endpoints. Omit on localhost. */
  token?: string;
  onReady: (sessionId: string, iceServers: RTCIceServer[]) => void;
  onPresence: (presence: Omit<PresenceEvent, "t">) => void;
  onSignal: (msg: SignalMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
}

/**
 * Downstream SSE + upstream POST signaling client.
 *
 * Uses fetch + ReadableStream rather than the built-in EventSource, because
 * EventSource cannot set an Authorization header — the alternative would be
 * putting the bearer token in the query string, where it lands in access logs
 * and browser history. The cost is that reconnection is ours to implement,
 * which we want anyway: the server caps streams at maxDuration, so a clean end
 * of stream is routine and must reconnect immediately rather than back off.
 */
export class SignalClient {
  private readonly opts: SignalClientOptions;
  private abort: AbortController | null = null;
  private retryDelay = INITIAL_RETRY_MS;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  sessionId: string | null = null;

  constructor(opts: SignalClientOptions) {
    this.opts = opts;
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.abort?.abort();
    this.opts.onStatus("idle");
  }

  /** Send a signaling message to a mailbox ("camera" or a viewer session id). */
  async send(to: string, msg: SignalMessage): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;

    const res = await fetch("/api/signal/send", {
      method: "POST",
      headers,
      body: JSON.stringify({ deviceId: this.opts.deviceId, to, msg }),
    });

    if (!res.ok) {
      throw new Error(`signal send failed: ${res.status} ${await res.text()}`);
    }
  }

  // -------------------------------------------------------------------------

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let endedCleanly = false;

      try {
        this.opts.onStatus("connecting");
        endedCleanly = await this.readStream();
        // Reaching here means the server closed the stream, which it does
        // routinely at maxDuration. Treat it as expected, not as a failure.
        this.retryDelay = INITIAL_RETRY_MS;
      } catch (err) {
        if (this.stopped) return;
        this.opts.onStatus("offline");
        // Genuine failure (network down, 401, server error): back off.
        endedCleanly = false;
      }

      if (this.stopped) return;

      const delay = endedCleanly ? 0 : this.retryDelay;
      if (!endedCleanly) {
        this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
      }
      await this.sleep(delay);
    }
  }

  /** @returns true if the server ended the stream cleanly. */
  private async readStream(): Promise<boolean> {
    this.abort = new AbortController();

    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;

    const params = new URLSearchParams({
      deviceId: this.opts.deviceId,
      role: this.opts.role,
    });

    const res = await fetch(`/api/signal/subscribe?${params}`, {
      headers,
      signal: this.abort.signal,
      cache: "no-store",
    });

    if (!res.ok || !res.body) {
      throw new Error(`subscribe failed: ${res.status}`);
    }

    this.opts.onStatus("online");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. Anything after the last
      // separator is a partial frame and stays in the buffer.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        this.handleFrame(frame);
      }
    }
  }

  private handleFrame(frame: string): void {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;

      const event = parseSseEvent(line.slice(5).trim());
      // Unknown or malformed events are ignored on purpose: a newer server
      // must be able to add event types without breaking older clients.
      if (!event) continue;

      switch (event.t) {
        case "ready":
          this.sessionId = event.sessionId;
          this.opts.onReady(event.sessionId, event.iceServers as RTCIceServer[]);
          break;
        case "presence":
          this.opts.onPresence({
            cameraOnline: event.cameraOnline,
            cameraLastSeen: event.cameraLastSeen,
            viewerCount: event.viewerCount,
          });
          break;
        case "signal":
          this.opts.onSignal(event.msg);
          break;
        case "ping":
          break;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    if (ms === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.retryTimer = setTimeout(resolve, ms);
    });
  }
}

const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 8_000;
