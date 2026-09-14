import Foundation
import Combine
import CoreLocation
import MapKit

/// The composition root, and the one object both scenes share.
///
/// This matters more than it looks: the phone UI and the CarPlay UI are
/// separate `UIScene`s with separate lifecycles, and a trip started on one has
/// to be the same trip on the other. Holding a single instance here — rather
/// than letting each scene build its own services — is what makes "start
/// navigating on the phone, walk to the car, it's already going" work.
@MainActor
final class AppEnvironment: ObservableObject {

    static let shared = AppEnvironment()

    let locationService: LocationService
    let searchService: SearchService
    let navigationService: NavigationService
    let incidentService: IncidentService
    let voiceService: VoiceGuidanceService
    let alertEngine: AlertEngine
    let routeWeather: RouteWeatherService
    let weatherProvider: WeatherProvider

    /// Conditions where the car is now, refreshed as it moves.
    @Published private(set) var currentWeather: WeatherSnapshot?
    /// Hour-by-hour at the destination, for the arrival strip.
    @Published private(set) var destinationForecast: [HourlyForecast] = []
    /// Set when CarPlay is connected, so the phone can show "Connected to car".
    @Published var isCarPlayConnected = false

    private var cancellables = Set<AnyCancellable>()
    private var weatherRefreshTask: Task<Void, Never>?
    /// One scan per route option: previewing three routes runs three scans,
    /// and cancelling one must not cancel the others.
    private var scanTasks: [UUID: Task<Void, Never>] = [:]
    private var lastWeatherCoordinate: CLLocationCoordinate2D?

    private init() {
        let weatherProvider = Self.makeWeatherProvider()
        self.weatherProvider = weatherProvider
        self.routeWeather = RouteWeatherService(provider: weatherProvider)

        let locationService = LocationService()
        self.locationService = locationService
        self.searchService = SearchService()
        self.navigationService = NavigationService(locationService: locationService)
        self.incidentService = IncidentService(store: Self.makeIncidentStore())
        self.voiceService = VoiceGuidanceService()
        self.alertEngine = AlertEngine()

        wire()
    }

    /// WeatherKit when the capability is present, Open-Meteo otherwise.
    ///
    /// The check is a build-setting flag rather than a runtime probe: WeatherKit
    /// fails at the first request, not at init, so probing would mean a failed
    /// forecast before the fallback kicks in.
    private static func makeWeatherProvider() -> WeatherProvider {
        #if USE_WEATHERKIT
        if #available(iOS 16.0, *) { return WeatherKitProvider() }
        #endif
        return OpenMeteoProvider()
    }

    private static func makeIncidentStore() -> IncidentStore {
        if let string = Bundle.main.object(forInfoDictionaryKey: "SkywayIncidentBaseURL") as? String,
           !string.isEmpty,
           let url = URL(string: string) {
            return RemoteIncidentStore(baseURL: url)
        }
        return LocalIncidentStore()
    }

    // MARK: - Wiring

    private func wire() {
        voiceService.configureAudioSession()

        // Local weather and search bias follow the car.
        locationService.$location
            .compactMap { $0 }
            .sink { [weak self] location in
                self?.handleLocation(location)
            }
            .store(in: &cancellables)

        // Every raised alert is also spoken.
        alertEngine.alertRaised
            .sink { [weak self] alert in
                self?.voiceService.announce(alert)
            }
            .store(in: &cancellables)

        // A reroute means the weather scan and incident match are stale.
        navigationService.routeDidChange
            .sink { [weak self] option in
                self?.alertEngine.beginTrip(polyline: option.polyline)
                self?.scanWeather(for: option)
            }
            .store(in: &cancellables)

        navigationService.didArrive
            .sink { [weak self] destination in
                self?.voiceService.announceArrival(at: destination)
                self?.alertEngine.endTrip()
            }
            .store(in: &cancellables)

        // Fresh reports need re-matching against the route as they arrive.
        incidentService.$nearby
            .sink { [weak self] _ in
                guard let self, let route = navigationService.activeRoute else { return }
                alertEngine.update(incidents: incidentService.incidents(on: route.route))
            }
            .store(in: &cancellables)
    }

    private func handleLocation(_ location: CLLocation) {
        searchService.updateRegion(around: location.coordinate)

        if navigationService.state == .navigating {
            alertEngine.evaluate(at: location)

            if let step = navigationService.currentStep {
                voiceService.announceIfNeeded(
                    step: step,
                    stepIndex: navigationService.progress.stepIndex,
                    distanceToManeuver: navigationService.progress.distanceToNextManeuver,
                    speed: location.speed
                )
            }
        }

        refreshCurrentWeatherIfNeeded(at: location.coordinate)

        Task { [weak self] in
            await self?.incidentService.refreshIfNeeded(around: location.coordinate)
        }
    }

    // MARK: - Weather

    /// Refetches local conditions once the car has moved far enough for the
    /// forecast cell to plausibly have changed.
    private func refreshCurrentWeatherIfNeeded(at coordinate: CLLocationCoordinate2D) {
        if let last = lastWeatherCoordinate,
           RouteGeometry.distance(last, coordinate) < 5_000,
           currentWeather != nil {
            return
        }
        lastWeatherCoordinate = coordinate

        weatherRefreshTask?.cancel()
        weatherRefreshTask = Task { [weak self] in
            guard let self else { return }
            let snapshot = try? await weatherProvider.snapshot(at: coordinate, date: Date())
            guard !Task.isCancelled else { return }
            currentWeather = snapshot
        }
    }

    /// Runs the route weather scan and folds the result back into the route
    /// option, the alert engine and the destination strip.
    func scanWeather(for option: RouteOption) {
        scanTasks[option.id]?.cancel()
        scanTasks[option.id] = Task { [weak self] in
            guard let self else { return }

            let segments = await routeWeather.scan(route: option.route)
            guard !Task.isCancelled else { return }

            var updated = option
            updated.weatherSegments = segments
            updated.incidents = incidentService.incidents(on: option.route)
            navigationService.update(updated)
            alertEngine.update(weatherSegments: segments)
            alertEngine.update(incidents: updated.incidents)

            if let destination = navigationService.destination {
                destinationForecast = (try? await weatherProvider.hourly(
                    at: destination.coordinate.clCoordinate,
                    hours: 12
                )) ?? []
            }

            let warnings = await routeWeather.warnings(route: option.route)
            guard !Task.isCancelled else { return }
            alertEngine.announce(warnings: warnings)
        }
    }

    // MARK: - Trip control (shared by both scenes)

    func planTrip(to destination: Destination) async {
        await navigationService.planTrip(to: destination)
        // Scan every option, so the driver can compare weather before choosing.
        for option in navigationService.routeOptions {
            scanWeather(for: option)
        }
    }

    func startTrip(_ option: RouteOption) {
        navigationService.startNavigating(option)
        alertEngine.beginTrip(polyline: option.polyline)
        alertEngine.update(weatherSegments: option.weatherSegments)
        alertEngine.update(incidents: incidentService.incidents(on: option.route))
        voiceService.reset()
    }

    func cancelTrip() {
        scanTasks.values.forEach { $0.cancel() }
        scanTasks.removeAll()
        navigationService.cancelTrip()
        alertEngine.endTrip()
        voiceService.reset()
        destinationForecast = []
    }

    func report(_ kind: Incident.Kind) async {
        guard let location = locationService.location else { return }
        await incidentService.report(
            kind,
            at: location.coordinate,
            heading: locationService.heading ?? location.course
        )
        voiceService.speak("\(kind.title) reported. Thanks.")
    }
}
