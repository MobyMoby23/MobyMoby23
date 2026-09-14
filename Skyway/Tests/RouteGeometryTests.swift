import XCTest
import CoreLocation
import MapKit
@testable import Skyway

final class RouteGeometryTests: XCTestCase {

    /// A straight east-west line at the equator, one vertex every 0.01°.
    private let line: [CLLocationCoordinate2D] = (0...10).map {
        CLLocationCoordinate2D(latitude: 0, longitude: Double($0) * 0.01)
    }

    func testCumulativeDistancesAreMonotonicAndStartAtZero() {
        let cumulative = RouteGeometry.cumulativeDistances(line)

        XCTAssertEqual(cumulative.count, line.count)
        XCTAssertEqual(cumulative[0], 0)
        for index in 1..<cumulative.count {
            XCTAssertGreaterThan(cumulative[index], cumulative[index - 1])
        }
    }

    func testSnapFindsPointOnRouteWithNoLateralOffset() {
        let cumulative = RouteGeometry.cumulativeDistances(line)
        let onTheLine = CLLocationCoordinate2D(latitude: 0, longitude: 0.025)

        let snapped = RouteGeometry.snap(onTheLine, to: line, cumulative: cumulative)

        XCTAssertNotNil(snapped)
        XCTAssertLessThan(snapped!.lateralDistance, 1)
        XCTAssertEqual(snapped!.distanceAlongRoute, cumulative[2] + (cumulative[3] - cumulative[2]) / 2, accuracy: 5)
    }

    func testSnapReportsLateralDistanceForPointBesideRoute() {
        let cumulative = RouteGeometry.cumulativeDistances(line)
        // ~0.001° of latitude is about 111 m off the line.
        let offRoute = CLLocationCoordinate2D(latitude: 0.001, longitude: 0.05)

        let snapped = RouteGeometry.snap(offRoute, to: line, cumulative: cumulative)

        XCTAssertNotNil(snapped)
        XCTAssertEqual(snapped!.lateralDistance, 111, accuracy: 10)
    }

    /// Guards the off-route detector: without a forward-only search, a route
    /// that doubles back can snap the driver to the returning leg and report
    /// wild progress jumps.
    func testSnapRespectsSearchStartIndex() {
        let outAndBack = line + line.reversed()
        let cumulative = RouteGeometry.cumulativeDistances(outAndBack)
        let ambiguous = CLLocationCoordinate2D(latitude: 0, longitude: 0.02)

        let early = RouteGeometry.snap(ambiguous, to: outAndBack, cumulative: cumulative)
        let late = RouteGeometry.snap(
            ambiguous,
            to: outAndBack,
            cumulative: cumulative,
            searchingFrom: 12
        )

        XCTAssertNotNil(early)
        XCTAssertNotNil(late)
        XCTAssertLessThan(early!.distanceAlongRoute, late!.distanceAlongRoute)
    }

    func testCoordinateAtDistanceInterpolatesAlongRoute() {
        let cumulative = RouteGeometry.cumulativeDistances(line)
        let total = cumulative.last!

        let midpoint = RouteGeometry.coordinate(at: total / 2, coordinates: line, cumulative: cumulative)

        XCTAssertNotNil(midpoint)
        XCTAssertEqual(midpoint!.longitude, 0.05, accuracy: 0.0005)
    }

    func testCoordinateAtDistanceClampsToEnds() {
        let cumulative = RouteGeometry.cumulativeDistances(line)

        let before = RouteGeometry.coordinate(at: -500, coordinates: line, cumulative: cumulative)
        let after = RouteGeometry.coordinate(at: 10_000_000, coordinates: line, cumulative: cumulative)

        XCTAssertEqual(before?.longitude, line.first?.longitude)
        XCTAssertEqual(after?.longitude, line.last?.longitude)
    }

    func testBearingIsEastAlongTheLine() {
        let bearing = RouteGeometry.bearing(from: line[0], to: line[1])
        XCTAssertEqual(bearing, 90, accuracy: 1)
    }

    func testAngleBetweenTakesShortWayAroundNorth() {
        XCTAssertEqual(RouteGeometry.angleBetween(350, 10), 20, accuracy: 0.001)
        XCTAssertEqual(RouteGeometry.angleBetween(10, 350), 20, accuracy: 0.001)
        XCTAssertEqual(RouteGeometry.angleBetween(0, 180), 180, accuracy: 0.001)
    }

    func testSnapReturnsNilForDegenerateRoute() {
        XCTAssertNil(RouteGeometry.snap(line[0], to: [line[0]], cumulative: [0]))
    }
}
