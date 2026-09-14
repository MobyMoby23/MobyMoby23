import Foundation
import CoreLocation

/// A community-reported road event — the crowd-sourced layer that makes a
/// navigation app feel alive rather than just a router.
struct Incident: Identifiable, Codable, Equatable, Sendable {
    enum Kind: String, Codable, CaseIterable, Sendable {
        case police
        case crash
        case hazard
        case heavyTraffic
        case roadClosed
        case objectOnRoad
        case flooding
        case ice

        var title: String {
            switch self {
            case .police: return "Police"
            case .crash: return "Crash"
            case .hazard: return "Hazard"
            case .heavyTraffic: return "Heavy traffic"
            case .roadClosed: return "Road closed"
            case .objectOnRoad: return "Object on road"
            case .flooding: return "Flooding"
            case .ice: return "Ice"
            }
        }

        /// SF Symbol used on both the phone map and the CarPlay templates.
        var symbolName: String {
            switch self {
            case .police: return "shield.lefthalf.filled"
            case .crash: return "car.side.rear.and.collision.and.car.side.front"
            case .hazard: return "exclamationmark.triangle.fill"
            case .heavyTraffic: return "car.2.fill"
            case .roadClosed: return "xmark.octagon.fill"
            case .objectOnRoad: return "shippingbox.fill"
            case .flooding: return "water.waves"
            case .ice: return "snowflake"
            }
        }

        /// How long a report of this kind stays trustworthy without
        /// confirmation. Police move; a closed road does not.
        var timeToLive: TimeInterval {
            switch self {
            case .police: return 30 * 60
            case .crash, .heavyTraffic: return 60 * 60
            case .hazard, .objectOnRoad: return 90 * 60
            case .flooding, .ice: return 3 * 60 * 60
            case .roadClosed: return 6 * 60 * 60
            }
        }

        /// Metres ahead at which the driver should be warned.
        var warningDistance: CLLocationDistance {
            switch self {
            case .police, .heavyTraffic: return 800
            case .crash, .hazard, .objectOnRoad: return 1_000
            case .roadClosed: return 2_000
            case .flooding, .ice: return 1_500
            }
        }
    }

    let id: UUID
    let kind: Kind
    let coordinate: Coordinate
    let reportedAt: Date
    /// Bearing of the reporter in degrees, when known. Used to avoid warning
    /// about an incident on the opposite carriageway.
    let heading: CLLocationDirection?
    var upvotes: Int
    var downvotes: Int
    var note: String?

    init(
        id: UUID = UUID(),
        kind: Kind,
        coordinate: CLLocationCoordinate2D,
        reportedAt: Date = Date(),
        heading: CLLocationDirection? = nil,
        upvotes: Int = 0,
        downvotes: Int = 0,
        note: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.coordinate = Coordinate(coordinate)
        self.reportedAt = reportedAt
        self.heading = heading
        self.upvotes = upvotes
        self.downvotes = downvotes
        self.note = note
    }

    var location: CLLocation {
        CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    var expiresAt: Date {
        // Every confirmation buys the report another quarter of its lifetime,
        // capped at three times the base TTL so nothing lives forever.
        let bonus = min(Double(upvotes) * kind.timeToLive * 0.25, kind.timeToLive * 2)
        return reportedAt.addingTimeInterval(kind.timeToLive + bonus)
    }

    var isExpired: Bool { Date() >= expiresAt }

    /// Reports the crowd has voted down more than up are suppressed.
    var isCredible: Bool { upvotes >= downvotes }

    var isActive: Bool { !isExpired && isCredible }
}

/// `CLLocationCoordinate2D` is not `Codable`, so incidents carry their own.
struct Coordinate: Codable, Equatable, Hashable, Sendable {
    var latitude: CLLocationDegrees
    var longitude: CLLocationDegrees

    init(_ coordinate: CLLocationCoordinate2D) {
        self.latitude = coordinate.latitude
        self.longitude = coordinate.longitude
    }

    init(latitude: CLLocationDegrees, longitude: CLLocationDegrees) {
        self.latitude = latitude
        self.longitude = longitude
    }

    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
