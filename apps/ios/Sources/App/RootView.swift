import SwiftUI

struct RootView: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(ModuleRegistry.all) { module in
                        NavigationLink {
                            module.makeRootView()
                        } label: {
                            ToolCard(module: module)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .navigationTitle("All-in-One")
            .background(Color.black.ignoresSafeArea())
        }
    }
}

private struct ToolCard: View {
    let module: AnyToolModule

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Image(systemName: module.symbol)
                    .font(.title2)
                    .foregroundStyle(.white)
                Spacer()
                Text(module.status.label)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .overlay(
                        Capsule().stroke(Color.white.opacity(0.15), lineWidth: 1)
                    )
            }

            Text(module.title)
                .font(.headline)
                .foregroundStyle(.white)
                .padding(.top, 16)

            Text(module.subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.leading)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}
