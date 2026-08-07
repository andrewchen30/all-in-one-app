"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  QualityPreset,
  zoomLabel,
  type CameraFacing,
  type CameraState,
  type Command,
} from "@aio/protocol";
import { SignalClient, type ConnectionStatus } from "@/lib/client/signal-client";
import { ViewerPeer, type PeerState } from "@/lib/client/peer";

const LS_DEVICE = "aio.petcam.deviceId";
const LS_TOKEN = "aio.petcam.token";

export default function PetCamPage() {
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setDeviceId(localStorage.getItem(LS_DEVICE) ?? "");
    setToken(localStorage.getItem(LS_TOKEN) ?? "");
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!connected) {
    return (
      <main className="mx-auto max-w-md px-5 py-12">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← 工具庫
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">寵物攝影機</h1>
        <p className="mt-2 text-sm text-neutral-500">
          輸入攝影機端顯示的裝置 ID 開始觀看。
        </p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!deviceId.trim()) return;
            localStorage.setItem(LS_DEVICE, deviceId.trim());
            localStorage.setItem(LS_TOKEN, token.trim());
            setConnected(true);
          }}
        >
          <Field label="裝置 ID">
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="例如 home-cam"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
            />
          </Field>
          <Field label="Token（本機開發可留空）">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
            />
          </Field>
          <button
            type="submit"
            className="w-full rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white disabled:opacity-40"
            disabled={!deviceId.trim()}
          >
            連線
          </button>
        </form>

        <p className="mt-8 text-xs leading-relaxed text-neutral-600">
          還沒有 iOS 攝影機端？M0a 附了一個瀏覽器版的測試攝影機：
          <Link href="/petcam/dev-camera" className="ml-1 text-neutral-400 underline">
            /petcam/dev-camera
          </Link>
        </p>
      </main>
    );
  }

  return <Viewer deviceId={deviceId.trim()} token={token.trim()} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------

