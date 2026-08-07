import { z } from "zod";

/**
 * PetCam control protocol — carried over the WebRTC DataChannel ("petcam-ctl").
 *
 * This file is the SINGLE SOURCE OF TRUTH for the wire format.
 * The Swift mirror lives at packages/protocol/swift/PetCamProtocol.swift and
 * MUST be kept byte-compatible. Any change here requires the same change there.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const CameraFacing = z.enum(["front", "back"]);
export type CameraFacing = z.infer<typeof CameraFacing>;

export const FocusMode = z.enum(["continuous", "locked"]);
export type FocusMode = z.infer<typeof FocusMode>;

/** Capture presets. Kept coarse on purpose — the camera node degrades between
 *  these when `thermal` rises rather than exposing a continuous knob. */
export const QualityPreset = z.enum(["480p15", "720p30", "1080p30"]);
export type QualityPreset = z.infer<typeof QualityPreset>;

export const ThermalState = z.enum(["nominal", "fair", "serious", "critical"]);
export type ThermalState = z.infer<typeof ThermalState>;

/** Target video bitrate per preset, in bits/sec.
 *  Deliberately conservative: the camera node is usually on home upstream and
 *  the viewer is often on cellular. We cap the sender rather than let WebRTC's
 *  bandwidth estimator probe upwards and cause oscillation. */
export const BITRATE_BY_PRESET: Record<QualityPreset, number> = {
  "480p15": 500_000,
  "720p30": 1_800_000,
  "1080p30": 3_500_000,
};

// ---------------------------------------------------------------------------
// Commands: viewer -> camera
// ---------------------------------------------------------------------------

export const Command = z.discriminatedUnion("op", [
  z.object({ op: z.literal("switchCamera"), value: CameraFacing }),

  /** Absolute zoom factor in the DEVICE's own scale, not a UI multiplier.
   *  Callers must clamp to the `zoomRange` from the last CameraState — the
   *  camera node clamps again defensively and reports the applied value. */
  z.object({ op: z.literal("setZoom"), value: z.number().min(0.1).max(128) }),

  /** Focus/exposure point of interest, normalised to the *displayed* video
   *  frame: (0,0) = top-left, (1,1) = bottom-right, as the viewer sees it.
   *  The camera node is responsible for undoing mirroring and orientation. */
  z.object({
    op: z.literal("focusAt"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),

  z.object({ op: z.literal("setFocusMode"), value: FocusMode }),
  z.object({ op: z.literal("setTorch"), value: z.boolean() }),
  z.object({ op: z.literal("setQuality"), value: QualityPreset }),

  /** Power/burn-in saver: camera keeps capturing, but the phone's own screen
   *  renders black. Has no effect on the outgoing stream. */
  z.object({ op: z.literal("setScreenDim"), value: z.boolean() }),

  /** Ask for an unsolicited CameraState push (used on (re)connect). */
  z.object({ op: z.literal("requestState") }),
]);
export type Command = z.infer<typeof Command>;

export const CommandEnvelope = z.object({
  t: z.literal("cmd"),
  /** Client-generated correlation id, echoed back in the Ack. */
  id: z.string().min(1).max(64),
  cmd: Command,
});
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

// ---------------------------------------------------------------------------
// Camera -> viewer
// ---------------------------------------------------------------------------

export const CameraState = z.object({
  camera: CameraFacing,

  /** Currently applied device zoom factor. */
  zoom: z.number(),
  /** [min, max] usable zoom for the ACTIVE device. On an iPhone 13 back
   *  camera this spans ultra-wide through digital zoom on the wide lens. */
  zoomRange: z.tuple([z.number(), z.number()]),
  /** Zoom factors at which a virtual device swaps physical lenses. Used by the
   *  viewer to draw detents (the "0.5x / 1x" style stops). Empty if none. */
  switchOverFactors: z.array(z.number()),
  /** Zoom factor the UI should label as "1x". For a dual-wide virtual device
   *  this is the first switch-over point, not 1.0. */
  zoomUiBaseline: z.number(),

  focusMode: FocusMode,
  /** False on fixed-focus cameras — e.g. the iPhone 13 front camera.
   *  The viewer must disable tap-to-focus when this is false. */
  focusSupported: z.boolean(),

  torchAvailable: z.boolean(),
  torchOn: z.boolean(),

  quality: QualityPreset,
  /** True when the node auto-degraded quality due to thermals, so the viewer
   *  can explain why the picture got worse instead of looking broken. */
  qualityAutoReduced: z.boolean(),

  screenDim: z.boolean(),

  /** 0..1, or null when unavailable. */
  battery: z.number().min(0).max(1).nullable(),
  charging: z.boolean(),
  thermal: ThermalState,

  /** Free-provisioning survival kit: when the 7-day signing certificate dies,
   *  the app stops launching. Surfaced in the viewer so you find out while
   *  you're looking at the stream, not when the camera silently vanishes.
   *  ISO-8601, or null on a build with a long-lived certificate. */
  provisioningExpiresAt: z.string().datetime().nullable(),

  appVersion: z.string(),
  /** Monotonic seconds since the capture session started. */
  uptimeSec: z.number(),
});
export type CameraState = z.infer<typeof CameraState>;

export const AckEnvelope = z.object({
  t: z.literal("ack"),
  id: z.string(),
  ok: z.boolean(),
  /** Present only when ok === false. */
  error: z.string().optional(),
});
export type AckEnvelope = z.infer<typeof AckEnvelope>;

export const StateEnvelope = z.object({
  t: z.literal("state"),
  state: CameraState,
});
export type StateEnvelope = z.infer<typeof StateEnvelope>;

// ---------------------------------------------------------------------------
// Unions + helpers
// ---------------------------------------------------------------------------

/** Anything the viewer may send over the control channel. */
export const ViewerMessage = CommandEnvelope;
export type ViewerMessage = z.infer<typeof ViewerMessage>;

/** Anything the camera may send over the control channel. */
export const CameraMessage = z.discriminatedUnion("t", [
  AckEnvelope,
  StateEnvelope,
]);
export type CameraMessage = z.infer<typeof CameraMessage>;

export const CONTROL_CHANNEL_LABEL = "petcam-ctl";

/** Parse an inbound control-channel payload, returning null on anything
 *  malformed. Both ends treat unparseable frames as ignorable, never fatal —
 *  a newer viewer talking to an older camera must not kill the stream. */
export function parseCameraMessage(raw: string): CameraMessage | null {
  try {
    const result = CameraMessage.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseViewerMessage(raw: string): ViewerMessage | null {
  try {
    const result = ViewerMessage.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Map a device zoom factor to the label a phone camera UI would show.
 *  `zoomUiBaseline` is whatever the device calls "1x". */
export function zoomLabel(zoom: number, baseline: number): string {
  const ui = zoom / baseline;
  return ui < 1 ? `${ui.toFixed(1)}x` : `${ui.toFixed(ui < 10 ? 1 : 0)}x`;
}
