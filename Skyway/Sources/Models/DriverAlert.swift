import Foundation
import CoreLocation

/// Everything the driver gets warned about funnels through this one type,
/// whether it came from the crowd or from the sky. The CarPlay layer turns it
/// into a `CPNavigationAlert`; the phone layer into a banner; the voice layer
/// into a spoken line.
struct DriverAlert: Identifiable, Equatable, Sendable {
    enum Source: Equatable, Sendable {
        case incident(Incident)
        case weather(RouteWeatherSegment)
        case severeWeather(WeatherWarning)
    }

    let id: String
    let source: Source
    let title: String
    let subtitle: String?
    let spokenText: String
    let symbolName: String
    let severity: DrivingSeverity
    /// Metres ahead of the driver when the alert was raised.
    let distanceAhead: CLLocationDistance?
    let createdAt: Date

    /// Alerts of the same identity are only ever shown once per trip.
    static func == (lhs: DriverAlert, rhs: DriverAlert) -> Bool { lhs.id == rhs.id }
}

extension DriverAlert {
    init(incident: Incident, distanceAhead: CLLocationDistance) {
        let distanceText = Self.distanceText(distanceAhead)
        self.init(
            id: "incident-\(incident.id.uuidString)",
            source: .incident(incident),
            title: incident.kind.title,
            subtitle: "\(distanceText) ahead",
            spokenText: "\(incident.kind.title) reported \(distanceText) ahead.",
            symbolName: incident.kind.symbolName,
            severity: incident.kind == .roadClosed ? .high : .moderate,
            distanceAhead: distanceAhead,
            createdAt: Date()
        )
    }

    init(weather segment: RouteWeatherSegment, distanceAhead: CLLocationDistance) {
        let condition = segment.snapshot.condition.description
        let distanceText = Self.distanceText(distanceAhead)
        let place = segment.placeName.map { " near \($0)" } ?? ""
        self.init(
            id: "weather-\(segment.snapshot.condition.rawValue)-\(Int(segment.distanceAlongRoute / 5_000))",
            source: .weather(segment),
            title: condition,
            subtitle: "\(distanceText) ahead\(place)",
            spokenText: "\(condition)\(place), \(distanceText) ahead.",
            symbolName: segment.snapshot.condition.symbolName,
            severity: segment.severity,
            distanceAhead: distanceAhead,
            createdAt: Date()
        )
    }

    init(warning: WeatherWarning) {
        self.init(
            id: "warning-\(warning.id)",
            source: .severeWeather(warning),
            title: warning.summary,
            subtitle: warning.region,
            spokenText: "Weather warning on your route. \(warning.summary).",
            symbolName: "exclamationmark.triangle.fill",
            severity: warning.severity,
            distanceAhead: nil,
            createdAt: Date()
        )
    }

    private static func distanceText(_ metres: CLLocationDistance) -> String {
        let measurement = Measurement(value: metres, unit: UnitLength.meters)
        return MeasurementFormatter.distance.string(from: measurement)
    }
}
