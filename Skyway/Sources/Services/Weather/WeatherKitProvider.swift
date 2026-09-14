import Foundation
import CoreLocation
import WeatherKit

/// Apple's own forecast data, including official severe-weather alerts.
///
/// Requires the WeatherKit capability on the App ID and a paid Apple Developer
/// Program membership; there is a monthly call allowance, which is why every
/// lookup goes through `WeatherCache`. `AppEnvironment` falls back to
/// `OpenMeteoProvider` when the capability is missing.
@available(iOS 16.0, *)
struct WeatherKitProvider: WeatherProvider {
    private let service = WeatherService.shared
    private let cache: WeatherCache

    init(cache: WeatherCache = WeatherCache()) {
        self.cache = cache
    }

    func snapshot(at coordinate: CLLocationCoordinate2D, date: Date) async throws -> WeatherSnapshot {
        if let cached = await cache.value(for: coordinate, date: date) { return cached }

        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let hourly = try await service.weather(for: location, including: .hourly)

        guard let hour = hourly.forecast.min(by: {
            abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date))
        }) else {
            throw WeatherProviderError.noDataForDate
        }

        let snapshot = WeatherSnapshot(
            coordinate: Coordinate(coordinate),
            date: hour.date,
            condition: SkyCondition(hour.condition),
            temperature: hour.temperature.converted(to: .celsius).value,
            apparentTemperature: hour.apparentTemperature.converted(to: .celsius).value,
            precipitationAmount: hour.precipitationAmount.converted(to: .millimeters).value,
            precipitationChance: hour.precipitationChance,
            windSpeed: hour.wind.speed.converted(to: .metersPerSecond).value,
            windGust: hour.wind.gust?.converted(to: .metersPerSecond).value,
            visibility: hour.visibility.converted(to: .meters).value,
            isDaylight: hour.isDaylight
        )
        await cache.store(snapshot, for: coordinate, date: date)
        return snapshot
    }

    func hourly(at coordinate: CLLocationCoordinate2D, hours: Int) async throws -> [HourlyForecast] {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let forecast = try await service.weather(for: location, including: .hourly)
        let now = Date().addingTimeInterval(-3_600)

        return forecast.forecast
            .filter { $0.date >= now }
            .prefix(hours)
            .map {
                HourlyForecast(
                    date: $0.date,
                    condition: SkyCondition($0.condition),
                    temperature: $0.temperature.converted(to: .celsius).value,
                    precipitationChance: $0.precipitationChance
                )
            }
    }

    func warnings(at coordinate: CLLocationCoordinate2D) async throws -> [WeatherWarning] {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let alerts = try await service.weather(for: location, including: .alerts) else { return [] }

        return alerts.map { alert in
            WeatherWarning(
                id: alert.detailsURL.absoluteString,
                summary: alert.summary,
                severity: DrivingSeverity(alert.severity),
                region: alert.region,
                issuedAt: alert.metadata.date,
                expiresAt: alert.metadata.expirationDate,
                detailsURL: alert.detailsURL
            )
        }
    }
}

// MARK: - Mapping WeatherKit's vocabulary onto ours

@available(iOS 16.0, *)
extension SkyCondition {
    init(_ condition: WeatherKit.WeatherCondition) {
        switch condition {
        case .clear, .mostlyClear, .hot:
            self = .clear
        case .partlyCloudy:
            self = .partlyCloudy
        case .cloudy, .mostlyCloudy, .smoky, .haze:
            self = .cloudy
        case .foggy:
            self = .fog
        case .drizzle:
            self = .drizzle
        case .rain, .sunShowers:
            self = .rain
        case .heavyRain:
            self = .heavyRain
        case .freezingDrizzle, .freezingRain, .wintryMix:
            self = .freezingRain
        case .snow, .flurries, .sunFlurries, .blowingSnow:
            self = .snow
        case .heavySnow, .blizzard:
            self = .heavySnow
        case .sleet:
            self = .sleet
        case .hail:
            self = .hail
        case .thunderstorms, .isolatedThunderstorms, .scatteredThunderstorms, .strongStorms, .tropicalStorm, .hurricane:
            self = .thunderstorms
        case .windy, .breezy, .blowingDust:
            self = .windy
        case .frigid:
            self = .clear
        @unknown default:
            self = .unknown
        }
    }
}

@available(iOS 16.0, *)
extension DrivingSeverity {
    init(_ severity: WeatherSeverity) {
        switch severity {
        case .extreme, .severe: self = .high
        case .moderate: self = .moderate
        case .minor: self = .low
        case .unknown: self = .low
        @unknown default: self = .low
        }
    }
}
