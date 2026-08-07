// PetCamProtocol.swift
//
// Swift mirror of packages/protocol/src/petcam.ts — the wire format for the
// WebRTC DataChannel labelled `controlChannelLabel`.
//
// ⚠️ packages/protocol/src/petcam.ts is the source of truth. If you change a
//    case, a key, or a raw value there, change it here in the same commit.
//    `Fixtures/protocol-fixtures.json` is decoded by both sides in tests to
//    catch drift.

import Foundation

public enum PetCam {

    public static let controlChannelLabel = "petcam-ctl"

    // MARK: - Primitives

    public enum CameraFacing: String, Codable, Sendable, CaseIterable {
        case front, back
    }

    public enum FocusMode: String, Codable, Sendable, CaseIterable {
        case continuous, locked
    }

    public enum QualityPreset: String, Codable, Sendable, CaseIterable {
        case p480x15 = "480p15"
        case p720x30 = "720p30"
        case p1080x30 = "1080p30"

        /// Conservative sender cap. See BITRATE_BY_PRESET in petcam.ts —
        /// we pin the encoder instead of letting BWE probe upwards, because
        /// the viewer is usually on cellular and oscillation reads as "laggy".
        public var targetBitrate: Int {
            switch self {
            case .p480x15: return 500_000
            case .p720x30: return 1_800_000
            case .p1080x30: return 3_500_000
            }
        }

        public var dimensions: (width: Int32, height: Int32) {
            switch self {
            case .p480x15: return (854, 480)
            case .p720x30: return (1280, 720)
            case .p1080x30: return (1920, 1080)
            }
        }

        public var frameRate: Int32 {
            switch self {
            case .p480x15: return 15
            case .p720x30, .p1080x30: return 30
            }
        }

        /// Next step down when the device gets hot. `nil` at the floor.
        public var degraded: QualityPreset? {
            switch self {
            case .p1080x30: return .p720x30
            case .p720x30: return .p480x15
            case .p480x15: return nil
            }
        }
    }

    public enum ThermalState: String, Codable, Sendable {
        case nominal, fair, serious, critical

        public init(_ processInfoState: ProcessInfo.ThermalState) {
            switch processInfoState {
            case .nominal: self = .nominal
            case .fair: self = .fair
            case .serious: self = .serious
            case .critical: self = .critical
            @unknown default: self = .nominal
            }
        }
    }

    // MARK: - Commands (viewer -> camera)

    public enum Command: Sendable, Equatable {
        case switchCamera(CameraFacing)
        case setZoom(Double)
        /// Normalised to the frame *as the viewer sees it*: (0,0) top-left.
        /// Undoing mirroring/orientation is the camera node's job.
        case focusAt(x: Double, y: Double)
        case setFocusMode(FocusMode)
        case setTorch(Bool)
        case setQuality(QualityPreset)
        case setScreenDim(Bool)
        case requestState
    }

    public struct CommandEnvelope: Sendable, Equatable {
        public let id: String
        public let cmd: Command

        public init(id: String = UUID().uuidString, cmd: Command) {
            self.id = id
            self.cmd = cmd
        }
    }

    // MARK: - Camera -> viewer

    public struct CameraState: Codable, Sendable, Equatable {
        public var camera: CameraFacing
        public var zoom: Double
        /// Encoded as a 2-tuple array [min, max] to match the TS `z.tuple`.
        public var zoomRange: [Double]
        public var switchOverFactors: [Double]
        /// The factor the UI should label "1x" — for a dual-wide virtual device
        /// this is the first switch-over point, NOT 1.0.
        public var zoomUiBaseline: Double

        public var focusMode: FocusMode
        /// False on fixed-focus cameras (the iPhone 13 front camera is one).
        public var focusSupported: Bool

        public var torchAvailable: Bool
        public var torchOn: Bool

        public var quality: QualityPreset
        public var qualityAutoReduced: Bool

        public var screenDim: Bool

        public var battery: Double?
        public var charging: Bool
        public var thermal: ThermalState

        /// Free-provisioning survival kit: ISO-8601 expiry of the embedded
        /// mobileprovision, so the viewer can warn before the app stops
        /// launching. `nil` on a build signed with a long-lived certificate.
        public var provisioningExpiresAt: String?

        public var appVersion: String
        public var uptimeSec: Double

        public init(
            camera: CameraFacing,
            zoom: Double,
            zoomRange: [Double],
            switchOverFactors: [Double],
            zoomUiBaseline: Double,
            focusMode: FocusMode,
            focusSupported: Bool,
            torchAvailable: Bool,
            torchOn: Bool,
            quality: QualityPreset,
            qualityAutoReduced: Bool,
            screenDim: Bool,
            battery: Double?,
            charging: Bool,
            thermal: ThermalState,
            provisioningExpiresAt: String?,
            appVersion: String,
            uptimeSec: Double
        ) {
            self.camera = camera
            self.zoom = zoom
            self.zoomRange = zoomRange
            self.switchOverFactors = switchOverFactors
            self.zoomUiBaseline = zoomUiBaseline
            self.focusMode = focusMode
            self.focusSupported = focusSupported
            self.torchAvailable = torchAvailable
            self.torchOn = torchOn
            self.quality = quality
            self.qualityAutoReduced = qualityAutoReduced
            self.screenDim = screenDim
            self.battery = battery
            self.charging = charging
            self.thermal = thermal
            self.provisioningExpiresAt = provisioningExpiresAt
            self.appVersion = appVersion
            self.uptimeSec = uptimeSec
        }
    }

