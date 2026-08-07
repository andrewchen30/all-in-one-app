import SwiftUI

/// Pet camera module.
///
/// One module, two roles. Which role a device plays is a runtime choice, not a
/// separate build — the old iPhone on the shelf runs `.camera`, everything else
/// runs `.viewer`. Capture and WebRTC land in M1.
enum PetCamModule: ToolModule {
    static let id = "petcam"
    static let title = "寵物攝影機"
    static let subtitle = "把舊 iPhone 變成即時監看鏡頭"
    static let symbol = "pawprint.fill"
    static let status: ToolStatus = .wip

    static func makeRootView() -> AnyView {
        AnyView(PetCamRootView())
    }
}

enum PetCamRole: String, CaseIterable, Identifiable {
    case camera
    case viewer

    var id: String { rawValue }

    var label: String {
        switch self {
        case .camera: return "此裝置作為攝影機"
        case .viewer: return "此裝置作為觀看端"
        }
    }
}

struct PetCamRootView: View {
    @AppStorage("petcam.role") private var role: PetCamRole = .viewer
    @AppStorage("petcam.deviceId") private var deviceId: String = ""

    var body: some View {
        Form {
            Section("模式") {
                Picker("模式", selection: $role) {
                    ForEach(PetCamRole.allCases) { r in
                        Text(r.label).tag(r)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            Section("裝置 ID") {
                TextField("例如 home-cam", text: $deviceId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section {
                Text("串流功能排在 M1。目前可先用瀏覽器版測試攝影機驗證整條鏈路："
                     + "在電腦開啟 /petcam/dev-camera，本機或另一裝置開啟 /petcam。")
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            if let days = ProvisioningInfo.daysRemaining {
                Section("簽章") {
                    LabeledContent("憑證剩餘") {
                        Text("\(max(0, days)) 天")
                            .foregroundStyle(days <= 2 ? .red : .secondary)
                    }
                    Text("免費 provisioning 每 7 天到期，過期後 App 無法啟動。到期前執行 `make ios-install` 重簽。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(PetCamModule.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
