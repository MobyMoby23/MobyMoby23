import CarPlay
import MapKit
import Combine
import UIKit

/// Drives every template on the car screen.
///
/// CarPlay is not a view hierarchy you lay out — it is a stack of templates the
/// system renders in its own style, at sizes and contrast levels Apple has
/// decided are safe to read at speed. This class translates the app's state
/// into those templates, and their callbacks back into app actions.
@MainActor
final class CarPlayController: NSObject {

    private let interfaceController: CPInterfaceController
    private let mapViewController: CarPlayMapViewController
    private let environment = AppEnvironment.shared

    private let mapTemplate = CPMapTemplate()
    private var navigationSession: CPNavigationSession?
    /// Maps the route choice the driver tapped back to our own route model.
    private var routeChoiceLookup: [ObjectIdentifier: RouteOption] = [:]
    private var previewedTrip: CPTrip?
    private var currentManeuver: CPManeuver?
    private var lastSearchText = ""
    private var cancellables = Set<AnyCancellable>()

    init(interfaceController: CPInterfaceController, mapViewController: CarPlayMapViewController) {
        self.interfaceController = interfaceController
        self.mapViewController = mapViewController
        super.init()
    }

    func start() {
        configureMapTemplate()
        interfaceController.setRootTemplate(mapTemplate, animated: true, completion: nil)
        observeModel()
        environment.locationService.requestAuthorization()
    }

    func stop() {
        cancellables.removeAll()
        navigationSession?.finishTrip()
        navigationSession = nil
    }

    // MARK: - Root map template

    private func configureMapTemplate() {
        mapTemplate.mapDelegate = self
        mapTemplate.guidanceBackgroundColor = UIColor(red: 0.07, green: 0.09, blue: 0.13, alpha: 1)
        mapTemplate.tripEstimateStyle = .dark
        updateBarButtons()
        updateMapButtons()
    }

    private func updateBarButtons() {
        let search = CPBarButton(image: symbol("magnifyingglass") ?? UIImage()) { [weak self] _ in
            self?.presentSearch()
        }
        let weather = CPBarButton(image: symbol("cloud.sun.fill") ?? UIImage()) { [weak self] _ in
            self?.presentWeather()
        }

        let nearby = CPBarButton(image: symbol("fuelpump.fill") ?? UIImage()) { [weak self] _ in
            self?.presentNearbyGrid()
        }

        // CarPlay allows at most two buttons per side.
        mapTemplate.leadingNavigationBarButtons = [search, nearby]
        mapTemplate.trailingNavigationBarButtons = [weather]
    }

    private func updateMapButtons() {
        // One tap, big target, no confirmation — reporting has to be doable
        // without taking eyes off the road for more than a glance.
        let report = CPMapButton { [weak self] _ in
            self?.presentReportGrid()
        }
        report.image = symbol("exclamationmark.bubble.fill")

        let recentre = CPMapButton { [weak self] _ in
            self?.mapViewController.setTrackingCar(true)
        }
        recentre.image = symbol("location.fill")

        let zoomIn = CPMapButton { [weak self] _ in
            self?.mapViewController.zoom(by: 0.5)
        }
        zoomIn.image = symbol("plus.magnifyingglass")

        let zoomOut = CPMapButton { [weak self] _ in
            self?.mapViewController.zoom(by: 2)
        }
        zoomOut.image = symbol("minus.magnifyingglass")

        mapTemplate.mapButtons = [report, recentre, zoomIn, zoomOut]
    }

    // MARK: - Observation

    private func observeModel() {
        // Progress drives the guidance panel: distance to the next turn and
        // the ETA in the corner both come from here.
        environment.navigationService.$progress
            .throttle(for: .seconds(1), scheduler: RunLoop.main, latest: true)
            .sink { [weak self] progress in
                self?.updateTravelEstimates(progress)
            }
            .store(in: &cancellables)

        environment.navigationService.$currentStep
            .compactMap { $0 }
            .removeDuplicates { $0.instructions == $1.instructions }
            .sink { [weak self] step in
                self?.updateManeuver(step)
            }
            .store(in: &cancellables)

        // Hazards and weather both surface as CarPlay's own alert banner.
        environment.alertEngine.alertRaised
            .sink { [weak self] alert in
                self?.present(alert)
            }
            .store(in: &cancellables)

        environment.navigationService.didArrive
            .sink { [weak self] _ in
                self?.finishTrip()
            }
            .store(in: &cancellables)

        environment.navigationService.routeDidChange
            .sink { [weak self] option in
                self?.handleReroute(option)
            }
            .store(in: &cancellables)
    }

