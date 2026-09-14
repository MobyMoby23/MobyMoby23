import Foundation
import CoreLocation
import Combine

/// Where community reports come from and go to.
///
/// The app ships with `LocalIncidentStore` so reporting works offline and on
/// day one with no server. `RemoteIncidentStore` is the same interface over an
/// HTTP backend — point it at a deployment and the crowd becomes real without
/// touching anything above this line.
protocol IncidentStore: Sendable {
    /// Reports near a point, newest first.
    func incidents(near coordinate: CLLocationCoordinate2D, radius: CLLocationDistance) async throws -> [Incident]
    func report(_ incident: Incident) async throws
    /// "Still there" / "Not there" from another driver.
    func vote(on id: UUID, confirms: Bool) async throws
}

/// On-device store backed by a JSON file in Application Support.
///
/// Reports made here are visible only to this driver. That is a real
/// limitation — crowd-sourcing needs a crowd — but it keeps the report flow,
/// the alert engine and the CarPlay templates fully exercisable without
/// standing up a backend first.
actor LocalIncidentStore: IncidentStore {
    private var incidents: [UUID: Incident] = [:]
    private let fileURL: URL

    init(filename: String = "incidents.json") {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.fileURL = directory.appendingPathComponent(filename)

        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([Incident].self, from: data) {
            incidents = Dictionary(decoded.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        }
    }

    func incidents(
        near coordinate: CLLocationCoordinate2D,
        radius: CLLocationDistance
    ) async throws -> [Incident] {
        let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        purgeExpired()

        return incidents.values
            .filter { $0.isActive && $0.location.distance(from: origin) <= radius }
            .sorted { $0.reportedAt > $1.reportedAt }
    }

    func report(_ incident: Incident) async throws {
        incidents[incident.id] = incident
        save()
    }

    func vote(on id: UUID, confirms: Bool) async throws {
        guard var incident = incidents[id] else { return }
        if confirms { incident.upvotes += 1 } else { incident.downvotes += 1 }
        incidents[id] = incident
        save()
    }

    private func purgeExpired() {
        incidents = incidents.filter { !$0.value.isExpired }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(Array(incidents.values)) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}

/// HTTP-backed store. The endpoints are the obvious three; swap in whatever
/// your server speaks by editing this one type.
actor RemoteIncidentStore: IncidentStore {
    private let baseURL: URL
    private let session: URLSession
    private let local = LocalIncidentStore(filename: "incidents-cache.json")

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func incidents(
        near coordinate: CLLocationCoordinate2D,
        radius: CLLocationDistance
    ) async throws -> [Incident] {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("incidents"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(coordinate.latitude)),
            URLQueryItem(name: "lon", value: String(coordinate.longitude)),
            URLQueryItem(name: "radius", value: String(Int(radius)))
        ]
        guard let url = components.url else { return [] }

        do {
            let (data, _) = try await session.data(from: url)
            let fetched = try JSONDecoder().decode([Incident].self, from: data)
            return fetched.filter(\.isActive)
        } catch {
            // Tunnels, dead spots, a server having a bad day: fall back to what
            // this device already knows rather than showing the driver nothing.
            return try await local.incidents(near: coordinate, radius: radius)
        }
    }

    func report(_ incident: Incident) async throws {
        // Written locally first so the driver's own report shows immediately,
        // then pushed; a failed push leaves the local copy in place.
        try await local.report(incident)

        var request = URLRequest(url: baseURL.appendingPathComponent("incidents"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(incident)
        _ = try? await session.data(for: request)
    }

    func vote(on id: UUID, confirms: Bool) async throws {
        try await local.vote(on: id, confirms: confirms)

        var request = URLRequest(
            url: baseURL.appendingPathComponent("incidents/\(id.uuidString)/vote")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["confirms": confirms])
        _ = try? await session.data(for: request)
    }
}
