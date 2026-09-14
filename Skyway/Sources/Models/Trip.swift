import Foundation
import CoreLocation
import MapKit

/// A place the driver can navigate to.
struct Destination: Identifiable, Equatable, Sendable {
    let id = UUID()
    let name: String
    let subtitle: String?
    let coordinate: Coordinate

    init(name: String, subtitle: String? = nil, coordinate: CLLocationCoordinate2D) {
        self.name = name
        self.subtitle = subtitle
        self.coordinate = Coordinate(coordinate)
    }

    init(mapItem: MKMapItem) {
        self.name = mapItem.name ?? "Dropped pin"
        self.subtitle = mapItem.placemark.title
        self.coordinate = Coordinate(mapItem.placemark.coordinate)
    }

    var mapItem: MKMapItem {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate.clCoordinate))
        item.name = name
        return item
    }
}

/// One routing option. We keep MapKit's `MKRoute` alongside our own fields so
/// the CarPlay layer can build a `CPRouteChoice` without re-deriving anything.
struct RouteOption: Identifiable {
    let id = UUID()
    let route: MKRoute
    /// Populated by `RouteWeatherService` once the scan finishes.
    var weatherSegments: [RouteWeatherSegment] = []
    /// Incidents that sit on this route, in the direction of travel.
    var incidents: [Incident] = []

    var name: String { route.name }
    var distance: CLLocationDistance { route.distance }
    var expectedTravelTime: TimeInterval { route.expectedTravelTime }
    var polyline: MKPolyline { route.polyline }
    var steps: [MKRoute.Step] { route.steps }

    var worstWeather: DrivingSeverity {
        weatherSegments.map(\.severity).max() ?? .none
    }

    /// Short line shown under the route name in trip previews, e.g.
    /// "23 min · 18 km · rain, 1 hazard".
    func summary(formatter: MeasurementFormatter = .distance) -> String {
        var parts: [String] = [
            Duration.seconds(expectedTravelTime).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)),
            formatter.string(from: Measurement(value: distance, unit: UnitLength.meters))
        ]
        if worstWeather >= .moderate,
           let worst = weatherSegments.max(by: { $0.severity < $1.severity }) {
            parts.append(worst.snapshot.condition.description.lowercased())
        }
        if !incidents.isEmpty {
            parts.append("\(incidents.count) alert\(incidents.count == 1 ? "" : "s")")
        }
        return parts.joined(separator: " · ")
    }
}

/// Live progress along the active route, recomputed on every location update.
struct TripProgress: Equatable, Sendable {
    var distanceRemaining: CLLocationDistance
    var timeRemaining: TimeInterval
    var distanceToNextManeuver: CLLocationDistance
    var stepIndex: Int
    var isOffRoute: Bool

    var estimatedArrival: Date { Date().addingTimeInterval(timeRemaining) }

    static let zero = TripProgress(
        distanceRemaining: 0,
        timeRemaining: 0,
        distanceToNextManeuver: 0,
        stepIndex: 0,
        isOffRoute: false
    )
}

extension MeasurementFormatter {
    static let distance: MeasurementFormatter = {
        let formatter = MeasurementFormatter()
        formatter.unitOptions = .naturalScale
        formatter.unitStyle = .medium
        formatter.numberFormatter.maximumFractionDigits = 1
        return formatter
    }()
}
