import Foundation
import CoreLocation
import Combine
import MapKit

/// Decides what the driver is told and when.
///
/// Both hazard reports and route weather converge here so there is exactly one
/// place that answers "is this worth interrupting someone at 70 mph for?".
/// Everything downstream — the CarPlay banner, the phone banner, the spoken
/// line — renders whatever this publishes.
@MainActor
final class AlertEngine: ObservableObject {

    /// The alert currently on screen, if any.
    @Published private(set) var activeAlert: DriverAlert?
    /// Everything raised on this trip, newest first, for the alerts list.
    @Published private(set) var history: [DriverAlert] = []

    /// How long a banner stays up before it clears itself.
    private let alertDuration: TimeInterval = 12
    /// Minimum gap between alerts, so three hazards in a row don't stack into
    /// a wall of banners.
    private let minimumSpacing: TimeInterval = 8

    private var announced = Set<String>()
    private var lastAlertAt: Date?
    private var dismissTask: Task<Void, Never>?

    private var routeCoordinates: [CLLocationCoordinate2D] = []
    private var cumulativeDistances: [CLLocationDistance] = []
    private var weatherSegments: [RouteWeatherSegment] = []
    private var incidents: [Incident] = []

    /// Published for the voice service and the CarPlay layer to subscribe to.
    let alertRaised = PassthroughSubject<DriverAlert, Never>()

    // MARK: - Trip lifecycle

    /// Takes the polyline rather than the `MKRoute` it came from: `MKRoute`
    /// cannot be constructed outside MapKit, and this is the one class whose
    /// "should the driver be told?" decisions are worth unit-testing.
    func beginTrip(polyline: MKPolyline) {
        routeCoordinates = RouteGeometry.coordinates(of: polyline)
        cumulativeDistances = RouteGeometry.cumulativeDistances(routeCoordinates)
        announced.removeAll()
        history.removeAll()
        activeAlert = nil
        lastAlertAt = nil
    }

    func endTrip() {
        dismissTask?.cancel()
        routeCoordinates = []
        cumulativeDistances = []
        weatherSegments = []
        incidents = []
        announced.removeAll()
        activeAlert = nil
    }

    func update(weatherSegments: [RouteWeatherSegment]) {
        self.weatherSegments = weatherSegments
    }

    func update(incidents: [Incident]) {
        self.incidents = incidents
    }

    /// Severe-weather warnings are announced once, at the moment they are
    /// known, rather than at a distance — they cover whole regions.
    func announce(warnings: [WeatherWarning]) {
        for warning in warnings where warning.severity >= .moderate {
            raise(DriverAlert(warning: warning))
        }
    }

    // MARK: - Proximity

    /// Called on every location update while navigating.
    func evaluate(at location: CLLocation) {
        guard !routeCoordinates.isEmpty,
              let snapped = RouteGeometry.snap(
                  location.coordinate,
                  to: routeCoordinates,
                  cumulative: cumulativeDistances
              )
        else { return }

        let travelled = snapped.distanceAlongRoute
        evaluateIncidents(from: location, travelled: travelled)
        evaluateWeather(travelled: travelled, speed: location.speed)
    }

    private func evaluateIncidents(from location: CLLocation, travelled: CLLocationDistance) {
        for incident in incidents where incident.isActive {
            guard let snapped = RouteGeometry.snap(
                incident.coordinate.clCoordinate,
                to: routeCoordinates,
                cumulative: cumulativeDistances
            ) else { continue }

            let distanceAhead = snapped.distanceAlongRoute - travelled
            // Only ahead, and only once inside the warning window for its kind.
            guard distanceAhead > 0, distanceAhead <= incident.kind.warningDistance else { continue }

            raise(DriverAlert(incident: incident, distanceAhead: distanceAhead))
        }
    }

    private func evaluateWeather(travelled: CLLocationDistance, speed: CLLocationSpeed) {
        // Weather is warned about on time, not distance: two minutes' notice at
        // 30 km/h in town is a few hundred metres, on a motorway it is a couple
        // of kilometres, and the driver wants the same warning in both.
        let effectiveSpeed = max(speed, 8)
        let lead = effectiveSpeed * 150

        for segment in weatherSegments where segment.severity >= .moderate {
            let distanceAhead = segment.distanceAlongRoute - travelled
            guard distanceAhead > 0, distanceAhead <= lead else { continue }
            raise(DriverAlert(weather: segment, distanceAhead: distanceAhead))
        }
    }

    // MARK: - Raising

    private func raise(_ alert: DriverAlert) {
        guard !announced.contains(alert.id) else { return }
        if let lastAlertAt, Date().timeIntervalSince(lastAlertAt) < minimumSpacing {
            // Too soon after the last one. Leave it unannounced so the next
            // location update reconsiders it — proximity has only got better.
            return
        }

        announced.insert(alert.id)
        lastAlertAt = Date()
        activeAlert = alert
        history.insert(alert, at: 0)
        alertRaised.send(alert)

        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(self?.alertDuration ?? 12))
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.dismissActive(alert) }
        }
    }

    func dismissActive(_ alert: DriverAlert? = nil) {
        if let alert, activeAlert?.id != alert.id { return }
        activeAlert = nil
    }
}
