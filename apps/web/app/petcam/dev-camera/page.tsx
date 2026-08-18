"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CameraFacing,
  CameraState,
  CommandEnvelope,
  QualityPreset,
} from "@aio/protocol";
import { SignalClient, type ConnectionStatus } from "@/lib/client/signal-client";
import { CameraPeer } from "@/lib/client/peer";

/**
 * Browser camera node — a TEST HARNESS, not a product surface.
 *
 * It implements the same signaling and control protocol the iOS camera node
 * will, using this machine's webcam. That means the entire pipeline (signaling,
 * ICE, media, DataChannel commands, state push) can be exercised end-to-end
 * before Xcode is even installed, and M1 becomes "swap the node implementation"
 * rather than "bring up everything at once and debug it blind".
 *
 * Where the browser cannot do what AVFoundation can — real optical zoom, focus
 * point of interest, thermal state — it reports honest capability flags instead
 * of faking success, so the viewer's disabled-state handling gets exercised too.
 */
const DIMENSIONS: Record<QualityPreset, { width: number; height: number; fps: number }> = {
  "480p15": { width: 854, height: 480, fps: 15 },
  "720p30": { width: 1280, height: 720, fps: 30 },
  "1080p30": { width: 1920, height: 1080, fps: 30 },
};

/**
 * A camera-free video source: an animated canvas captured as a MediaStream.
 *
 * Exists so the pipeline is testable where `getUserMedia` cannot be used —
 * sandboxed browsers, CI, or a machine with no webcam. The moving elements are
 * deliberate: a frame counter and a sweeping bar make it obvious at a glance
 * whether frames are actually arriving at the viewer, which a static test card
 * cannot tell you.
 */
function createSyntheticStream(
  facing: CameraFacing,
  quality: QualityPreset,
): { stream: MediaStream; stop: () => void } {
  const dim = DIMENSIONS[quality];
  const canvas = document.createElement("canvas");
  canvas.width = dim.width;
  canvas.height = dim.height;
  const ctx = canvas.getContext("2d")!;

  let frame = 0;
  const draw = () => {
    frame++;
    const t = frame / dim.fps;

    ctx.fillStyle = facing === "back" ? "#101820" : "#201018";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sweeping bar — smooth motion is the clearest signal that frames flow.
    const x = ((t * 0.25) % 1) * canvas.width;
    ctx.fillStyle = "#5b8cff";
    ctx.fillRect(x - 40, 0, 80, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(canvas.height / 10)}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("測試訊號源", canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = `${Math.round(canvas.height / 16)}px ui-monospace, monospace`;
    ctx.fillText(
      `${facing} · ${quality} · frame ${frame}`,
      canvas.width / 2,
      canvas.height / 2 + canvas.height / 10,
    );
  };

  draw();
  const timer = setInterval(draw, 1000 / dim.fps);
  const stream = canvas.captureStream(dim.fps);

  // A silent audio track so the audio negotiation path is exercised too;
  // without one, an m=audio section never appears in the SDP.
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0; // audible tones during testing get old fast
    osc.connect(gain).connect(dest);
    osc.start();
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  } catch {
    /* no AudioContext: video-only is still a useful test */
  }

  return {
    stream,
    stop: () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void audioCtx?.close();
    },
  };
}

export default function DevCameraPage() {
  const [deviceId, setDeviceId] = useState("");
  const [token, setToken] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setDeviceId(localStorage.getItem("aio.petcam.deviceId") ?? "home-cam");
    setToken(localStorage.getItem("aio.petcam.token") ?? "");
  }, []);

  if (!started) {
    return (
      <main className="mx-auto max-w-md px-5 py-12">
        <Link href="/petcam" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← 寵物攝影機
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">測試攝影機</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          用這台電腦的鏡頭模擬攝影機端，讓你在 iOS App 完成前就能驗證整條串流。
          在另一個分頁 / 另一台裝置開啟 <code className="text-neutral-400">/petcam</code>{" "}
          並輸入相同的裝置 ID 即可觀看。
        </p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            localStorage.setItem("aio.petcam.deviceId", deviceId.trim());
            localStorage.setItem("aio.petcam.token", token.trim());
            setStarted(true);
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs text-neutral-500">裝置 ID</span>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              autoCapitalize="none"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-neutral-500">
              Token（本機開發可留空）
            </span>
            <input
              value={token}
              type="password"
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <button
            type="submit"
            disabled={!deviceId.trim()}
            className="w-full rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            開始廣播
          </button>
        </form>
      </main>
    );
  }

  return <CameraNode deviceId={deviceId.trim()} token={token.trim()} />;
}

