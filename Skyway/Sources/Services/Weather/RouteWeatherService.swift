import Foundation
import CoreLocation
import MapKit

/// Scans a route and reports the weather the driver will actually meet —
/// forecast at each point for the moment the car gets there, not for now.
///
/// This is the piece a plain navigation app doesn't have: leaving at 16:00 for
/// a three-hour drive, what matters is the snow at hour three, not the clear
/// sky out of the window.
actor RouteWeatherService {

    private let provider: WeatherProvider
    private let geocoder = CLGeocoder()

    /// Distance between samples. 12 km at motorway speed is roughly one
    /// sample every 7 minutes — fine-grained enough to catch a front, coarse
    /// enough to stay inside a sensible request budget.
    private let sampleSpacing: CLLocationDistance = 12_000
    /// Hard cap so a cross-country route can't fire off hundreds of requests.
    private let maxSamples = 40
    /// Concurrent provider requests.
    private let maxConcurrency = 6
    /// Place names cost a reverse-geocode each, and CLGeocoder throttles
    /// aggressively, so only the worst few segments get named.
    private let maxPlaceNames = 4

    init(provider: WeatherProvider) {
        self.provider = provider
    }

    /// Returns the notable weather along `route`, merged into segments.
    /// Segments with `.none` severity are dropped — a clear stretch is not news.
    func scan(route: MKRoute, departingAt departure: Date = Date()) async -> [RouteWeatherSegment] {
        let coordinates = RouteGeometry.coordinates(of: route.polyline)
        let cumulative = RouteGeometry.cumulativeDistances(coordinates)
        guard let total = cumulative.last, total > 0 else { return [] }

        let samples = samplePoints(
            total: total,
            coordinates: coordinates,
            cumulative: cumulative,
            departure: departure,
            averageSpeed: total / max(route.expectedTravelTime, 1)
        )

        let snapshots = await fetchSnapshots(for: samples)
        let merged = merge(snapshots)
        return await withPlaceNames(merged)
    }

    /// Severe-weather warnings anywhere along the route. Sampled coarsely —
    /// warnings cover whole regions, so every 60 km is plenty.
    func warnings(route: MKRoute) async -> [WeatherWarning] {
        let coordinates = RouteGeometry.coordinates(of: route.polyline)
        let cumulative = RouteGeometry.cumulativeDistances(coordinates)
        guard let total = cumulative.last else { return [] }

        var seen = Set<String>()
        var result: [WeatherWarning] = []

        for distance in stride(from: 0, through: total, by: 60_000) {
            guard let coordinate = RouteGeometry.coordinate(
                at: distance,
                coordinates: coordinates,
                cumulative: cumulative
            ) else { continue }

            let warnings = (try? await provider.warnings(at: coordinate)) ?? []
            for warning in warnings where seen.insert(warning.id).inserted {
                result.append(warning)
            }
        }
        return result
    }

    // MARK: - Sampling

    private struct Sample: Sendable {
        let coordinate: CLLocationCoordinate2D
        let distanceAlongRoute: CLLocationDistance
        let arrivalTime: Date
    }

    private func samplePoints(
        total: CLLocationDistance,
        coordinates: [CLLocationCoordinate2D],
        cumulative: [CLLocationDistance],
        departure: Date,
        averageSpeed: CLLocationSpeed
    ) -> [Sample] {
        // Widen the spacing rather than truncate the route: a long drive gets
        // coarser samples, but still covers the whole way to the destination.
        let spacing = max(sampleSpacing, total / Double(maxSamples))

        return stride(from: 0, through: total, by: spacing).compactMap { distance in
            guard let coordinate = RouteGeometry.coordinate(
                at: distance,
                coordinates: coordinates,
                cumulative: cumulative
            ) else { return nil }

            return Sample(
                coordinate: coordinate,
                distanceAlongRoute: distance,
                arrivalTime: departure.addingTimeInterval(distance / max(averageSpeed, 1))
            )
        }
    }

    private func fetchSnapshots(for samples: [Sample]) async -> [RouteWeatherSegment] {
        var results: [RouteWeatherSegment] = []
        results.reserveCapacity(samples.count)

        // Fetched in batches rather than all at once: fast enough that the
        // scan finishes while the trip preview is still on screen, without
        // opening forty sockets to the provider at the same time.
        for batch in samples.chunked(into: maxConcurrency) {
            let provider = self.provider

            let segments = await withTaskGroup(
                of: (Int, RouteWeatherSegment)?.self
            ) { group -> [(Int, RouteWeatherSegment)] in
                for (offset, sample) in batch.enumerated() {
                    group.addTask {
                        guard let snapshot = try? await provider.snapshot(
                            at: sample.coordinate,
                            date: sample.arrivalTime
                        ) else { return nil }

                        return (offset, RouteWeatherSegment(
                            distanceAlongRoute: sample.distanceAlongRoute,
                            arrivalTime: sample.arrivalTime,
                            snapshot: snapshot,
                            placeName: nil
                        ))
                    }
                }

                var collected: [(Int, RouteWeatherSegment)] = []
                for await result in group {
                    if let result { collected.append(result) }
                }
                return collected
            }

            // Task groups complete out of order; distance order is what the
            // merge step and the alert engine both rely on.
            results.append(contentsOf: segments.sorted { $0.0 < $1.0 }.map(\.1))
        }

        return results
    }

    // MARK: - Merging

    /// Collapses runs of samples sharing a condition into one segment, keeping
    /// the worst snapshot of the run. Twelve consecutive "rain" samples should
    /// be one warning, not twelve.
    private func merge(_ segments: [RouteWeatherSegment]) -> [RouteWeatherSegment] {
        var merged: [RouteWeatherSegment] = []

        for segment in segments where segment.severity > .none {
            if let last = merged.last,
               last.snapshot.condition == segment.snapshot.condition,
               segment.distanceAlongRoute - last.distanceAlongRoute <= sampleSpacing * 2.5 {
                // Same weather, still contiguous: keep whichever reading is worse.
                if segment.severity > last.severity {
                    merged[merged.count - 1] = segment
                }
                continue
            }
            merged.append(segment)
        }
        return merged
    }

    private func withPlaceNames(_ segments: [RouteWeatherSegment]) async -> [RouteWeatherSegment] {
        let worstFirst = segments
            .enumerated()
            .sorted { $0.element.severity > $1.element.severity }
            .prefix(maxPlaceNames)

        var named = segments
        for (index, segment) in worstFirst {
            let location = CLLocation(
                latitude: segment.snapshot.coordinate.latitude,
                longitude: segment.snapshot.coordinate.longitude
            )
            guard let placemark = try? await geocoder.reverseGeocodeLocation(location).first else { continue }
            named[index].placeName = placemark.locality
                ?? placemark.subAdministrativeArea
                ?? placemark.administrativeArea
        }
        return named
    }
}

private extension Array {
    /// Splits into consecutive slices of at most `size` elements.
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
