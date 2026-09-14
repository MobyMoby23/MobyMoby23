import UIKit
import MapKit
import CarPlay
import Combine

/// The map drawn on the car's screen.
///
/// CarPlay navigation apps supply their own map: the system draws the
/// templates (nav bar, guidance panel, alerts) *over* this view controller's
/// view, and hands us safe-area insets describing what is covered. Anything we
/// centre has to respect those insets, or the car will be neatly hidden behind
/// the guidance panel.
final class CarPlayMapViewController: UIViewController {

    private let mapView = MKMapView()
    private let environment = AppEnvironment.shared
    private var cancellables = Set<AnyCancellable>()

    /// True while the camera follows the car. Panning with the car's trackpad
    /// or knob turns it off; the recentre button turns it back on.
    private(set) var isTrackingCar = true

    private var routeOverlay: MKPolyline?
    private var weatherOverlays: [MKOverlay] = []

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        configureMapView()
        observeModel()
    }

    private func configureMapView() {
        mapView.frame = view.bounds
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.delegate = self
        mapView.showsUserLocation = true
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.isRotateEnabled = true
        mapView.pointOfInterestFilter = .includingAll
        mapView.register(
            IncidentAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: IncidentAnnotationView.reuseIdentifier
        )
        view.addSubview(mapView)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        // Templates cover parts of the screen; keeping the map's layout margins
        // in step means `setVisibleMapRect(_:edgePadding:)` and the follow
        // camera both aim at the visible portion only.
        mapView.layoutMargins = view.safeAreaInsets
    }

    private func observeModel() {
        environment.locationService.$location
            .compactMap { $0 }
            .throttle(for: .seconds(1), scheduler: RunLoop.main, latest: true)
            .sink { [weak self] location in
                self?.followCar(at: location)
            }
            .store(in: &cancellables)

        environment.navigationService.$activeRoute
            .sink { [weak self] option in
                self?.draw(option: option)
            }
            .store(in: &cancellables)

        environment.incidentService.$nearby
            .sink { [weak self] incidents in
                self?.draw(incidents: incidents)
            }
            .store(in: &cancellables)
    }

    // MARK: - Camera

    private func followCar(at location: CLLocation) {
        guard isTrackingCar else { return }

        let isNavigating = environment.navigationService.state == .navigating
        let camera = MKMapCamera(
            lookingAtCenter: location.coordinate,
            fromDistance: isNavigating ? 700 : 2_500,
            // Tilt the map while guiding, flat while browsing — the tilted
            // view reads better at speed, the flat one is easier to scan.
            pitch: isNavigating ? 50 : 0,
            heading: environment.locationService.heading ?? location.course
        )
        mapView.setCamera(camera, animated: true)
    }

    func setTrackingCar(_ tracking: Bool) {
        isTrackingCar = tracking
        if tracking, let location = environment.locationService.location {
            followCar(at: location)
        }
    }

    /// Zooms out to show the whole route — the "overview" button in the
    /// CarPlay trip preview and guidance panel.
    func showRouteOverview() {
        guard let routeOverlay else { return }
        isTrackingCar = false
        mapView.setVisibleMapRect(
            routeOverlay.boundingMapRect,
            edgePadding: UIEdgeInsets(top: 40, left: 40, bottom: 40, right: 40),
            animated: true
        )
    }

    func zoom(by factor: Double) {
        isTrackingCar = false
        var region = mapView.region
        region.span = MKCoordinateSpan(
            latitudeDelta: min(max(region.span.latitudeDelta * factor, 0.001), 90),
            longitudeDelta: min(max(region.span.longitudeDelta * factor, 0.001), 180)
        )
        mapView.setRegion(region, animated: true)
    }

    func pan(_ direction: CPMapTemplate.PanDirection) {
        isTrackingCar = false
        var centre = mapView.centerCoordinate
        let latitudeStep = mapView.region.span.latitudeDelta * 0.3
        let longitudeStep = mapView.region.span.longitudeDelta * 0.3

        if direction.contains(.up) { centre.latitude += latitudeStep }
        if direction.contains(.down) { centre.latitude -= latitudeStep }
        if direction.contains(.left) { centre.longitude -= longitudeStep }
        if direction.contains(.right) { centre.longitude += longitudeStep }

        mapView.setCenter(centre, animated: true)
    }

    // MARK: - Drawing

    private func draw(option: RouteOption?) {
        if let routeOverlay { mapView.removeOverlay(routeOverlay) }
        mapView.removeOverlays(weatherOverlays)
        weatherOverlays = []
        routeOverlay = nil

        guard let option else { return }

        let polyline = option.polyline
        routeOverlay = polyline
        mapView.addOverlay(polyline, level: .aboveRoads)

        drawWeather(option.weatherSegments, along: polyline)
    }

    /// Paints the stretches of the route with notable weather in a colour
    /// keyed to severity — a glance at the line tells the driver where the
    /// bad bit is, without reading anything.
    private func drawWeather(_ segments: [RouteWeatherSegment], along polyline: MKPolyline) {
        guard !segments.isEmpty else { return }

        let coordinates = RouteGeometry.coordinates(of: polyline)
        let cumulative = RouteGeometry.cumulativeDistances(coordinates)

        for segment in segments where segment.severity >= .moderate {
            // Paint a 6 km band centred on the sample; that is roughly the
            // resolution the forecast actually has.
            let start = max(0, segment.distanceAlongRoute - 3_000)
            let end = min(cumulative.last ?? 0, segment.distanceAlongRoute + 3_000)

            let band = stride(from: start, through: end, by: 500).compactMap {
                RouteGeometry.coordinate(at: $0, coordinates: coordinates, cumulative: cumulative)
            }
            guard band.count >= 2 else { continue }

            let overlay = WeatherPolyline(coordinates: band, count: band.count)
            overlay.severity = segment.severity
            weatherOverlays.append(overlay)
            mapView.addOverlay(overlay, level: .aboveRoads)
        }
    }

    private func draw(incidents: [Incident]) {
        let existing = mapView.annotations.compactMap { $0 as? IncidentAnnotation }
        mapView.removeAnnotations(existing)
        mapView.addAnnotations(incidents.filter(\.isActive).map(IncidentAnnotation.init))
    }
}

