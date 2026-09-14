import XCTest
import CoreLocation
@testable import Skyway

final class SkyConditionTests: XCTestCase {

    func testWMOCodesMapToConditions() {
        XCTAssertEqual(SkyCondition(wmoCode: 0), .clear)
        XCTAssertEqual(SkyCondition(wmoCode: 3), .cloudy)
        XCTAssertEqual(SkyCondition(wmoCode: 45), .fog)
        XCTAssertEqual(SkyCondition(wmoCode: 65), .heavyRain)
        XCTAssertEqual(SkyCondition(wmoCode: 67), .freezingRain)
        XCTAssertEqual(SkyCondition(wmoCode: 75), .heavySnow)
        XCTAssertEqual(SkyCondition(wmoCode: 95), .thunderstorms)
    }

    func testUnrecognisedWMOCodeIsUnknownRatherThanClear() {
        // Defaulting an unknown code to "clear" would silently suppress a
        // warning; unknown must stay unknown.
        XCTAssertEqual(SkyCondition(wmoCode: 4242), .unknown)
        XCTAssertEqual(SkyCondition(wmoCode: -1), .unknown)
    }

    func testDrivingSeverityRanksConditions() {
        XCTAssertEqual(SkyCondition.clear.drivingSeverity, .none)
        XCTAssertEqual(SkyCondition.drizzle.drivingSeverity, .low)
        XCTAssertEqual(SkyCondition.rain.drivingSeverity, .moderate)
        XCTAssertEqual(SkyCondition.heavySnow.drivingSeverity, .high)
    }
}

final class WeatherSnapshotSeverityTests: XCTestCase {

    private func snapshot(
        condition: SkyCondition = .clear,
        temperature: Double = 15,
        precipitation: Double = 0,
        wind: Double = 2,
        gust: Double? = nil,
        visibility: Double? = 20_000
    ) -> WeatherSnapshot {
        WeatherSnapshot(
            coordinate: Coordinate(latitude: 51.5, longitude: -0.12),
            date: Date(),
            condition: condition,
            temperature: temperature,
            apparentTemperature: temperature,
            precipitationAmount: precipitation,
            precipitationChance: precipitation > 0 ? 1 : 0,
            windSpeed: wind,
            windGust: gust,
            visibility: visibility,
            isDaylight: true
        )
    }

    func testCalmClearWeatherIsNotWorthWarningAbout() {
        XCTAssertEqual(snapshot().drivingSeverity, .none)
    }

    func testStrongGustsRaiseSeverityEvenUnderAClearSky() {
        XCTAssertEqual(snapshot(gust: 18).drivingSeverity, .moderate)
        XCTAssertEqual(snapshot(gust: 27).drivingSeverity, .high)
    }

    func testPoorVisibilityRaisesSeverity() {
        XCTAssertEqual(snapshot(visibility: 800).drivingSeverity, .moderate)
        XCTAssertEqual(snapshot(visibility: 150).drivingSeverity, .high)
    }

    func testFreezingWetRoadIsAlwaysHighSeverity() {
        // Light drizzle at 0 °C is black ice — far more dangerous than the
        // condition label alone suggests.
        let icy = snapshot(condition: .drizzle, temperature: 0, precipitation: 0.2)

        XCTAssertEqual(SkyCondition.drizzle.drivingSeverity, .low)
        XCTAssertEqual(icy.drivingSeverity, .high)
    }

    func testSubZeroButDryIsNotEscalated() {
        XCTAssertEqual(snapshot(temperature: -5).drivingSeverity, .none)
    }

    func testSeverityNeverDropsBelowTheConditionsOwnRating() {
        let snowInStillAir = snapshot(condition: .heavySnow, wind: 0, gust: 0)
        XCTAssertEqual(snowInStillAir.drivingSeverity, .high)
    }
}
