import Foundation
import CoreLocation
import Combine

/// Single source of truth for where the car is. Everything else — the map
/// camera, route progress, the alert engine — observes this.
@MainActor
final class LocationService: NSObject, ObservableObject {
    @Published private(set) var location: CLLocation?
    @Published private(set) var heading: CLLocationDirection?
    @Published private(set) var authorizationStatus: CLAuthorizationStatus
    /// Metres per second, clamped to zero when CoreLocation reports noise.
    @Published private(set) var speed: CLLocationSpeed = 0

    private let manager = CLLocationManager()

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    func requestAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    /// Called when a trip starts. Background updates keep guidance alive when
    /// the phone locks in a cradle — this needs the `location` background mode.
    func startNavigating() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        manager.startUpdatingHeading()
    }

    /// Lower-power mode for when the map is merely on screen.
    func startBrowsing() {
        manager.allowsBackgroundLocationUpdates = false
        manager.startUpdatingLocation()
        manager.startUpdatingHeading()
    }

    func stop() {
        manager.allowsBackgroundLocationUpdates = false
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let latest = locations.last else { return }
        Task { @MainActor in
            self.location = latest
            self.speed = max(0, latest.speed)
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateHeading newHeading: CLHeading
    ) {
        guard newHeading.headingAccuracy >= 0 else { return }
        Task { @MainActor in
            self.heading = newHeading.trueHeading
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorizationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self.startBrowsing()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // A transient failure is normal in tunnels and car parks; the next fix
        // supersedes it, so there is nothing to surface to the driver.
        NSLog("[Skyway] location error: %@", error.localizedDescription)
    }
}