// MARK: - MKMapViewDelegate

extension CarPlayMapViewController: MKMapViewDelegate {
    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        if let weather = overlay as? WeatherPolyline {
            let renderer = MKPolylineRenderer(polyline: weather)
            renderer.strokeColor = weather.severity.overlayColor
            renderer.lineWidth = 14
            renderer.lineCap = .round
            return renderer
        }
        if let polyline = overlay as? MKPolyline {
            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = UIColor.systemBlue
            renderer.lineWidth = 10
            renderer.lineCap = .round
            return renderer
        }
        return MKOverlayRenderer(overlay: overlay)
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        guard annotation is IncidentAnnotation else { return nil }
        return mapView.dequeueReusableAnnotationView(
            withIdentifier: IncidentAnnotationView.reuseIdentifier,
            for: annotation
        )
    }
}

// MARK: - Supporting types

/// A polyline that remembers how bad the weather on it is.
final class WeatherPolyline: MKPolyline {
    var severity: DrivingSeverity = .none
}

extension DrivingSeverity {
    var overlayColor: UIColor {
        switch self {
        case .none: return .clear
        case .low: return UIColor.systemTeal.withAlphaComponent(0.7)
        case .moderate: return UIColor.systemOrange.withAlphaComponent(0.8)
        case .high: return UIColor.systemRed.withAlphaComponent(0.85)
        }
    }
}

final class IncidentAnnotation: NSObject, MKAnnotation {
    let incident: Incident
    var coordinate: CLLocationCoordinate2D { incident.coordinate.clCoordinate }
    var title: String? { incident.kind.title }

    init(_ incident: Incident) {
        self.incident = incident
    }
}

final class IncidentAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "IncidentAnnotationView"

    override var annotation: MKAnnotation? {
        didSet { configure() }
    }

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 34, height: 34)
        centerOffset = CGPoint(x: 0, y: -17)
        configure()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func configure() {
        guard let incident = (annotation as? IncidentAnnotation)?.incident else { return }
        let configuration = UIImage.SymbolConfiguration(pointSize: 20, weight: .bold)
        image = UIImage(systemName: incident.kind.symbolName, withConfiguration: configuration)?
            .withTintColor(.white, renderingMode: .alwaysOriginal)
        backgroundColor = UIColor.systemRed
        layer.cornerRadius = 17
        layer.masksToBounds = true
        contentMode = .center
    }
}
