import Foundation
import CoreLocation
import MapKit
import Combine

/// Owns the active trip: fetches route choices, tracks progress against the
/// chosen one, and reroutes when the driver leaves it.
///
/// Deliberately UI-free. The phone HUD and the CarPlay `CPNavigationSession`
/// are both just observers, which is what lets guidance survive the phone
/// screen locking while CarPlay keeps driving.
@MainActor
final class NavigationService: ObservableObject {

    enum State: Equatable {
        case idle
        case planning
        /// Route choices computed, waiting for the driver to pick one.
        case previewing
        case navigating
        case arrived
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var routeOptions: [RouteOption] = []
    @Published private(set) var activeRoute: RouteOption?
    @Published private(set) var destination: Destination?
    @Published private(set) var progress: TripProgress = .zero
    @Published private(set) var currentStep: MKRoute.Step?
    @Published private(set) var nextStep: MKRoute.Step?
    @Published private(set) var lastError: String?

    /// Distance from the route beyond which we consider the driver off it.
    private let offRouteThreshold: CLLocationDistance = 45
    /// Consecutive off-route fixes required before rerouting. Guards against a
    /// single bad GPS fix in an urban canyon triggering a pointless reroute.
    private let offRouteFixesBeforeReroute = 3

    private var routeCoordinates: [CLLocationCoordinate2D] = []
    private var cumulativeDistances: [CLLocationDistance] = []
    private var stepStartDistances: [CLLocationDistance] = []
    private var offRouteCount = 0
    private var lastRerouteAt: Date?
    private var searchStartIndex = 0

    private let locationService: LocationService
    private var cancellables = Set<AnyCancellable>()

    /// Fires when a reroute produces a new route, so CarPlay can swap the
    /// polyline it is drawing.
    let routeDidChange = PassthroughSubject<RouteOption, Never>()
    /// Fires once when the driver reaches the destination.
    let didArrive = PassthroughSubject<Destination, Never>()

    init(locationService: LocationService) {
        self.locationService = locationService

        locationService.$location
            .compactMap { $0 }
            .sink { [weak self] location in
                self?.handleLocationUpdate(location)
            }
            .store(in: &cancellables)
    }

    // MARK: - Planning

    /// Asks MapKit for route choices to `destination`. Returns alternates so
    /// the driver can trade a few minutes for better weather.
    func planTrip(to destination: Destination) async {
        guard let origin = locationService.location else {
            lastError = "Waiting for a GPS fix."
            return
        }

        state = .planning
        self.destination = destination
        lastError = nil

        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
        request.destination = destination.mapItem
        request.transportType = .automobile
        request.requestsAlternateRoutes = true

        do {
            let response = try await MKDirections(request: request).calculate()
            routeOptions = response.routes.map { RouteOption(route: $0) }
            state = routeOptions.isEmpty ? .idle : .previewing
            if routeOptions.isEmpty { lastError = "No driving route found." }
        } catch {
            routeOptions = []
            state = .idle
            lastError = error.localizedDescription
        }
    }

    /// Replaces a route option in place — used when the weather scan or the
    /// incident matcher finishes and has extra detail to attach.
    func update(_ option: RouteOption) {
        if let index = routeOptions.firstIndex(where: { $0.id == option.id }) {
            routeOptions[index] = option
        }
        if activeRoute?.id == option.id {
            activeRoute = option
        }
    }

    // MARK: - Navigating

    func startNavigating(_ option: RouteOption) {
        activeRoute = option
        state = .navigating
        prepareGeometry(for: option.route)
        locationService.startNavigating()
        if let location = locationService.location {
            handleLocationUpdate(location)
        }
    }

    func cancelTrip() {
        state = .idle
        activeRoute = nil
        destination = nil
        routeOptions = []
        currentStep = nil
        nextStep = nil
        progress = .zero
        routeCoordinates = []
        cumulativeDistances = []
        stepStartDistances = []
        offRouteCount = 0
        searchStartIndex = 0
        locationService.startBrowsing()
    }

