import SwiftUI
import MapKit

struct SearchSheet: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var searchService: SearchService
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var results: [Destination] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if !results.isEmpty {
                    Section("Results") {
                        ForEach(results) { destination in
                            row(name: destination.name, subtitle: destination.subtitle) {
                                go(to: destination)
                            }
                        }
                    }
                }

                if results.isEmpty {
                    Section("Suggestions") {
                        ForEach(searchService.completions, id: \.self) { completion in
                            row(name: completion.title, subtitle: completion.subtitle) {
                                resolve(completion)
                            }
                        }
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Where to?")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .onChange(of: query) { _, newValue in
                results = []
                searchService.updateQuery(newValue)
            }
            .onSubmit(of: .search) {
                Task { await runSearch() }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func row(name: String, subtitle: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .foregroundStyle(.primary)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func runSearch() async {
        do {
            results = try await searchService.search(query)
            errorMessage = results.isEmpty ? "No results for \(query)." : nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func resolve(_ completion: MKLocalSearchCompletion) {
        Task {
            guard let destination = try? await searchService.resolve(completion) else {
                errorMessage = "Couldn't locate that place."
                return
            }
            go(to: destination)
        }
    }

    private func go(to destination: Destination) {
        dismiss()
        Task { await environment.planTrip(to: destination) }
    }
}