    // MARK: - Search

    private func presentSearch() {
        let searchTemplate = CPSearchTemplate()
        searchTemplate.delegate = self
        interfaceController.pushTemplate(searchTemplate, animated: true, completion: nil)
    }

    private func showResults(_ destinations: [Destination], title: String) {
        let items = destinations.map { destination -> CPListItem in
            let item = CPListItem(text: destination.name, detailText: destination.subtitle)
            item.handler = { [weak self] _, completion in
                completion()
                self?.planTrip(to: destination)
            }
            return item
        }

        let section = CPListSection(items: items)
        let listTemplate = CPListTemplate(title: title, sections: [section])
        interfaceController.pushTemplate(listTemplate, animated: true, completion: nil)
    }

    /// The four things a driver actually stops for mid-trip.
    private func presentNearbyGrid() {
        let categories: [(String, String, MKPointOfInterestCategory)] = [
            ("Fuel", "fuelpump.fill", .gasStation),
            ("Charging", "bolt.car.fill", .evCharger),
            ("Parking", "parkingsign", .parking),
            ("Coffee", "cup.and.saucer.fill", .cafe)
        ]

        var buttons: [CPGridButton] = []
        for (title, symbolName, category) in categories {
            buttons.append(
                CPGridButton(
                    titleVariants: [title],
                    image: symbol(symbolName, pointSize: 44) ?? UIImage()
                ) { [weak self] _ in
                    self?.findNearby(category, title: title)
                }
            )
        }

        interfaceController.pushTemplate(
            CPGridTemplate(title: "Nearby", gridButtons: buttons),
            animated: true,
            completion: nil
        )
    }

    private func findNearby(_ category: MKPointOfInterestCategory, title: String) {
        guard let location = environment.locationService.location else {
            presentError("Waiting for a GPS fix.")
            return
        }

        Task {
            let destinations = (try? await environment.searchService.searchCategory(
                category,
                near: location.coordinate
            )) ?? []

            interfaceController.popTemplate(animated: true) { [weak self] _, _ in
                guard let self else { return }
                guard !destinations.isEmpty else {
                    self.presentError("Nothing found nearby.")
                    return
                }
                self.showResults(destinations, title: title)
            }
        }
    }

    // MARK: - Trip preview

    private func planTrip(to destination: Destination) {
        Task {
            await environment.planTrip(to: destination)

            guard !environment.navigationService.routeOptions.isEmpty else {
                presentError(environment.navigationService.lastError ?? "No route found.")
                return
            }
            showTripPreview(to: destination)

            // The weather scan finishes after the preview is already up, so
            // refresh the route choice text once it lands — the driver sees
            // "rain near Bristol" appear under the slower route.
            try? await Task.sleep(for: .seconds(2))
            guard environment.navigationService.state == .previewing else { return }
            showTripPreview(to: destination)
        }
    }