    public enum CameraMessage: Sendable {
        case ack(id: String, ok: Bool, error: String?)
        case state(CameraState)
    }
}

// MARK: - Codable: Command

extension PetCam.Command: Codable {
    private enum CodingKeys: String, CodingKey {
        case op, value, x, y
    }

    private enum Op: String, Codable {
        case switchCamera, setZoom, focusAt, setFocusMode
        case setTorch, setQuality, setScreenDim, requestState
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .switchCamera(let v):
            try c.encode(Op.switchCamera, forKey: .op)
            try c.encode(v, forKey: .value)
        case .setZoom(let v):
            try c.encode(Op.setZoom, forKey: .op)
            try c.encode(v, forKey: .value)
        case .focusAt(let x, let y):
            try c.encode(Op.focusAt, forKey: .op)
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
        case .setFocusMode(let v):
            try c.encode(Op.setFocusMode, forKey: .op)
            try c.encode(v, forKey: .value)
        case .setTorch(let v):
            try c.encode(Op.setTorch, forKey: .op)
            try c.encode(v, forKey: .value)
        case .setQuality(let v):
            try c.encode(Op.setQuality, forKey: .op)
            try c.encode(v, forKey: .value)
        case .setScreenDim(let v):
            try c.encode(Op.setScreenDim, forKey: .op)
            try c.encode(v, forKey: .value)
        case .requestState:
            try c.encode(Op.requestState, forKey: .op)
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let op = try c.decode(Op.self, forKey: .op)
        switch op {
        case .switchCamera:
            self = .switchCamera(try c.decode(PetCam.CameraFacing.self, forKey: .value))
        case .setZoom:
            self = .setZoom(try c.decode(Double.self, forKey: .value))
        case .focusAt:
            self = .focusAt(
                x: try c.decode(Double.self, forKey: .x),
                y: try c.decode(Double.self, forKey: .y)
            )
        case .setFocusMode:
            self = .setFocusMode(try c.decode(PetCam.FocusMode.self, forKey: .value))
        case .setTorch:
            self = .setTorch(try c.decode(Bool.self, forKey: .value))
        case .setQuality:
            self = .setQuality(try c.decode(PetCam.QualityPreset.self, forKey: .value))
        case .setScreenDim:
            self = .setScreenDim(try c.decode(Bool.self, forKey: .value))
        case .requestState:
            self = .requestState
        }
    }
}

// MARK: - Codable: CommandEnvelope

extension PetCam.CommandEnvelope: Codable {
    private enum CodingKeys: String, CodingKey { case t, id, cmd }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("cmd", forKey: .t)
        try c.encode(id, forKey: .id)
        try c.encode(cmd, forKey: .cmd)
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let t = try c.decode(String.self, forKey: .t)
        guard t == "cmd" else {
            throw DecodingError.dataCorruptedError(
                forKey: .t, in: c, debugDescription: "expected t == \"cmd\", got \"\(t)\""
            )
        }
        self.init(
            id: try c.decode(String.self, forKey: .id),
            cmd: try c.decode(PetCam.Command.self, forKey: .cmd)
        )
    }
}

// MARK: - Codable: CameraMessage

extension PetCam.CameraMessage: Codable {
    private enum CodingKeys: String, CodingKey { case t, id, ok, error, state }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ack(let id, let ok, let error):
            try c.encode("ack", forKey: .t)
            try c.encode(id, forKey: .id)
            try c.encode(ok, forKey: .ok)
            try c.encodeIfPresent(error, forKey: .error)
        case .state(let s):
            try c.encode("state", forKey: .t)
            try c.encode(s, forKey: .state)
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .t) {
        case "ack":
            self = .ack(
                id: try c.decode(String.self, forKey: .id),
                ok: try c.decode(Bool.self, forKey: .ok),
                error: try c.decodeIfPresent(String.self, forKey: .error)
            )
        case "state":
            self = .state(try c.decode(PetCam.CameraState.self, forKey: .state))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .t, in: c, debugDescription: "unknown message type \"\(other)\""
            )
        }
    }
}

// MARK: - Convenience

public extension PetCam {
    /// Both ends treat an unparseable frame as ignorable, never fatal — a newer
    /// viewer talking to an older camera must not tear down the stream.
    static func decodeCommand(_ data: Data) -> CommandEnvelope? {
        try? JSONDecoder().decode(CommandEnvelope.self, from: data)
    }

    static func encode(_ message: CameraMessage) -> Data? {
        try? JSONEncoder().encode(message)
    }
}
