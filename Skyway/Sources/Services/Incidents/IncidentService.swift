import Foundation
import CoreLocation
import Combine
import MapKit

/// Observable façade over an `IncidentStore`: keeps a live set of nearby
/// reports for the map, and matches reports against the active route.
@MainActor
final class IncidentService: ObservableObject {
    @Published private(set) var nearby: [Incident] = []
    @Published private(set) var isReporting = false

    private let store: IncidentStore
    private let refreshInterval: TimeInterval = 45
    private let searchRadius: CLLocationDistance = 25_000

    private var lastRefresh = Date.distantPast
    private var lastRefreshCoordinate: CLLocationCoordinate2D?

    init(store: IncidentStore) {
        self.store = store
    }

    /// Refetches nearby reports, but only when it is worth the round trip:
    /// either enough time has passed or the car has moved far enough that the
    /// previous search radius no longer covers what is ahead.
    func refreshIfNeeded(around coordinate: CLLocationCoordinate2D) async {
        let movedFar = lastRefreshCoordinate.map {
            RouteGeometry.distance($0, coordinate) > searchRadius / 3
        } ?? true
        let staleEnough = Date().timeIntervalSince(lastRefresh) > refreshInterval
        guard movedFar || staleEnough else { return }

        await refresh(around: coordinate)
    }

    func refresh(around coordinate: CLLocationCoordinate2D) async {
        lastRefresh = Date()
        lastRefreshCoordinate = coordinate
        nearby = (try? await store.incidents(near: coordinate, radius: searchRadius)) ?? []
    }

    /// Files a report at the driver's current position. Called from the phone
    /// sheet and from the CarPlay grid — one tap, no confirmation dialog,
    /// because the driver is driving.
    func report(
        _ kind: Incident.Kind,
        at coordinate: CLLocationCoordinate2D,
        heading: CLLocationDirection?
    ) async {
        isReporting = true
        defer { isReporting = false }

        let incident = Incident(
            kind: kind,
            coordinate: coordinate,
            heading: heading,
            upvotes: 1
        )
        try? await store.report(incident)
        nearby.append(incident)
    }

    func vote(on incident: Incident, confirms: Bool) async {
        try? await store.vote(on: incident.id, confirms: confirms)
        guard let index = nearby.firstIndex(where: { $0.id == incident.id }) else { return }
        if confirms { nearby[index].upvotes += 1 } else { nearby[index].downvotes += 1 }
        if !nearby[index].isCredible { nearby.remove(at: index) }
    }

    /// Incidents that actually sit on the route, in the direction of travel.
    ///
    /// Two filters matter here. Lateral distance keeps out reports on a
    /// parallel street; bearing keeps out reports on the opposite carriageway
    /// of a dual carriageway, which is the classic false positive.
    func incidents(
        on route: MKRoute,
        corridorWidth: CLLocationDistance = 60
    ) -> [Incident] {
        let coordinates = RouteGeometry.coordinates(of: route.polyline)
        let cumulative = RouteGeometry.cumulativeDistances(coordinates)
        guard coordinates.count >= 2 else { return [] }

        return nearby.compactMap { incident -> (Incident, CLLocationDistance)? in
            guard incident.isActive,
                  let snapped = RouteGeometry.snap(
                      incident.coordinate.clCoordinate,
                      to: coordinates,
                      cumulative: cumulative
                  ),
                  snapped.lateralDistance <= corridorWidth
            else { return nil }

            if let reportedHeading = incident.heading {
                let segmentIndex = min(snapped.segmentIndex, coordinates.count - 2)
                let routeBearing = RouteGeometry.bearing(
                    from: coordinates[segmentIndex],
                    to: coordinates[segmentIndex + 1]
                )
                // More than 90° apart means the reporter was travelling the
                // other way; that jam is not the driver's problem.
                guard RouteGeometry.angleBetween(reportedHeading, routeBearing) < 90 else { return nil }
            }

            return (incident, snapped.distanceAlongRoute)
        }
        .sorted { $0.1 < $1.1 }
        .map(\.0)
    }
}