    private func showTripPreview(to destination: Destination) {
        guard let origin = environment.locationService.location else { return }

        let options = environment.navigationService.routeOptions
        routeChoiceLookup.removeAll()

        let choices = options.map { option -> CPRouteChoice in
            let choice = CPRouteChoice(
                summaryVariants: [option.summary()],
                additionalInformationVariants: [weatherLine(for: option)],
                selectionSummaryVariants: [option.name]
            )
            routeChoiceLookup[ObjectIdentifier(choice)] = option
            return choice
        }

        let trip = CPTrip(
            origin: MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate)),
            destination: destination.mapItem,
            routeChoices: choices
        )
        previewedTrip = trip

        let textConfiguration = CPTripPreviewTextConfiguration(
            startButtonTitle: "Go",
            additionalRoutesButtonTitle: "Routes",
            overviewButtonTitle: "Overview"
        )
        mapTemplate.showTripPreviews([trip], textConfiguration: textConfiguration)
        mapViewController.showRouteOverview()
    }

    /// The second line under a route choice: the reason a driver might pick
    /// the slower option.
    private func weatherLine(for option: RouteOption) -> String {
        var parts: [String] = []

        if let worst = option.weatherSegments.max(by: { $0.severity < $1.severity }),
           worst.severity >= .moderate {
            let place = worst.placeName.map { " near \($0)" } ?? ""
            parts.append("\(worst.snapshot.condition.description)\(place)")
        } else if !option.weatherSegments.isEmpty {
            parts.append("Clear conditions")
        }

        if !option.incidents.isEmpty {
            let kinds = Set(option.incidents.map(\.kind.title))
            parts.append(kinds.sorted().joined(separator: ", "))
        }

        return parts.isEmpty ? "Checking weather…" : parts.joined(separator: " · ")
    }

    // MARK: - Guidance

    private func beginNavigation(with option: RouteOption, trip: CPTrip) {
        environment.startTrip(option)
        mapTemplate.hideTripPreviews()

        let session = mapTemplate.startNavigationSession(for: trip)
        navigationSession = session
        mapViewController.setTrackingCar(true)

        if let step = option.steps.first {
            updateManeuver(step)
        }
    }

    private func updateManeuver(_ step: MKRoute.Step) {
        guard let session = navigationSession else { return }

        let maneuver = CPManeuver()
        // Variants let CarPlay pick the longest string that fits the car's
        // screen — a 7-inch head unit gets the short one, a widescreen the full
        // instruction.
        maneuver.instructionVariants = instructionVariants(for: step)
        maneuver.symbolImage = maneuverSymbol(for: step)
        maneuver.initialTravelEstimates = CPTravelEstimates(
            distanceRemaining: Measurement(value: step.distance, unit: UnitLength.meters),
            timeRemaining: 0
        )

        currentManeuver = maneuver
        session.upcomingManeuvers = [maneuver]
    }

    private func updateTravelEstimates(_ progress: TripProgress) {
        guard let session = navigationSession, let trip = previewedTrip else { return }

        // Two separate estimates: the whole trip (shown as ETA) and the next
        // manoeuvre (shown as "400 m" above the turn arrow).
        let tripEstimates = CPTravelEstimates(
            distanceRemaining: Measurement(value: progress.distanceRemaining, unit: UnitLength.meters),
            timeRemaining: progress.timeRemaining
        )
        mapTemplate.updateEstimates(tripEstimates, for: trip)

        if let maneuver = currentManeuver {
            let maneuverEstimates = CPTravelEstimates(
                distanceRemaining: Measurement(
                    value: progress.distanceToNextManeuver,
                    unit: UnitLength.meters
                ),
                timeRemaining: 0
            )
            session.updateTravelEstimates(maneuverEstimates, for: maneuver)
        }
    }

    private func handleReroute(_ option: RouteOption) {
        navigationSession?.pauseTrip(
            for: .rerouting,
            description: "Recalculating",
            turnCardColor: .systemOrange
        )

        Task {
            // Let the pause card show long enough to be read, then resume with
            // the new first instruction.
            try? await Task.sleep(for: .seconds(1.5))
            guard let step = option.steps.first else { return }
            updateManeuver(step)
        }
    }

    private func finishTrip() {
        navigationSession?.finishTrip()
        navigationSession = nil
        currentManeuver = nil
        previewedTrip = nil
        mapViewController.setTrackingCar(true)
    }

    private func cancelTrip() {
        navigationSession?.cancelTrip()
        navigationSession = nil
        currentManeuver = nil
        previewedTrip = nil
        environment.cancelTrip()
        mapTemplate.hideTripPreviews()
    }

    // MARK: - Alerts

    /// Hazards and weather both arrive here as CarPlay's own alert banner,
    /// which the system sizes and dismisses to its own driver-safety rules.
    private func present(_ alert: DriverAlert) {
        guard navigationSession != nil else { return }

        let dismiss = CPAlertAction(title: "OK", style: .cancel) { _ in }
        var actions: [CPAlertAction] = []

        // A hazard the driver can confirm gets a "Still there" button; weather
        // is not something the crowd votes on.
        if case let .incident(incident) = alert.source {
            let confirm = CPAlertAction(title: "Still there", style: .default) { [weak self] _ in
                Task { await self?.environment.incidentService.vote(on: incident, confirms: true) }
            }
            let gone = CPAlertAction(title: "Not there", style: .destructive) { [weak self] _ in
                Task { await self?.environment.incidentService.vote(on: incident, confirms: false) }
            }
            actions = [confirm, gone]
        } else {
            actions = [dismiss]
        }

        let navigationAlert = CPNavigationAlert(
            titleVariants: [alert.title],
            subtitleVariants: [alert.subtitle].compactMap { $0 },
            image: symbol(alert.symbolName, pointSize: 32),
            primaryAction: actions[0],
            secondaryAction: actions.count > 1 ? actions[1] : nil,
            duration: alert.severity >= .high ? 12 : 8
        )
        mapTemplate.present(navigationAlert: navigationAlert, animated: true)
    }

    private func presentError(_ message: String) {
        let alert = CPAlertTemplate(
            titleVariants: [message],
            actions: [CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in
                self?.interfaceController.dismissTemplate(animated: true, completion: nil)
            }]
        )
        interfaceController.presentTemplate(alert, animated: true, completion: nil)
    }

    // MARK: - Reporting

    private func presentReportGrid() {
        let buttons = Incident.Kind.allCases.prefix(8).map { kind in
            CPGridButton(
                titleVariants: [kind.title],
                image: symbol(kind.symbolName, pointSize: 44) ?? UIImage()
            ) { [weak self] _ in
                self?.interfaceController.popTemplate(animated: true, completion: nil)
                Task { await self?.environment.report(kind) }
            }
        }

        let grid = CPGridTemplate(title: "Report", gridButtons: Array(buttons))
        interfaceController.pushTemplate(grid, animated: true, completion: nil)
    }

    // MARK: - Weather template

    /// The weather screen: conditions now, what is coming on the route, and
    /// what it will be like on arrival.
    private func presentWeather() {
        var sections: [CPListSection] = []

        if let current = environment.currentWeather {
            let item = CPListItem(
                text: current.condition.description,
                detailText: temperatureLine(current)
            )
            item.setImage(symbol(current.condition.symbolName, pointSize: 30))
            sections.append(CPListSection(items: [item], header: "Now", sectionIndexTitle: nil))
        }

        let segments = environment.navigationService.activeRoute?.weatherSegments
            ?? environment.navigationService.routeOptions.first?.weatherSegments
            ?? []

        if !segments.isEmpty {
            let items = segments.map { segment -> CPListItem in
                let distance = MeasurementFormatter.distance.string(
                    from: Measurement(value: segment.distanceAlongRoute, unit: UnitLength.meters)
                )
                let place = segment.placeName.map { "\($0) · " } ?? ""
                let item = CPListItem(
                    text: segment.snapshot.condition.description,
                    detailText: "\(place)\(distance) in · arriving \(timeFormatter.string(from: segment.arrivalTime))"
                )
                item.setImage(symbol(segment.snapshot.condition.symbolName, pointSize: 30))
                return item
            }
            sections.append(CPListSection(items: items, header: "On your route", sectionIndexTitle: nil))
        }

        if !environment.destinationForecast.isEmpty {
            let items = environment.destinationForecast.prefix(6).map { hour -> CPListItem in
                let item = CPListItem(
                    text: timeFormatter.string(from: hour.date),
                    detailText: "\(hour.condition.description) · \(Int(hour.temperature.rounded()))°"
                )
                item.setImage(symbol(hour.condition.symbolName, pointSize: 30))
                return item
            }
            sections.append(CPListSection(
                items: Array(items),
                header: "At \(environment.navigationService.destination?.name ?? "destination")",
                sectionIndexTitle: nil
            ))
        }

        if sections.isEmpty {
            let item = CPListItem(text: "Weather unavailable", detailText: "Waiting for a location fix.")
            sections = [CPListSection(items: [item])]
        }

        let template = CPListTemplate(title: "Weather", sections: sections)
        interfaceController.pushTemplate(template, animated: true, completion: nil)
    }

    private func temperatureLine(_ snapshot: WeatherSnapshot) -> String {
        var parts = ["\(Int(snapshot.temperature.rounded()))°"]
        if abs(snapshot.apparentTemperature - snapshot.temperature) >= 2 {
            parts.append("feels \(Int(snapshot.apparentTemperature.rounded()))°")
        }
        parts.append("wind \(Int((snapshot.windSpeed * 3.6).rounded())) km/h")
        return parts.joined(separator: " · ")
    }

    private lazy var timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()

    // MARK: - Images

    /// CarPlay wants template images rendered for its own tinting.
    private func symbol(_ name: String, pointSize: CGFloat = 24) -> UIImage? {
        let configuration = UIImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        return UIImage(systemName: name, withConfiguration: configuration)?
            .withRenderingMode(.alwaysTemplate)
    }

    private func instructionVariants(for step: MKRoute.Step) -> [String] {
        var variants = [step.instructions]
        // A short fallback for narrow head units, derived from the notice when
        // MapKit gives us one.
        if let notice = step.notice, notice.count < step.instructions.count {
            variants.append(notice)
        }
        return variants
    }

    private func maneuverSymbol(for step: MKRoute.Step) -> UIImage? {
        // MapKit does not expose a manoeuvre enum, so the instruction text is
        // all there is to go on. Matching on it is crude but it is what every
        // MapKit-based CarPlay app ends up doing.
        let instruction = step.instructions.lowercased()
        let name: String

        switch true {
        case instruction.contains("roundabout") || instruction.contains("exit"):
            name = "arrow.triangle.turn.up.right.circle"
        case instruction.contains("u-turn"):
            name = "arrow.uturn.down"
        case instruction.contains("slight left"):
            name = "arrow.up.left"
        case instruction.contains("slight right"):
            name = "arrow.up.right"
        case instruction.contains("left"):
            name = "arrow.turn.up.left"
        case instruction.contains("right"):
            name = "arrow.turn.up.right"
        case instruction.contains("merge"):
            name = "arrow.merge"
        case instruction.contains("arriv") || instruction.contains("destination"):
            name = "mappin.circle.fill"
        default:
            name = "arrow.up"
        }
        return symbol(name, pointSize: 40)
    }
}

