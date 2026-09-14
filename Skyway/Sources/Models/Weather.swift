import Foundation
import CoreLocation

/// A normalised weather condition. Both the WeatherKit and Open-Meteo
/// providers map onto this so the rest of the app never branches on source.
enum SkyCondition: String, Codable, Sendable {
    case clear
    case partlyCloudy
    case cloudy
    case fog
    case drizzle
    case rain
    case heavyRain
    case freezingRain
    case snow
    case heavySnow
    case sleet
    case hail
    case thunderstorms
    case windy
    case unknown

    var symbolName: String {
        switch self {
        case .clear: return "sun.max.fill"
        case .partlyCloudy: return "cloud.sun.fill"
        case .cloudy: return "cloud.fill"
        case .fog: return "cloud.fog.fill"
        case .drizzle: return "cloud.drizzle.fill"
        case .rain: return "cloud.rain.fill"
        case .heavyRain: return "cloud.heavyrain.fill"
        case .freezingRain: return "thermometer.snowflake"
        case .snow: return "cloud.snow.fill"
        case .heavySnow: return "wind.snow"
        case .sleet: return "cloud.sleet.fill"
        case .hail: return "cloud.hail.fill"
        case .thunderstorms: return "cloud.bolt.rain.fill"
        case .windy: return "wind"
        case .unknown: return "questionmark.circle"
        }
    }

    var description: String {
        switch self {
        case .clear: return "Clear"
        case .partlyCloudy: return "Partly cloudy"
        case .cloudy: return "Cloudy"
        case .fog: return "Fog"
        case .drizzle: return "Drizzle"
        case .rain: return "Rain"
        case .heavyRain: return "Heavy rain"
        case .freezingRain: return "Freezing rain"
        case .snow: return "Snow"
        case .heavySnow: return "Heavy snow"
        case .sleet: return "Sleet"
        case .hail: return "Hail"
        case .thunderstorms: return "Thunderstorms"
        case .windy: return "Windy"
        case .unknown: return "Unknown"
        }
    }

    /// How much this condition should worry a driver. Drives whether the
    /// route-weather scan raises an alert and how loudly.
    var drivingSeverity: DrivingSeverity {
        switch self {
        case .clear, .partlyCloudy, .cloudy: return .none
        case .drizzle, .windy: return .low
        case .rain, .fog, .snow, .sleet: return .moderate
        case .heavyRain, .heavySnow, .freezingRain, .hail, .thunderstorms: return .high
        case .unknown: return .none
        }
    }
}

enum DrivingSeverity: Int, Codable, Comparable, Sendable {
    case none = 0
    case low = 1
    case moderate = 2
    case high = 3

    static func < (lhs: DrivingSeverity, rhs: DrivingSeverity) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// Conditions at one point in space and time.
struct WeatherSnapshot: Codable, Equatable, Sendable {
    let coordinate: Coordinate
    let date: Date
    let condition: SkyCondition
    /// Celsius.
    let temperature: Double
    /// Celsius, accounting for wind chill / humidity.
    let apparentTemperature: Double
    /// Millimetres in the hour containing `date`.
    let precipitationAmount: Double
    /// 0...1.
    let precipitationChance: Double
    /// Metres per second.
    let windSpeed: Double
    /// Metres per second.
    let windGust: Double?
    /// Metres.
    let visibility: Double?
    let isDaylight: Bool

    /// Severity that also accounts for the numbers, not just the label —
    /// clear skies with 25 m/s gusts still deserve a warning.
    var drivingSeverity: DrivingSeverity {
        var severity = condition.drivingSeverity
        let gust = windGust ?? windSpeed
        if gust >= 25 { severity = max(severity, .high) }
        else if gust >= 17 { severity = max(severity, .moderate) }
        if let visibility, visibility < 200 { severity = max(severity, .high) }
        else if let visibility, visibility < 1_000 { severity = max(severity, .moderate) }
        // Wet road plus sub-zero air is the classic black-ice setup.
        if temperature <= 1, precipitationAmount > 0 { severity = .high }
        return severity
    }
}

/// One hour of a forecast, used for the destination-arrival strip.
struct HourlyForecast: Identifiable, Codable, Equatable, Sendable {
    var id: Date { date }
    let date: Date
    let condition: SkyCondition
    let temperature: Double
    let precipitationChance: Double
}

/// A stretch of the route where the weather is worth mentioning.
struct RouteWeatherSegment: Identifiable, Equatable, Sendable {
    let id = UUID()
    /// Metres from the start of the route.
    let distanceAlongRoute: CLLocationDistance
    /// When the driver is expected to be here.
    let arrivalTime: Date
    let snapshot: WeatherSnapshot
    /// Best-effort place name for the spoken warning ("rain near Reading").
    var placeName: String?

    var severity: DrivingSeverity { snapshot.drivingSeverity }
}

/// An official severe-weather warning from the weather provider.
struct WeatherWarning: Identifiable, Equatable, Sendable {
    let id: String
    let summary: String
    let severity: DrivingSeverity
    let region: String?
    let issuedAt: Date
    let expiresAt: Date?
    let detailsURL: URL?
}
