"use client";

import {
  BITRATE_BY_PRESET,
  CONTROL_CHANNEL_LABEL,
  type CameraMessage,
  type CommandEnvelope,
  type QualityPreset,
  type SignalMessage,
} from "@aio/protocol";

export type PeerState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

type SendSignal = (to: string, msg: SignalMessage) => Promise<void>;

/**
 * Buffers ICE candidates that arrive before setRemoteDescription.
 *
 * This is not a rare edge case: the remote peer starts trickling candidates the
 * instant it sets its local description, and on a fast local network those can
 * beat the SDP through the relay. Adding a candidate with no remote description
 * throws, and a dropped candidate can be the one that would have connected.
 */
class CandidateQueue {
  private pending: RTCIceCandidateInit[] = [];
  private ready = false;

  constructor(private readonly pc: RTCPeerConnection) {}

  async add(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.ready) {
      this.pending.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate).catch(() => {
      /* a rejected candidate is survivable; others may still connect */
    });
  }

  async flush(): Promise<void> {
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    for (const c of queued) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }
}

function attachIceForwarding(
  pc: RTCPeerConnection,
  from: string,
  to: string,
  send: SendSignal,
): void {
  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return; // null signals end-of-candidates
    void send(to, {
      t: "ice",
      from,
      candidate: {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex,
        usernameFragment: ev.candidate.usernameFragment,
      },
    }).catch(() => {});
  };
}

// ---------------------------------------------------------------------------
// Camera side
// ---------------------------------------------------------------------------

interface CameraPeerOptions {
  sessionId: string;
  iceServers: RTCIceServer[];
  stream: MediaStream;
  send: SendSignal;
  onCommand: (envelope: CommandEnvelope) => void;
  onViewerCountChange: (count: number) => void;
}

/**
 * The camera holds one RTCPeerConnection per viewer and is always the offerer.
 *
 * Camera-offers rather than viewer-offers because the camera owns the media and
 * the control DataChannel; making it the single offerer sidesteps glare
 * entirely, so we do not need perfect-negotiation machinery for a topology that
 * is only ever one-to-few.
 */
export class CameraPeer {
  private readonly peers = new Map<
    string,
    { pc: RTCPeerConnection; candidates: CandidateQueue; channel?: RTCDataChannel }
  >();
  private quality: QualityPreset = "720p30";

  constructor(private readonly opts: CameraPeerOptions) {}

  async handleSignal(msg: SignalMessage): Promise<void> {
    switch (msg.t) {
      case "hello":
        await this.offerTo(msg.from);
        break;

      case "answer": {
        const entry = this.peers.get(msg.from);
        if (!entry) return;
        await entry.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        await entry.candidates.flush();
        break;
      }

      case "ice": {
        const entry = this.peers.get(msg.from);
        if (!entry) return;
        await entry.candidates.add(msg.candidate as RTCIceCandidateInit);
        break;
      }

      case "bye":
        this.close(msg.from);
        break;

      case "offer":
        // The camera is always the offerer; an inbound offer means a peer is
        // misbehaving or running an incompatible build. Ignore it.
        break;
    }
  }

  private async offerTo(viewerId: string): Promise<void> {
    // A viewer that says hello again has lost its connection; replace the old
    // peer outright rather than trying to renegotiate a possibly-dead one.
    this.close(viewerId);

    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    const candidates = new CandidateQueue(pc);
    const entry = { pc, candidates } as {
      pc: RTCPeerConnection;
      candidates: CandidateQueue;
      channel?: RTCDataChannel;
    };
    this.peers.set(viewerId, entry);
    this.opts.onViewerCountChange(this.peers.size);

    for (const track of this.opts.stream.getTracks()) {
      pc.addTrack(track, this.opts.stream);
    }

    const channel = pc.createDataChannel(CONTROL_CHANNEL_LABEL, {
      ordered: true,
    });
    channel.onmessage = (ev) => {
      try {
        this.opts.onCommand(JSON.parse(ev.data as string) as CommandEnvelope);
      } catch {
        /* malformed control frame: ignore, never fatal */
      }
    };
    entry.channel = channel;

    attachIceForwarding(pc, "camera", viewerId, this.opts.send);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.close(viewerId);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.applyBitrateCap(pc);

    await this.opts.send(viewerId, {
      t: "offer",
      from: "camera",
      sdp: offer.sdp ?? "",
    });
  }

