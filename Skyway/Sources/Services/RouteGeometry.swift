import Foundation
import CoreLocation
import MapKit

/// Polyline maths shared by route progress, off-route detection, the alert
/// engine and the weather scanner. Pure functions, no state — easy to test.
enum RouteGeometry {

    /// One point of a route, with its distance from the route's start.
    struct PointOnRoute {
        let coordinate: CLLocationCoordinate2D
        /// Metres travelled along the route to reach this point.
        let distanceAlongRoute: CLLocationDistance
        /// Metres between the queried location and the route itself.
        let lateralDistance: CLLocationDistance
        /// Index of the polyline segment this point falls on.
        let segmentIndex: Int
    }

    /// Explodes an `MKPolyline` into coordinates.
    static func coordinates(of polyline: MKPolyline) -> [CLLocationCoordinate2D] {
        var coordinates = [CLLocationCoordinate2D](
            repeating: kCLLocationCoordinate2DInvalid,
            count: polyline.pointCount
        )
        polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: polyline.pointCount))
        return coordinates
    }

    /// Cumulative distance to each vertex of the route.
    static func cumulativeDistances(_ coordinates: [CLLocationCoordinate2D]) -> [CLLocationDistance] {
        var total: CLLocationDistance = 0
        var result: [CLLocationDistance] = [0]
        result.reserveCapacity(coordinates.count)
        for index in 1..<max(coordinates.count, 1) {
            total += distance(coordinates[index - 1], coordinates[index])
            result.append(total)
        }
        return result
    }

    static func distance(
        _ lhs: CLLocationCoordinate2D,
        _ rhs: CLLocationCoordinate2D
    ) -> CLLocationDistance {
        MKMapPoint(lhs).distance(to: MKMapPoint(rhs))
    }

    /// Projects a location onto the route. This is what tells us how far along
    /// the trip is and whether the driver has wandered off it.
    static func snap(
        _ location: CLLocationCoordinate2D,
        to coordinates: [CLLocationCoordinate2D],
        cumulative: [CLLocationDistance],
        searchingFrom startIndex: Int = 0
    ) -> PointOnRoute? {
        guard coordinates.count >= 2 else { return nil }

        let point = MKMapPoint(location)
        var best: PointOnRoute?
        var bestLateral = CLLocationDistance.greatestFiniteMagnitude

        for index in max(0, startIndex)..<(coordinates.count - 1) {
            let a = MKMapPoint(coordinates[index])
            let b = MKMapPoint(coordinates[index + 1])
            let (projected, t) = project(point, onto: a, and: b)
            let lateral = projected.distance(to: point)
            guard lateral < bestLateral else { continue }

            bestLateral = lateral
            let segmentLength = a.distance(to: b)
            best = PointOnRoute(
                coordinate: projected.coordinate,
                distanceAlongRoute: cumulative[index] + segmentLength * t,
                lateralDistance: lateral,
                segmentIndex: index
            )
        }
        return best
    }

    /// Returns the closest point on segment a→b to `point`, plus how far along
    /// that segment it sits (0...1).
    private static func project(
        _ point: MKMapPoint,
        onto a: MKMapPoint,
        and b: MKMapPoint
    ) -> (MKMapPoint, Double) {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return (a, 0) }

        var t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
        t = min(max(t, 0), 1)
        return (MKMapPoint(x: a.x + t * dx, y: a.y + t * dy), t)
    }

    /// Walks the route and returns the coordinate `metres` from its start.
    static func coordinate(
        at metres: CLLocationDistance,
        coordinates: [CLLocationCoordinate2D],
        cumulative: [CLLocationDistance]
    ) -> CLLocationCoordinate2D? {
        guard let last = cumulative.last, !coordinates.isEmpty else { return nil }
        if metres <= 0 { return coordinates.first }
        if metres >= last { return coordinates.last }

        // cumulative is sorted, so a binary search keeps the weather scan cheap
        // even on a 900 km route with tens of thousands of vertices.
        var low = 0
        var high = cumulative.count - 1
        while low + 1 < high {
            let mid = (low + high) / 2
            if cumulative[mid] <= metres { low = mid } else { high = mid }
        }

        let segmentLength = cumulative[high] - cumulative[low]
        guard segmentLength > 0 else { return coordinates[low] }
        let t = (metres - cumulative[low]) / segmentLength
        let a = MKMapPoint(coordinates[low])
        let b = MKMapPoint(coordinates[high])
        return MKMapPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t).coordinate
    }

    /// Bearing in degrees from `a` to `b`, 0 = north.
    static func bearing(
        from a: CLLocationCoordinate2D,
        to b: CLLocationCoordinate2D
    ) -> CLLocationDirection {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let deltaLon = (b.longitude - a.longitude) * .pi / 180

        let y = sin(deltaLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        let degrees = atan2(y, x) * 180 / .pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Smallest angle between two bearings, 0...180.
    static func angleBetween(
        _ lhs: CLLocationDirection,
        _ rhs: CLLocationDirection
    ) -> CLLocationDirection {
        let delta = abs(lhs - rhs).truncatingRemainder(dividingBy: 360)
        return delta > 180 ? 360 - delta : delta
    }
}