function Viewer({ deviceId, token }: { deviceId: string; token: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<ViewerPeer | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [peerState, setPeerState] = useState<PeerState>("new");
  const [cameraOnline, setCameraOnline] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [state, setState] = useState<CameraState | null>(null);
  const [muted, setMuted] = useState(true);
  const [icePath, setIcePath] = useState<string | null>(null);
  const [focusPulse, setFocusPulse] = useState<{ x: number; y: number } | null>(null);

  /** Optimistic zoom. The device round-trip is ~200-400ms; scaling the <video>
   *  locally makes the gesture feel instant, and we drop back to 1 as soon as
   *  the camera confirms the new factor and real pixels arrive. */
  const [zoomPreview, setZoomPreview] = useState(1);

  useEffect(() => {
    let peer: ViewerPeer | null = null;

    const client = new SignalClient({
      deviceId,
      role: "viewer",
      token: token || undefined,
      onStatus: setStatus,
      onPresence: (p) => {
        setCameraOnline(p.cameraOnline);
        setLastSeen(p.cameraLastSeen);
      },
      onReady: (sessionId, iceServers) => {
        peer?.close();
        peer = new ViewerPeer({
          sessionId,
          iceServers,
          send: (to, msg) => client.send(to, msg),
          onStream: (stream) => {
            if (videoRef.current) videoRef.current.srcObject = stream;
          },
          onCameraMessage: (msg) => {
            if (msg.t === "state") {
              setState(msg.state);
              setZoomPreview(1); // real zoom landed; drop the CSS stand-in
            }
          },
          onState: setPeerState,
        });
        peerRef.current = peer;
        void peer.hello();
      },
      onSignal: (msg) => void peer?.handleSignal(msg),
    });

    client.start();

    return () => {
      client.stop();
      peer?.close();
      peerRef.current = null;
    };
  }, [deviceId, token]);

  // Surface which ICE path won. Without this you cannot distinguish "TURN is
  // working" from "TURN was never exercised", which matters a lot the first
  // time you try to watch from cellular.
  useEffect(() => {
    if (peerState !== "connected") return;
    const timer = setInterval(async () => {
      const pair = await peerRef.current?.selectedCandidatePair();
      if (pair) {
        setIcePath(
          `${pair.local}/${pair.remote}${pair.relayed ? " · TURN 中繼" : " · 直連"}`,
        );
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [peerState]);

  const send = useCallback((cmd: Command) => {
    peerRef.current?.sendCommand({
      t: "cmd",
      id: crypto.randomUUID(),
      cmd,
    });
  }, []);

  /** Translate a click on the <video> element into a point on the actual video
   *  frame. The element is object-contain, so there are letterbox bars that are
   *  part of the element but not part of the picture — mapping against the
   *  element's own rect would put the focus point in the wrong place. */
  const handleTapFocus = (e: React.MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current;
    if (!video || !state?.focusSupported) return;
    if (!video.videoWidth || !video.videoHeight) return;

    const rect = video.getBoundingClientRect();
    const scale = Math.min(
      rect.width / video.videoWidth,
      rect.height / video.videoHeight,
    );
    const shownW = video.videoWidth * scale;
    const shownH = video.videoHeight * scale;
    const offsetX = (rect.width - shownW) / 2;
    const offsetY = (rect.height - shownH) / 2;

    const x = (e.clientX - rect.left - offsetX) / shownW;
    const y = (e.clientY - rect.top - offsetY) / shownH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return; // tapped a letterbox bar

    send({ op: "focusAt", x, y });
    setFocusPulse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTimeout(() => setFocusPulse(null), 700);
  };

  const zoomRange = state?.zoomRange ?? [1, 1];
  const baseline = state?.zoomUiBaseline ?? 1;

  return (
    <main className="flex min-h-dvh flex-col bg-black">
      <StatusBar
        status={status}
        peerState={peerState}
        cameraOnline={cameraOnline}
        lastSeen={lastSeen}
        state={state}
        icePath={icePath}
      />

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          onClick={handleTapFocus}
          style={{ transform: `scale(${zoomPreview})` }}
          className="max-h-full max-w-full object-contain transition-transform duration-150"
        />

        {focusPulse && (
          <span
            className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-[var(--color-warn)]"
            style={{ left: focusPulse.x, top: focusPulse.y }}
          />
        )}

        {peerState !== "connected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-neutral-500">
            <span>
              {!cameraOnline
                ? "攝影機離線"
                : peerState === "failed"
                  ? "連線失敗"
                  : "連線中…"}
            </span>
            {!cameraOnline && lastSeen && (
              <span className="text-xs text-neutral-600">
                最後上線 {formatAgo(lastSeen)}
              </span>
            )}
          </div>
        )}
      </div>

      <Controls
        state={state}
        disabled={peerState !== "connected" || !state}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
        zoomRange={zoomRange as [number, number]}
        baseline={baseline}
        onZoom={(v) => {
          setZoomPreview(v / (state?.zoom ?? v));
          send({ op: "setZoom", value: v });
        }}
        onSwitch={(facing) => send({ op: "switchCamera", value: facing })}
        onTorch={(on) => send({ op: "setTorch", value: on })}
        onQuality={(q) => send({ op: "setQuality", value: q })}
      />
    </main>
  );
}

// ---------------------------------------------------------------------------

function StatusBar({
  status,
  peerState,
  cameraOnline,
  lastSeen,
  state,
  icePath,
}: {
  status: ConnectionStatus;
  peerState: PeerState;
  cameraOnline: boolean;
  lastSeen: number | null;
  state: CameraState | null;
  icePath: string | null;
}) {
  const certDays = state?.provisioningExpiresAt
    ? Math.floor(
        (new Date(state.provisioningExpiresAt).getTime() - Date.now()) / 86_400_000,
      )
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[11px] text-neutral-500">
      <Link href="/" className="text-neutral-400 hover:text-neutral-200">
        ←
      </Link>

      <Dot ok={cameraOnline && peerState === "connected"} />
      <span className="text-neutral-300">
        {peerState === "connected" ? "串流中" : cameraOnline ? "協商中" : "離線"}
      </span>

      {status !== "online" && <span>訊號通道 {status}</span>}

      {state && (
        <>
          <span>{state.camera === "back" ? "後鏡頭" : "前鏡頭"}</span>
          <span>{state.quality}</span>
          {state.qualityAutoReduced && (
            <span className="text-[var(--color-warn)]">已因過熱降級</span>
          )}
          {state.battery !== null && (
            <span>
              {Math.round(state.battery * 100)}%{state.charging ? " ⚡" : ""}
            </span>
          )}
          {state.thermal !== "nominal" && (
            <span className="text-[var(--color-warn)]">溫度 {state.thermal}</span>
          )}
        </>
      )}

      {icePath && <span className="text-neutral-600">{icePath}</span>}

      {certDays !== null && certDays <= 3 && (
        <span
          className={
            certDays <= 1 ? "text-[var(--color-danger)]" : "text-[var(--color-warn)]"
          }
        >
          憑證剩 {Math.max(0, certDays)} 天，需重簽
        </span>
      )}

      {!cameraOnline && lastSeen && (
        <span className="text-neutral-600">最後上線 {formatAgo(lastSeen)}</span>
      )}
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: ok ? "var(--color-ok)" : "var(--color-danger)" }}
    />
  );
}

function Controls({
  state,
  disabled,
  muted,
  onToggleMute,
  zoomRange,
  baseline,
  onZoom,
  onSwitch,
  onTorch,
  onQuality,
}: {
  state: CameraState | null;
  disabled: boolean;
  muted: boolean;
  onToggleMute: () => void;
  zoomRange: [number, number];
  baseline: number;
  onZoom: (v: number) => void;
  onSwitch: (f: CameraFacing) => void;
  onTorch: (on: boolean) => void;
  onQuality: (q: QualityPreset) => void;
}) {
  return (
    <div className="space-y-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs tabular-nums text-neutral-500">
          {state ? zoomLabel(state.zoom, baseline) : "—"}
        </span>
        <input
          type="range"
          min={zoomRange[0]}
          max={zoomRange[1]}
          step={0.1}
          value={state?.zoom ?? zoomRange[0]}
          disabled={disabled}
          onChange={(e) => onZoom(Number(e.target.value))}
          className="flex-1 accent-[var(--color-accent)] disabled:opacity-30"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn
          active={state?.camera === "back"}
          disabled={disabled}
          onClick={() => onSwitch(state?.camera === "back" ? "front" : "back")}
        >
          {state?.camera === "back" ? "後鏡頭" : "前鏡頭"} ⇄
        </Btn>

        <Btn
          active={state?.torchOn ?? false}
          disabled={disabled || !state?.torchAvailable}
          onClick={() => onTorch(!state?.torchOn)}
        >
          手電筒
        </Btn>

        <Btn active={!muted} disabled={disabled} onClick={onToggleMute}>
          {muted ? "開聲音" : "靜音"}
        </Btn>

        {QualityPreset.options.map((q) => (
          <Btn
            key={q}
            active={state?.quality === q}
            disabled={disabled}
            onClick={() => onQuality(q)}
          >
            {q}
          </Btn>
        ))}
      </div>

      <p className="text-[11px] text-neutral-600">
        {state?.focusSupported
          ? "點畫面任一處對焦"
          : "此鏡頭為固定焦距，不支援點擊對焦"}
      </p>
    </div>
  );
}

function Btn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-30 ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
          : "border-[var(--color-line)] text-neutral-400 hover:border-neutral-600"
      }`}
    >
      {children}
    </button>
  );
}

function formatAgo(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小時前`;
  return `${Math.floor(sec / 86400)} 天前`;
}
