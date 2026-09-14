import SwiftUI
import MapKit

/// The phone's map. Shares its drawing rules with the CarPlay map so a route
/// looks the same on both screens.
struct MapScreen: UIViewRepresentable {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var navigationService: NavigationService
    @EnvironmentObject private var locationService: LocationService
    @EnvironmentObject private var incidentService: IncidentService

    @Binding var isFollowing: Bool

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView()
        mapView.delegate = context.coordinator
        mapView.showsUserLocation = true
        mapView.showsCompass = true
        mapView.pointOfInterestFilter = .includingAll
        mapView.register(
            IncidentAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: IncidentAnnotationView.reuseIdentifier
        )

        let pan = UIPanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePan)
        )
        pan.delegate = context.coordinator
        mapView.addGestureRecognizer(pan)
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sync(
            mapView: mapView,
            route: navigationService.activeRoute ?? navigationService.routeOptions.first,
            incidents: incidentService.nearby,
            location: locationService.location,
            heading: locationService.heading,
            isNavigating: navigationService.state == .navigating,
            isFollowing: isFollowing
        )
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
        var parent: MapScreen
        /// Route identity *plus* how much detail is attached: the weather scan
        /// finishes after the route is drawn and mutates the same option in
        /// place, so keying on the id alone would never redraw the bands.
        private var drawnSignature: String?
        private var weatherOverlays: [MKOverlay] = []
        private var routeOverlay: MKPolyline?
        private var lastCameraUpdate = Date.distantPast

        init(parent: MapScreen) {
            self.parent = parent
        }

        @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
            // Any deliberate drag hands control of the camera to the user.
            guard recognizer.state == .began else { return }
            parent.isFollowing = false
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
        ) -> Bool { true }

        func sync(
            mapView: MKMapView,
            route: RouteOption?,
            incidents: [Incident],
            location: CLLocation?,
            heading: CLLocationDirection?,
            isNavigating: Bool,
            isFollowing: Bool
        ) {
            syncRoute(mapView: mapView, route: route)
            syncIncidents(mapView: mapView, incidents: incidents)

            guard isFollowing, let location else { return }
            // Throttled: SwiftUI re-runs updateUIView far more often than the
            // camera needs to move, and animating on every pass makes the map
            // stutter.
            guard Date().timeIntervalSince(lastCameraUpdate) > 0.8 else { return }
            lastCameraUpdate = Date()

            mapView.setCamera(
                MKMapCamera(
                    lookingAtCenter: location.coordinate,
                    fromDistance: isNavigating ? 600 : 3_000,
                    pitch: isNavigating ? 55 : 0,
                    heading: heading ?? location.course
                ),
                animated: true
            )
        }

        private func syncRoute(mapView: MKMapView, route: RouteOption?) {
            let signature = route.map { "\($0.id)-\($0.weatherSegments.count)" }
            guard signature != drawnSignature else { return }
            drawnSignature = signature

            if let routeOverlay { mapView.removeOverlay(routeOverlay) }
            mapView.removeOverlays(weatherOverlays)
            routeOverlay = nil
            weatherOverlays = []

            guard let route else { return }

            routeOverlay = route.polyline
            mapView.addOverlay(route.polyline, level: .aboveRoads)

            let coordinates = RouteGeometry.coordinates(of: route.polyline)
            let cumulative = RouteGeometry.cumulativeDistances(coordinates)

            for segment in route.weatherSegments where segment.severity >= .moderate {
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

        private func syncIncidents(mapView: MKMapView, incidents: [Incident]) {
            let existing = mapView.annotations.compactMap { $0 as? IncidentAnnotation }
            let existingIDs = Set(existing.map(\.incident.id))
            let incomingIDs = Set(incidents.map(\.id))

            mapView.removeAnnotations(existing.filter { !incomingIDs.contains($0.incident.id) })
            mapView.addAnnotations(
                incidents
                    .filter { $0.isActive && !existingIDs.contains($0.id) }
                    .map(IncidentAnnotation.init)
            )
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let weather = overlay as? WeatherPolyline {
                let renderer = MKPolylineRenderer(polyline: weather)
                renderer.strokeColor = weather.severity.overlayColor
                renderer.lineWidth = 12
                renderer.lineCap = .round
                return renderer
            }
            if let polyline = overlay as? MKPolyline {
                let renderer = MKPolylineRenderer(polyline: polyline)
                renderer.strokeColor = .systemBlue
                renderer.lineWidth = 8
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
}