    private func prepareGeometry(for route: MKRoute) {
        routeCoordinates = RouteGeometry.coordinates(of: route.polyline)
        cumulativeDistances = RouteGeometry.cumulativeDistances(routeCoordinates)
        searchStartIndex = 0
        offRouteCount = 0

        // Each step carries its own polyline; matching its first coordinate to
        // the full route tells us where the step begins in route distance.
        stepStartDistances = route.steps.map { step in
            guard let first = RouteGeometry.coordinates(of: step.polyline).first,
                  let snapped = RouteGeometry.snap(
                      first,
                      to: routeCoordinates,
                      cumulative: cumulativeDistances
                  )
            else { return 0 }
            return snapped.distanceAlongRoute
        }

        currentStep = route.steps.first
        nextStep = route.steps.count > 1 ? route.steps[1] : nil
    }

    // MARK: - Progress

    private func handleLocationUpdate(_ location: CLLocation) {
        guard state == .navigating,
              let route = activeRoute,
              let snapped = RouteGeometry.snap(
                  location.coordinate,
                  to: routeCoordinates,
                  cumulative: cumulativeDistances,
                  searchingFrom: max(0, searchStartIndex - 5)
              )
        else { return }

        // Only ever search forward from where we were: on a route that doubles
        // back on itself, a global nearest-point search can teleport progress.
        searchStartIndex = snapped.segmentIndex

        let totalDistance = cumulativeDistances.last ?? route.distance
        let distanceRemaining = max(0, totalDistance - snapped.distanceAlongRoute)
        let isOffRoute = snapped.lateralDistance > offRouteThreshold

        let stepIndex = currentStepIndex(for: snapped.distanceAlongRoute)
        let nextStepStart = stepIndex + 1 < stepStartDistances.count
            ? stepStartDistances[stepIndex + 1]
            : totalDistance

        progress = TripProgress(
            distanceRemaining: distanceRemaining,
            timeRemaining: estimateTimeRemaining(
                distanceRemaining: distanceRemaining,
                totalDistance: totalDistance,
                totalTime: route.expectedTravelTime,
                currentSpeed: location.speed
            ),
            distanceToNextManeuver: max(0, nextStepStart - snapped.distanceAlongRoute),
            stepIndex: stepIndex,
            isOffRoute: isOffRoute
        )

        if stepIndex < route.steps.count {
            currentStep = route.steps[stepIndex]
            nextStep = stepIndex + 1 < route.steps.count ? route.steps[stepIndex + 1] : nil
        }

        if distanceRemaining < 40 {
            arrive()
            return
        }

        if isOffRoute {
            offRouteCount += 1
            if offRouteCount >= offRouteFixesBeforeReroute { Task { await reroute() } }
        } else {
            offRouteCount = 0
        }
    }

    private func currentStepIndex(for distanceAlongRoute: CLLocationDistance) -> Int {
        // The last step whose start we have already passed.
        var index = 0
        for (candidate, start) in stepStartDistances.enumerated() where start <= distanceAlongRoute {
            index = candidate
        }
        return index
    }

    /// Blends the route's own estimate with the speed actually being driven,
    /// so a slow crawl in traffic pushes the ETA out instead of pretending.
    private func estimateTimeRemaining(
        distanceRemaining: CLLocationDistance,
        totalDistance: CLLocationDistance,
        totalTime: TimeInterval,
        currentSpeed: CLLocationSpeed
    ) -> TimeInterval {
        guard totalDistance > 0 else { return 0 }
        let plannedAverage = totalDistance / totalTime
        let plannedEstimate = distanceRemaining / max(plannedAverage, 1)

        guard currentSpeed > 2 else { return plannedEstimate }
        let observedEstimate = distanceRemaining / currentSpeed
        // Weight the plan more heavily; a momentary 20 km/h in a village should
        // not claim the remaining motorway will be driven at 20 km/h.
        return plannedEstimate * 0.75 + observedEstimate * 0.25
    }

    private func arrive() {
        guard let destination else { return }
        state = .arrived
        progress = .zero
        didArrive.send(destination)
        locationService.startBrowsing()
    }

    // MARK: - Rerouting

    private func reroute() async {
        // Rate-limit: a driver stuck on a service road shouldn't trigger a
        // reroute on every fix.
        if let lastRerouteAt, Date().timeIntervalSince(lastRerouteAt) < 15 { return }
        guard let destination, let origin = locationService.location else { return }

        lastRerouteAt = Date()
        offRouteCount = 0

        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
        request.destination = destination.mapItem
        request.transportType = .automobile

        guard let route = try? await MKDirections(request: request).calculate().routes.first else { return }

        let option = RouteOption(route: route)
        activeRoute = option
        routeOptions = [option]
        prepareGeometry(for: route)
        routeDidChange.send(option)
    }
}