  /**
   * Pin the video sender's max bitrate instead of letting bandwidth estimation
   * probe upwards. The viewer is usually on cellular and the camera on home
   * upstream; unbounded probing produces a sawtooth that reads as "laggy" far
   * more than a steady, lower bitrate does.
   */
  private async applyBitrateCap(pc: RTCPeerConnection): Promise<void> {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0]!.maxBitrate = BITRATE_BY_PRESET[this.quality];
    await sender.setParameters(params).catch(() => {
      /* unsupported on some browsers; the stream still works */
    });
  }

  setQuality(preset: QualityPreset): void {
    this.quality = preset;
    for (const { pc } of this.peers.values()) void this.applyBitrateCap(pc);
  }

  /** Push a state snapshot or ack to every connected viewer. */
  broadcast(message: CameraMessage): void {
    const payload = JSON.stringify(message);
    for (const { channel } of this.peers.values()) {
      if (channel?.readyState === "open") {
        try {
          channel.send(payload);
        } catch {
          /* channel closing */
        }
      }
    }
  }

  /** Swap the outgoing tracks without renegotiating, so switching the camera
   *  does not drop the stream. */
  async replaceStream(stream: MediaStream): Promise<void> {
    for (const { pc } of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        const kind = sender.track?.kind;
        const next = stream.getTracks().find((t) => t.kind === kind);
        if (next) await sender.replaceTrack(next).catch(() => {});
      }
    }
  }

  close(viewerId: string): void {
    const entry = this.peers.get(viewerId);
    if (!entry) return;
    entry.channel?.close();
    entry.pc.close();
    this.peers.delete(viewerId);
    this.opts.onViewerCountChange(this.peers.size);
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.close(id);
  }

  get viewerCount(): number {
    return this.peers.size;
  }
}

// ---------------------------------------------------------------------------
// Viewer side
// ---------------------------------------------------------------------------

interface ViewerPeerOptions {
  sessionId: string;
  iceServers: RTCIceServer[];
  send: SendSignal;
  onStream: (stream: MediaStream) => void;
  onCameraMessage: (msg: CameraMessage) => void;
  onState: (state: PeerState) => void;
}

export class ViewerPeer {
  private pc: RTCPeerConnection | null = null;
  private candidates: CandidateQueue | null = null;
  private channel: RTCDataChannel | null = null;

  constructor(private readonly opts: ViewerPeerOptions) {}

  /** Announce ourselves; the camera responds with an offer. */
  async hello(): Promise<void> {
    await this.opts.send("camera", {
      t: "hello",
      from: this.opts.sessionId,
      role: "viewer",
    });
  }

  async handleSignal(msg: SignalMessage): Promise<void> {
    switch (msg.t) {
      case "offer":
        await this.acceptOffer(msg.sdp);
        break;

      case "ice":
        await this.candidates?.add(msg.candidate as RTCIceCandidateInit);
        break;

      case "bye":
        this.close();
        break;

      case "answer":
      case "hello":
        break;
    }
  }

  private async acceptOffer(sdp: string): Promise<void> {
    this.close();

    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    this.pc = pc;
    this.candidates = new CandidateQueue(pc);

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream) this.opts.onStream(stream);
    };

    pc.ondatachannel = (ev) => {
      if (ev.channel.label !== CONTROL_CHANNEL_LABEL) return;
      this.channel = ev.channel;
      ev.channel.onmessage = (m) => {
        try {
          this.opts.onCameraMessage(JSON.parse(m.data as string) as CameraMessage);
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    pc.onconnectionstatechange = () => {
      this.opts.onState((pc.connectionState ?? "new") as PeerState);
    };

    attachIceForwarding(pc, this.opts.sessionId, "camera", this.opts.send);

    await pc.setRemoteDescription({ type: "offer", sdp });
    await this.candidates.flush();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.opts.send("camera", {
      t: "answer",
      from: this.opts.sessionId,
      sdp: answer.sdp ?? "",
    });
  }

  sendCommand(envelope: CommandEnvelope): boolean {
    if (this.channel?.readyState !== "open") return false;
    try {
      this.channel.send(JSON.stringify(envelope));
      return true;
    } catch {
      return false;
    }
  }

  /** Live ICE diagnostics — which candidate pair won, and whether it is a TURN
   *  relay. Without this you cannot tell "TURN is working" from "TURN was never
   *  needed", which is the single most confusing thing about WebRTC debugging. */
  async selectedCandidatePair(): Promise<{
    local: string;
    remote: string;
    relayed: boolean;
  } | null> {
    if (!this.pc) return null;
    const stats = await this.pc.getStats();

    let pair: RTCIceCandidatePairStats | null = null;
    stats.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        (report as RTCIceCandidatePairStats).state === "succeeded" &&
        (report as { nominated?: boolean }).nominated
      ) {
        pair = report as RTCIceCandidatePairStats;
      }
    });
    if (!pair) return null;

    const local = stats.get((pair as RTCIceCandidatePairStats).localCandidateId);
    const remote = stats.get((pair as RTCIceCandidatePairStats).remoteCandidateId);

    return {
      local: local?.candidateType ?? "?",
      remote: remote?.candidateType ?? "?",
      relayed: local?.candidateType === "relay" || remote?.candidateType === "relay",
    };
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
    this.candidates = null;
  }
}
