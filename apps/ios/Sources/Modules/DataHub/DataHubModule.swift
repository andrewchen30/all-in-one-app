import SwiftUI

/// Data dashboard module — placeholder for M6.
///
/// The one architectural rule is already fixed: all fetching happens
/// server-side on a schedule, and this module only ever reads our own API.
/// Credentials never reach the phone; see docs/ARCHITECTURE.md.
enum DataHubModule: ToolModule {
    static let id = "datahub"
    static let title = "數據儀表板"
    static let subtitle = "Metabase 報表與外部 API 數字"
    static let symbol = "chart.bar.fill"
    static let status: ToolStatus = .planned

    static func makeRootView() -> AnyView {
        AnyView(DataHubRootView())
    }
}

struct DataHubRootView: View {
    var body: some View {
        List {
            Section("已定案的架構規則") {
                Text("所有資料抓取一律在後端排程進行，App 只讀自家 API。憑證不落在手機上、換裝置不必重新授權、可留下時序資料畫趨勢圖。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("待解問題") {
                Text("公司 Metabase 若在 VPN 內，雲端排程打不到 —— 開工前要先確認連通方式。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(DataHubModule.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
