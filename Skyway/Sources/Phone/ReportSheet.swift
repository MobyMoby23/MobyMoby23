import SwiftUI

/// One tap per hazard, big targets, no confirmation step. The same eight kinds
/// appear on the CarPlay grid.
struct ReportSheet: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(Incident.Kind.allCases, id: \.self) { kind in
                        Button {
                            dismiss()
                            Task { await environment.report(kind) }
                        } label: {
                            VStack(spacing: 10) {
                                Image(systemName: kind.symbolName)
                                    .font(.system(size: 30, weight: .semibold))
                                Text(kind.title)
                                    .font(.footnote.weight(.medium))
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 104)
                            .background(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(Color.secondary.opacity(0.12))
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
