import SwiftUI

/// One tool in the personal tool library.
///
/// The shell knows nothing about any specific tool: it renders whatever the
/// registry hands it. Adding a tool means adding a type that conforms to this
/// and one line in `ModuleRegistry.all` — never touching navigation code.
///
/// Mirrors `ToolModule` in apps/web/lib/modules.ts.
@MainActor
protocol ToolModule {
    static var id: String { get }
    static var title: String { get }
    static var subtitle: String { get }
    /// SF Symbol name.
    static var symbol: String { get }
    static var status: ToolStatus { get }

    @ViewBuilder static func makeRootView() -> AnyView
}

enum ToolStatus: String {
    case ready
    case wip
    case planned

    var label: String {
        switch self {
        case .ready: return "可用"
        case .wip: return "開發中"
        case .planned: return "規劃中"
        }
    }
}

/// Type-erased entry so heterogeneous modules can live in one array.
@MainActor
struct AnyToolModule: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let status: ToolStatus
    // Must carry the isolation in the type: `ToolModule.makeRootView` is
    // MainActor-isolated, and storing it as a plain closure would silently
    // strip that (a warning today, an error in the Swift 6 language mode).
    let makeRootView: @MainActor () -> AnyView

    init<M: ToolModule>(_ type: M.Type) {
        self.id = M.id
        self.title = M.title
        self.subtitle = M.subtitle
        self.symbol = M.symbol
        self.status = M.status
        self.makeRootView = M.makeRootView
    }
}
