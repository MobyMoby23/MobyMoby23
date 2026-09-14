import Foundation
import MapKit
import Combine

/// Destination search, shared by the phone UI and the CarPlay search template.
@MainActor
final class SearchService: NSObject, ObservableObject {
    @Published private(set) var completions: [MKLocalSearchCompletion] = []
    @Published private(set) var isSearching = false

    private let completer = MKLocalSearchCompleter()
    private var region: MKCoordinateRegion?

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = [.address, .pointOfInterest]
    }

    /// Biases results towards the driver. Called whenever the car moves a
    /// meaningful distance.
    func updateRegion(around coordinate: CLLocationCoordinate2D) {
        let region = MKCoordinateRegion(
            center: coordinate,
            latitudinalMeters: 50_000,
            longitudinalMeters: 50_000
        )
        self.region = region
        completer.region = region
    }

    func updateQuery(_ query: String) {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            completions = []
            completer.queryFragment = ""
            return
        }
        completer.queryFragment = query
    }

    /// Turns a completion row into a real coordinate.
    func resolve(_ completion: MKLocalSearchCompletion) async throws -> Destination {
        let request = MKLocalSearch.Request(completion: completion)
        if let region { request.region = region }
        let response = try await MKLocalSearch(request: request).start()
        guard let item = response.mapItems.first else { throw SearchError.notFound }
        return Destination(mapItem: item)
    }

    /// One-shot search, used by CarPlay's search template and by voice input,
    /// both of which hand us a finished string rather than a completion row.
    func search(_ query: String, limit: Int = 12) async throws -> [Destination] {
        isSearching = true
        defer { isSearching = false }

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        if let region { request.region = region }
        let response = try await MKLocalSearch(request: request).start()
        return response.mapItems.prefix(limit).map(Destination.init(mapItem:))
    }

    /// Category search behind the CarPlay "Nearby" grid — fuel, charging,
    /// parking, coffee. Needs an explicit centre: a driver looking for fuel
    /// wants it near the car, not near whatever the map last showed.
    func searchCategory(
        _ category: MKPointOfInterestCategory,
        near coordinate: CLLocationCoordinate2D,
        radius: CLLocationDistance = 20_000,
        limit: Int = 12
    ) async throws -> [Destination] {
        let request = MKLocalPointsOfInterestRequest(center: coordinate, radius: radius)
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: [category])
        let response = try await MKLocalSearch(request: request).start()
        return response.mapItems.prefix(limit).map(Destination.init(mapItem:))
    }

    enum SearchError: LocalizedError {
        case notFound
        var errorDescription: String? { "Couldn't find that place." }
    }
}

extension SearchService: MKLocalSearchCompleterDelegate {
    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        let results = completer.results
        Task { @MainActor in self.completions = results }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in self.completions = [] }
    }
}