// MARK: - CPMapTemplateDelegate

extension CarPlayController: CPMapTemplateDelegate {

    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        startedTrip trip: CPTrip,
        using routeChoice: CPRouteChoice
    ) {
        guard let option = routeChoiceLookup[ObjectIdentifier(routeChoice)] else { return }
        previewedTrip = trip
        beginNavigation(with: option, trip: trip)
    }

    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        selectedPreviewFor trip: CPTrip,
        using routeChoice: CPRouteChoice
    ) {
        // Scrolling between route choices redraws the map so the driver sees
        // the alternative, and its weather bands, before committing.
        guard let option = routeChoiceLookup[ObjectIdentifier(routeChoice)] else { return }
        environment.navigationService.update(option)
        mapViewController.showRouteOverview()
    }

    func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
        cancelTrip()
    }

    func mapTemplateDidBeginPanGesture(_ mapTemplate: CPMapTemplate) {
        mapViewController.setTrackingCar(false)
    }

    func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
        mapViewController.pan(direction)
    }

    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        displayStyleFor maneuver: CPManeuver
    ) -> CPManeuverDisplayStyle {
        .leadingSymbol
    }

    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        shouldShowNotificationFor maneuver: CPManeuver
    ) -> Bool {
        // Let the system raise the turn card even when another app is
        // foregrounded on the car screen.
        true
    }

    func mapTemplate(
        _ mapTemplate: CPMapTemplate,
        shouldShowNotificationFor navigationAlert: CPNavigationAlert
    ) -> Bool {
        true
    }
}

