import Foundation
import CoreLocation

/// The rest of the app talks to weather through this and nothing else.
///
/// Two implementations ship: `WeatherKitProvider` (Apple's own data, needs the
/// WeatherKit capability and a paid developer account) and
/// `OpenMeteoProvider` (free, no key, no account — so the project builds and
/// runs for anyone who clones it). `AppEnvironment` picks one at launch.
protocol WeatherProvider: Sendable {
    /// Conditions at a place, at a time. `date` may be in the future — the
    /// route scanner asks for the weather at the moment the car will arrive.
    func snapshot(at coordinate: CLLocationCoordinate2D, date: Date) async throws -> WeatherSnapshot

    /// Hour-by-hour forecast, used for the destination strip.
    func hourly(at coordinate: CLLocationCoordinate2D, hours: Int) async throws -> [HourlyForecast]

    /// Official severe-weather warnings for a place, if the source has them.
    func warnings(at coordinate: CLLocationCoordinate2D) async throws -> [WeatherWarning]
}

enum WeatherProviderError: LocalizedError {
    case unavailable
    case badResponse
    case noDataForDate

    var errorDescription: String? {
        switch self {
        case .unavailable: return "Weather is unavailable right now."
        case .badResponse: return "The weather service returned something unexpected."
        case .noDataForDate: return "No forecast covers that time."
        }
    }
}

/// Caches provider results by rounded coordinate and hour.
///
/// A 400 km route sampled every 10 minutes is ~40 lookups, and consecutive
/// samples on a motorway often land in the same forecast cell — without this
/// the scan would hammer the provider (and, on WeatherKit, the paid quota).
actor WeatherCache {
    private struct Key: Hashable {
        let latitude: Int
        let longitude: Int
        let hour: Int
    }

    private var storage: [Key: (value: WeatherSnapshot, storedAt: Date)] = [:]
    private let lifetime: TimeInterval
    /// Grid resolution in degrees; 0.05° is roughly 5 km.
    private let gridSize: Double

    init(lifetime: TimeInterval = 20 * 60, gridSize: Double = 0.05) {
        self.lifetime = lifetime
        self.gridSize = gridSize
    }

    private func key(_ coordinate: CLLocationCoordinate2D, _ date: Date) -> Key {
        Key(
            latitude: Int((coordinate.latitude / gridSize).rounded()),
            longitude: Int((coordinate.longitude / gridSize).rounded()),
            hour: Int(date.timeIntervalSince1970 / 3_600)
        )
    }

    func value(for coordinate: CLLocationCoordinate2D, date: Date) -> WeatherSnapshot? {
        guard let entry = storage[key(coordinate, date)] else { return nil }
        guard Date().timeIntervalSince(entry.storedAt) < lifetime else { return nil }
        return entry.value
    }

    func store(_ snapshot: WeatherSnapshot, for coordinate: CLLocationCoordinate2D, date: Date) {
        storage[key(coordinate, date)] = (snapshot, Date())
    }

    func purge() {
        let now = Date()
        storage = storage.filter { now.timeIntervalSince($0.value.storedAt) < lifetime }
    }
}
