import Foundation

/// The single place where tools are registered.
@MainActor
enum ModuleRegistry {
    static let all: [AnyToolModule] = [
        AnyToolModule(PetCamModule.self),
        AnyToolModule(DataHubModule.self),
    ]
}