// MARK: - CPSearchTemplateDelegate

extension CarPlayController: CPSearchTemplateDelegate {

    func searchTemplate(
        _ searchTemplate: CPSearchTemplate,
        updatedSearchText searchText: String,
        completionHandler: @escaping ([CPListItem]) -> Void
    ) {
        lastSearchText = searchText
        Task {
            let destinations = (try? await environment.searchService.search(searchText, limit: 10)) ?? []
            // CarPlay caps list length while driving; the system enforces it,
            // but trimming here keeps the results predictable.
            let items = destinations.map { destination -> CPListItem in
                let item = CPListItem(text: destination.name, detailText: destination.subtitle)
                item.userInfo = destination
                return item
            }
            completionHandler(items)
        }
    }

    func searchTemplate(
        _ searchTemplate: CPSearchTemplate,
        selectedResult item: CPListItem,
        completionHandler: @escaping () -> Void
    ) {
        completionHandler()
        guard let destination = item.userInfo as? Destination else { return }
        interfaceController.popTemplate(animated: true) { [weak self] _, _ in
            self?.planTrip(to: destination)
        }
    }

    func searchTemplateSearchButtonPressed(_ searchTemplate: CPSearchTemplate) {
        // The inline results under the keyboard are capped to a few rows, so
        // "Search" swaps them for a full list template.
        let query = lastSearchText
        interfaceController.popTemplate(animated: true) { [weak self] _, _ in
            guard let self, !query.isEmpty else { return }
            Task {
                let destinations = (try? await self.environment.searchService.search(query)) ?? []
                guard !destinations.isEmpty else {
                    self.presentError("No results for \(query).")
                    return
                }
                self.showResults(destinations, title: query)
            }
        }
    }
}
