import XCTest
import CoreLocation
@testable import Skyway

final class IncidentTests: XCTestCase {

    private let somewhere = CLLocationCoordinate2D(latitude: 51.5, longitude: -0.12)

    func testFreshReportIsActive() {
        let incident = Incident(kind: .crash, coordinate: somewhere)

        XCTAssertFalse(incident.isExpired)
        XCTAssertTrue(incident.isCredible)
        XCTAssertTrue(incident.isActive)
    }

    func testReportExpiresAfterItsKindsTimeToLive() {
        let old = Incident(
            kind: .police,
            coordinate: somewhere,
            reportedAt: Date().addingTimeInterval(-Incident.Kind.police.timeToLive - 60)
        )

        XCTAssertTrue(old.isExpired)
        XCTAssertFalse(old.isActive)
    }

    func testConfirmationsExtendLifetime() {
        let reportedAt = Date().addingTimeInterval(-Incident.Kind.police.timeToLive - 60)
        let unconfirmed = Incident(kind: .police, coordinate: somewhere, reportedAt: reportedAt)
        let confirmed = Incident(kind: .police, coordinate: somewhere, reportedAt: reportedAt, upvotes: 4)

        XCTAssertTrue(unconfirmed.isExpired)
        XCTAssertFalse(confirmed.isExpired)
    }

    func testExtensionFromConfirmationsIsCapped() {
        let kind = Incident.Kind.police
        let heavilyConfirmed = Incident(kind: kind, coordinate: somewhere, upvotes: 10_000)

        // Base TTL plus at most two more, never unbounded.
        XCTAssertEqual(
            heavilyConfirmed.expiresAt.timeIntervalSince(heavilyConfirmed.reportedAt),
            kind.timeToLive * 3,
            accuracy: 1
        )
    }

    func testDownvotedReportLosesCredibility() {
        let disputed = Incident(kind: .hazard, coordinate: somewhere, upvotes: 1, downvotes: 3)

        XCTAssertFalse(disputed.isCredible)
        XCTAssertFalse(disputed.isActive)
    }

    func testRoadClosuresOutliveMovingHazards() {
        XCTAssertGreaterThan(Incident.Kind.roadClosed.timeToLive, Incident.Kind.police.timeToLive)
        XCTAssertGreaterThan(Incident.Kind.roadClosed.warningDistance, Incident.Kind.police.warningDistance)
    }

    func testCodableRoundTripPreservesEverything() throws {
        let original = Incident(
            kind: .flooding,
            coordinate: somewhere,
            heading: 187,
            upvotes: 2,
            note: "Underpass"
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Incident.self, from: data)

        XCTAssertEqual(decoded, original)
    }
}
