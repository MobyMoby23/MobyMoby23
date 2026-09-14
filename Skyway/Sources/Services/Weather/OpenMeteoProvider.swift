import Foundation
import CoreLocation

/// Free, keyless weather from open-meteo.com.
///
/// This is the default provider so the project runs the moment it is cloned,
/// with no Apple Developer Program membership and no API key. Swap it for
/// `WeatherKitProvider` in `AppEnvironment` once the WeatherKit capability is
/// enabled on the App ID.
///
/// Open-Meteo has no severe-weather warning feed, so `warnings(at:)` returns
/// an empty array — the route scanner still raises its own alerts from the
/// forecast numbers.
struct OpenMeteoProvider: WeatherProvider {
    private let session: URLSession
    private let cache: WeatherCache

    init(session: URLSession = .shared, cache: WeatherCache = WeatherCache()) {
        self.session = session
        self.cache = cache
    }

    func snapshot(at coordinate: CLLocationCoordinate2D, date: Date) async throws -> WeatherSnapshot {
        if let cached = await cache.value(for: coordinate, date: date) { return cached }

        let response = try await fetch(coordinate: coordinate, forecastDays: forecastDays(until: date))
        guard let snapshot = response.snapshot(at: date, coordinate: coordinate) else {
            throw WeatherProviderError.noDataForDate
        }
        await cache.store(snapshot, for: coordinate, date: date)
        return snapshot
    }

    func hourly(at coordinate: CLLocationCoordinate2D, hours: Int) async throws -> [HourlyForecast] {
        let response = try await fetch(
            coordinate: coordinate,
            forecastDays: max(1, Int(ceil(Double(hours) / 24)) + 1)
        )
        return response.hourlyForecasts(limit: hours)
    }

    func warnings(at coordinate: CLLocationCoordinate2D) async throws -> [WeatherWarning] {
        []
    }

    /// Open-Meteo bills forecast length in whole days; ask for exactly enough
    /// to cover the arrival time and no more.
    private func forecastDays(until date: Date) -> Int {
        let days = Calendar.current.dateComponents([.day], from: Date(), to: date).day ?? 0
        return min(max(days + 2, 2), 7)
    }

    private func fetch(
        coordinate: CLLocationCoordinate2D,
        forecastDays: Int
    ) async throws -> OpenMeteoResponse {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.4f", coordinate.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.4f", coordinate.longitude)),
            URLQueryItem(name: "hourly", value: [
                "temperature_2m",
                "apparent_temperature",
                "precipitation",
                "precipitation_probability",
                "weather_code",
                "wind_speed_10m",
                "wind_gusts_10m",
                "visibility",
                "is_day"
            ].joined(separator: ",")),
            URLQueryItem(name: "wind_speed_unit", value: "ms"),
            URLQueryItem(name: "timeformat", value: "unixtime"),
            URLQueryItem(name: "timezone", value: "UTC"),
            URLQueryItem(name: "forecast_days", value: String(forecastDays))
        ]

        guard let url = components.url else { throw WeatherProviderError.badResponse }

        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw WeatherProviderError.unavailable
        }
        return try JSONDecoder().decode(OpenMeteoResponse.self, from: data)
    }
}

// MARK: - Wire format

private struct OpenMeteoResponse: Decodable {
    struct Hourly: Decodable {
        let time: [Int]
        let temperature2m: [Double?]
        let apparentTemperature: [Double?]
        let precipitation: [Double?]
        let precipitationProbability: [Double?]?
        let weatherCode: [Int?]
        let windSpeed10m: [Double?]
        let windGusts10m: [Double?]?
        let visibility: [Double?]?
        let isDay: [Int?]?

        enum CodingKeys: String, CodingKey {
            case time
            case temperature2m = "temperature_2m"
            case apparentTemperature = "apparent_temperature"
            case precipitation
            case precipitationProbability = "precipitation_probability"
            case weatherCode = "weather_code"
            case windSpeed10m = "wind_speed_10m"
            case windGusts10m = "wind_gusts_10m"
            case visibility
            case isDay = "is_day"
        }
    }

    let hourly: Hourly

    /// Index of the forecast hour containing `date`.
    private func index(for date: Date) -> Int? {
        let target = Int(date.timeIntervalSince1970)
        guard let first = hourly.time.first, target >= first - 3_600 else {
            return hourly.time.isEmpty ? nil : 0
        }
        // Times are ascending and hourly; find the last one at or before target.
        var result: Int?
        for (offset, timestamp) in hourly.time.enumerated() {
            if timestamp <= target { result = offset } else { break }
        }
        return result ?? (hourly.time.isEmpty ? nil : hourly.time.count - 1)
    }

    func snapshot(at date: Date, coordinate: CLLocationCoordinate2D) -> WeatherSnapshot? {
        guard let index = index(for: date), index < hourly.time.count else { return nil }

        let temperature = hourly.temperature2m[safe: index]?.flatMap { $0 } ?? 0
        return WeatherSnapshot(
            coordinate: Coordinate(coordinate),
            date: Date(timeIntervalSince1970: TimeInterval(hourly.time[index])),
            condition: SkyCondition(wmoCode: hourly.weatherCode[safe: index]?.flatMap { $0 } ?? -1),
            temperature: temperature,
            apparentTemperature: hourly.apparentTemperature[safe: index]?.flatMap { $0 } ?? temperature,
            precipitationAmount: hourly.precipitation[safe: index]?.flatMap { $0 } ?? 0,
            precipitationChance: (hourly.precipitationProbability?[safe: index]?.flatMap { $0 } ?? 0) / 100,
            windSpeed: hourly.windSpeed10m[safe: index]?.flatMap { $0 } ?? 0,
            windGust: hourly.windGusts10m?[safe: index]?.flatMap { $0 },
            visibility: hourly.visibility?[safe: index]?.flatMap { $0 },
            isDaylight: (hourly.isDay?[safe: index]?.flatMap { $0 } ?? 1) == 1
        )
    }

    func hourlyForecasts(limit: Int) -> [HourlyForecast] {
        let now = Int(Date().timeIntervalSince1970) - 3_600
        return zip(hourly.time.indices, hourly.time)
            .filter { $0.1 >= now }
            .prefix(limit)
            .map { index, timestamp in
                HourlyForecast(
                    date: Date(timeIntervalSince1970: TimeInterval(timestamp)),
                    condition: SkyCondition(wmoCode: hourly.weatherCode[safe: index]?.flatMap { $0 } ?? -1),
                    temperature: hourly.temperature2m[safe: index]?.flatMap { $0 } ?? 0,
                    precipitationChance: (hourly.precipitationProbability?[safe: index]?.flatMap { $0 } ?? 0) / 100
                )
            }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

extension SkyCondition {
    /// WMO 4677 weather codes, which is what Open-Meteo speaks.
    init(wmoCode: Int) {
        switch wmoCode {
        case 0: self = .clear
        case 1, 2: self = .partlyCloudy
        case 3: self = .cloudy
        case 45, 48: self = .fog
        case 51, 53, 55, 56, 57: self = .drizzle
        case 61, 63, 80, 81: self = .rain
        case 65, 82: self = .heavyRain
        case 66, 67: self = .freezingRain
        case 71, 73, 77, 85: self = .snow
        case 75, 86: self = .heavySnow
        case 95, 96, 99: self = .thunderstorms
        default: self = .unknown
        }
    }
}