// ---------------------------------------------------------------------------

function CameraNode({ deviceId, token }: { deviceId: string; token: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<CameraPeer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Tears down the synthetic source's canvas timer and AudioContext. Stopping
   *  the tracks is not enough — the interval would keep drawing forever. */
  const syntheticStopRef = useRef<(() => void) | null>(null);
  const startedAt = useRef(Date.now());

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [viewers, setViewers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [usingSynthetic, setUsingSynthetic] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const stateRef = useRef<CameraState>({
    camera: "back",
    zoom: 1,
    zoomRange: [1, 1],
    switchOverFactors: [],
    zoomUiBaseline: 1,
    focusMode: "continuous",
    focusSupported: false,
    torchAvailable: false,
    torchOn: false,
    quality: "720p30",
    qualityAutoReduced: false,
    screenDim: false,
    battery: null,
    charging: false,
    thermal: "nominal",
    provisioningExpiresAt: null,
    appVersion: "dev-camera",
    uptimeSec: 0,
  });
  const [, forceRender] = useState(0);

  const pushState = useCallback(() => {
    stateRef.current.uptimeSec = (Date.now() - startedAt.current) / 1000;
    peerRef.current?.broadcast({ t: "state", state: stateRef.current });
    forceRender((n) => n + 1);
  }, []);

  const addLog = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 20));
  }, []);

  /** Acquire (or re-acquire) a source and reflect its real capabilities into the
   *  state we advertise, so the viewer disables what this node genuinely
   *  cannot do rather than showing controls that silently no-op.
   *
   *  Falls back to the synthetic canvas source when no camera is available, so
   *  the pipeline stays testable without a webcam or a permission grant. */
  const acquire = useCallback(
    async (facing: CameraFacing, quality: QualityPreset) => {
      const dim = DIMENSIONS[quality];

      // Release the previous source first — including the canvas timer, which
      // stopping tracks alone would leave running.
      syntheticStopRef.current?.();
      syntheticStopRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      let stream: MediaStream;
      let synthetic = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing === "back" ? "environment" : "user",
            width: { ideal: dim.width },
            height: { ideal: dim.height },
            frameRate: { ideal: dim.fps },
          },
          audio: true,
        });
      } catch (camErr) {
        const synth = createSyntheticStream(facing, quality);
        stream = synth.stream;
        syntheticStopRef.current = synth.stop;
        synthetic = true;
        addLog(
          `鏡頭不可用（${camErr instanceof Error ? camErr.name : "error"}），改用測試訊號源`,
        );
      }

      streamRef.current = stream;
      setUsingSynthetic(synthetic);
      if (videoRef.current) videoRef.current.srcObject = stream;

      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        zoom?: { min: number; max: number };
        torch?: boolean;
        focusMode?: string[];
      };

      const s = stateRef.current;
      s.camera = facing;
      s.quality = quality;
      s.zoomRange = caps.zoom ? [caps.zoom.min, caps.zoom.max] : [1, 1];
      s.zoom = caps.zoom ? caps.zoom.min : 1;
      s.zoomUiBaseline = caps.zoom ? caps.zoom.min : 1;
      s.switchOverFactors = [];
      s.torchAvailable = Boolean(caps.torch);
      s.torchOn = false;
      // Browsers expose focusMode but not a focus *point*; report unsupported
      // rather than accepting focusAt and doing nothing with it.
      s.focusSupported = false;

      return stream;
    },
    [],
  );

  const handleCommand = useCallback(
    async (env: CommandEnvelope) => {
      const s = stateRef.current;
      const track = streamRef.current?.getVideoTracks()[0];
      let ok = true;
      let err: string | undefined;

      try {
        switch (env.cmd.op) {
          case "switchCamera": {
            addLog(`switchCamera → ${env.cmd.value}`);
            const stream = await acquire(env.cmd.value, s.quality);
            await peerRef.current?.replaceStream(stream);
            break;
          }

          case "setQuality": {
            addLog(`setQuality → ${env.cmd.value}`);
            const stream = await acquire(s.camera, env.cmd.value);
            await peerRef.current?.replaceStream(stream);
            peerRef.current?.setQuality(env.cmd.value);
            break;
          }

          case "setZoom": {
            const [min, max] = s.zoomRange;
            const clamped = Math.min(max, Math.max(min, env.cmd.value));
            await track?.applyConstraints({
              advanced: [{ zoom: clamped } as MediaTrackConstraintSet],
            });
            s.zoom = clamped;
            addLog(`setZoom → ${clamped.toFixed(2)}`);
            break;
          }

          case "setTorch": {
            if (!s.torchAvailable) {
              ok = false;
              err = "torch unavailable";
              break;
            }
            await track?.applyConstraints({
              advanced: [{ torch: env.cmd.value } as MediaTrackConstraintSet],
            });
            s.torchOn = env.cmd.value;
            break;
          }

          case "focusAt":
            // Honest failure: no focus-point API in the browser.
            ok = false;
            err = "focus point not supported by this node";
            addLog(`focusAt 被拒（瀏覽器不支援對焦點）`);
            break;

          case "setFocusMode":
            s.focusMode = env.cmd.value;
            break;

          case "setScreenDim":
            s.screenDim = env.cmd.value;
            break;

          case "requestState":
            break;
        }
      } catch (e) {
        ok = false;
        err = e instanceof Error ? e.message : String(e);
        addLog(`指令失敗: ${err}`);
      }

      peerRef.current?.broadcast({ t: "ack", id: env.id, ok, error: err });
      pushState();
    },
    [acquire, addLog, pushState],
  );

  useEffect(() => {
    let client: SignalClient | null = null;
    let peer: CameraPeer | null = null;
    let cancelled = false;

    (async () => {
      try {
        await acquire("back", "720p30");
      } catch (e) {
        // acquire falls back to the synthetic source, so reaching here means
        // something worse than a missing camera.
        setError(e instanceof Error ? e.message : "無法建立影像來源");
        return;
      }
      if (cancelled) return;

      client = new SignalClient({
        deviceId,
        role: "camera",
        token: token || undefined,
        onStatus: setStatus,
        onPresence: (p) => setViewers(p.viewerCount),
        onReady: (_sessionId, iceServers) => {
          peer?.closeAll();
          peer = new CameraPeer({
            sessionId: "camera",
            iceServers,
            // Read the live stream at offer time: switching camera or quality
            // replaces it, and a captured value would go stale.
            getStream: () => streamRef.current!,
            send: (to, msg) => client!.send(to, msg),
            onCommand: (env) => void handleCommand(env),
            onViewerCountChange: (n) => {
              setViewers(n);
              // A newly attached viewer needs the current state before it can
              // render controls; push on every membership change.
              setTimeout(pushState, 250);
            },
          });
          peerRef.current = peer;
          addLog("signaling 就緒，等待觀看端");
        },
        onSignal: (msg) => void peer?.handleSignal(msg),
      });

      client.start();
    })();

    return () => {
      cancelled = true;
      client?.stop();
      peer?.closeAll();
      syntheticStopRef.current?.();
      syntheticStopRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      peerRef.current = null;
    };
  }, [deviceId, token, acquire, handleCommand, pushState, addLog]);

  // Periodic state push doubles as a liveness signal on the control channel.
  useEffect(() => {
    const timer = setInterval(pushState, 5000);
    return () => clearInterval(timer);
  }, [pushState]);

  const s = stateRef.current;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/petcam" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← 寵物攝影機
      </Link>

      <div className="mt-4 rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
        測試用途 — 這是 iOS 攝影機端完成前的替身，用來驗證協定與串流。
      </div>

      {error ? (
        <p className="mt-6 text-sm text-[var(--color-danger)]">{error}</p>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="mt-4 w-full rounded-2xl border border-[var(--color-line)] bg-black"
          />

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <Stat label="裝置 ID" value={deviceId} />
            <Stat label="訊號通道" value={status} />
            <Stat label="觀看中" value={String(viewers)} />
            <Stat label="來源" value={usingSynthetic ? "測試訊號源" : "實體鏡頭"} />
            <Stat label="鏡頭" value={s.camera === "back" ? "後" : "前"} />
            <Stat label="畫質" value={s.quality} />
            <Stat
              label="Zoom"
              value={`${s.zoom.toFixed(2)} (${s.zoomRange[0]}–${s.zoomRange[1]})`}
            />
            <Stat label="手電筒" value={s.torchAvailable ? (s.torchOn ? "開" : "可用") : "不支援"} />
            <Stat label="對焦點" value={s.focusSupported ? "支援" : "不支援"} />
          </dl>

          <h2 className="mt-6 text-xs font-medium text-neutral-500">事件</h2>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-neutral-600">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-600">{label}</dt>
      <dd className="text-neutral-300">{value}</dd>
    </div>
  );
}
