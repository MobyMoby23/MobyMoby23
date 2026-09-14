import XCTest
import CoreLocation
import MapKit
@testable import Skyway

@MainActor
final class AlertEngineTests: XCTestCase {

    /// A straight 11 km line east from the origin, as an MKRoute-shaped
    /// polyline. AlertEngine only needs the polyline, so a bare MKPolyline
    /// stands in for a full route.
    private let coordinates: [CLLocationCoordinate2D] = (0...10).map {
        CLLocationCoordinate2D(latitude: 0, longitude: Double($0) * 0.01)
    }

    private func makeEngine() -> AlertEngine {
        let engine = AlertEngine()
        engine.beginTrip(polyline: MKPolyline(coordinates: coordinates, count: coordinates.count))
        return engine
    }

    private func location(atLongitude longitude: Double) -> CLLocation {
        CLLocation(latitude: 0, longitude: longitude)
    }

    func testIncidentAheadRaisesAnAlert() {
        let engine = makeEngine()
        // ~1.1 km ahead of the driver, inside a crash's 1 km window once the
        // driver has closed a little of the gap.
        engine.update(incidents: [
            Incident(kind: .crash, coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.008))
        ])

        engine.evaluate(at: location(atLongitude: 0.001))

        XCTAssertNotNil(engine.activeAlert)
        XCTAssertEqual(engine.activeAlert?.title, "Crash")
    }

    func testIncidentBehindTheDriverIsIgnored() {
        let engine = makeEngine()
        engine.update(incidents: [
            Incident(kind: .crash, coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.001))
        ])

        engine.evaluate(at: location(atLongitude: 0.05))

        XCTAssertNil(engine.activeAlert)
    }

    func testDistantIncidentIsNotAnnouncedYet() {
        let engine = makeEngine()
        engine.update(incidents: [
            Incident(kind: .police, coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.09))
        ])

        engine.evaluate(at: location(atLongitude: 0))

        XCTAssertNil(engine.activeAlert)
    }

    func testExpiredIncidentIsNotAnnounced() {
        let engine = makeEngine()
        engine.update(incidents: [
            Incident(
                kind: .police,
                coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.005),
                reportedAt: Date().addingTimeInterval(-Incident.Kind.police.timeToLive - 60)
            )
        ])

        engine.evaluate(at: location(atLongitude: 0.001))

        XCTAssertNil(engine.activeAlert)
    }

    func testTheSameIncidentIsOnlyAnnouncedOncePerTrip() {
        let engine = makeEngine()
        engine.update(incidents: [
            Incident(kind: .crash, coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.008))
        ])

        engine.evaluate(at: location(atLongitude: 0.001))
        let first = engine.history.count
        engine.dismissActive()
        engine.evaluate(at: location(atLongitude: 0.002))

        XCTAssertEqual(first, 1)
        XCTAssertEqual(engine.history.count, 1, "A second pass must not re-raise the same hazard")
    }

    func testEndingTheTripClearsAnnouncedState() {
        let engine = makeEngine()
        let incident = Incident(kind: .crash, coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.008))
        engine.update(incidents: [incident])
        engine.evaluate(at: location(atLongitude: 0.001))

        engine.endTrip()
        engine.beginTrip(polyline: MKPolyline(coordinates: coordinates, count: coordinates.count))
        engine.update(incidents: [incident])
        engine.evaluate(at: location(atLongitude: 0.001))

        XCTAssertEqual(engine.history.count, 1, "A new trip starts with a clean slate")
    }

    func testOnlyModerateOrWorseWeatherIsAnnounced() {
        let engine = makeEngine()
        engine.update(weatherSegments: [
            segment(atLongitude: 0.008, condition: .drizzle)  // .low
        ])

        engine.evaluate(at: location(atLongitude: 0.001))

        XCTAssertNil(engine.activeAlert)
    }

    func testSevereWeatherOnRouteIsAnnounced() {
        let engine = makeEngine()
        engine.update(weatherSegments: [
            segment(atLongitude: 0.008, condition: .heavySnow)
        ])

        // A location with a speed set: the weather lead distance scales with it.
        let moving = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0.001),
            altitude: 0,
            horizontalAccuracy: 5,
            verticalAccuracy: 5,
            course: 90,
            speed: 25,
            timestamp: Date()
        )
        engine.evaluate(at: moving)

        XCTAssertEqual(engine.activeAlert?.title, "Heavy snow")
    }

    func testWarningsBelowModerateAreNotAnnounced() {
        let engine = makeEngine()

        engine.announce(warnings: [
            WeatherWarning(id: "a", summary: "Light breeze", severity: .low, region: nil, issuedAt: Date(), expiresAt: nil, detailsURL: nil)
        ])

        XCTAssertNil(engine.activeAlert)
    }

    func testSevereWarningIsAnnouncedImmediately() {
        let engine = makeEngine()

        engine.announce(warnings: [
            WeatherWarning(id: "b", summary: "Amber warning for wind", severity: .high, region: "South West", issuedAt: Date(), expiresAt: nil, detailsURL: nil)
        ])

        XCTAssertEqual(engine.activeAlert?.title, "Amber warning for wind")
    }

    private func segment(atLongitude longitude: Double, condition: SkyCondition) -> RouteWeatherSegment {
        let coordinate = CLLocationCoordinate2D(latitude: 0, longitude: longitude)
        let cumulative = RouteGeometry.cumulativeDistances(coordinates)
        let distance = RouteGeometry.snap(coordinate, to: coordinates, cumulative: cumulative)!.distanceAlongRoute

        return RouteWeatherSegment(
            distanceAlongRoute: distance,
            arrivalTime: Date().addingTimeInterval(600),
            snapshot: WeatherSnapshot(
                coordinate: Coordinate(coordinate),
                date: Date(),
                condition: condition,
                temperature: 3,
                apparentTemperature: 1,
                precipitationAmount: 2,
                precipitationChance: 0.9,
                windSpeed: 6,
                windGust: 9,
                visibility: 4_000,
                isDaylight: true
            ),
            placeName: nil
        )
    }
}
