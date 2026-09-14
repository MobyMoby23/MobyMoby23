# Architecture

## Two screens, one trip

The single hardest constraint in a CarPlay app is that the phone and the car
are **separate `UIScene`s with separate lifecycles**. They connect in either
order, either can be absent, and the phone's scene can be suspended while the
car's is active. A driver who starts a trip on the phone in the driveway and
then plugs in expects the same trip on the car screen, not a fresh one.

Skyway handles that by owning no state in either scene. `AppEnvironment.shared`
holds every service; `SkywayApp` injects it into SwiftUI and
`CarPlaySceneDelegate` reads the same instance. Both UIs are observers.

```
                    ┌─────────────────────┐
                    │  AppEnvironment     │  @MainActor, shared
                    │  .shared            │
                    └──────────┬──────────┘
             ┌─────────────────┼─────────────────┐
             │                 │                 │
      LocationService   NavigationService   AlertEngine
      SearchService     IncidentService     VoiceGuidanceService
      RouteWeatherService (actor) ──► WeatherProvider
             │                 │                 │
     ┌───────┴───────┐  ┌──────┴───────┐
     │ SwiftUI scene │  │ CarPlay scene│   both purely observers
     └───────────────┘  └──────────────┘
```

`AppDelegate` deliberately does **not** override
`configurationForConnecting`. Scene routing lives in Info.plist so SwiftUI's
`WindowGroup` keeps ownership of the phone window scene; taking that away is a
well-worn route to a black screen on the phone while CarPlay works fine.

## Concurrency

- `@MainActor` on everything UI-adjacent: the services publish to both UIs, so
  main-actor isolation is the simplest correct answer.
- `actor` where the work is I/O-bound and off the UI path: `RouteWeatherService`,
  `WeatherCache`, `LocalIncidentStore`, `RemoteIncidentStore`.
- `CLLocationManagerDelegate` callbacks are `nonisolated` and hop to the main
  actor, which is what CoreLocation's threading actually guarantees.

## The weather scan

`RouteWeatherService.scan(route:departingAt:)` is the piece the app is built
around.

1. **Sample.** Walk the polyline every 12 km, widening the spacing rather than
   truncating if a long route would exceed 40 samples. A cross-country drive
   gets coarser samples but still covers the whole way.
2. **Time-shift.** Each sample's arrival time is `departure + distance /
   averageSpeed`. This is what makes it a *route* forecast: the last sample is
   forecast for three hours out, not for now.
3. **Fetch.** Batches of six concurrent requests, every one through
   `WeatherCache` (5 km grid, 20-minute lifetime). Consecutive motorway samples
   usually land in the same cell, so the cache absorbs most of the scan — which
   matters on WeatherKit, where calls are metered.
4. **Merge.** Runs of the same condition collapse into one segment, keeping the
   worst reading. Twelve "rain" samples become one warning.
5. **Name.** Reverse-geocode the worst four only; `CLGeocoder` throttles hard.

The result decorates the `RouteOption`, which feeds three things at once: the
coloured bands on both maps, the line under each route choice, and the
`AlertEngine`'s proximity checks.

## The alert engine

Every warning the driver receives goes through `AlertEngine`, whatever it came
from. That is a deliberate choke point: warning fatigue is what makes drivers
stop looking at the screen.

- **Distance for hazards, time for weather.** A crash gets a fixed window per
  kind (1 km). Weather gets `speed × 150` — about two and a half minutes'
  notice, which is a few hundred metres in town and a couple of kilometres on a
  motorway, and feels the same to the driver in both.
- **Once per trip.** Ids are stable and kept in an `announced` set; weather ids
  bucket by 5 km so a drifting sample doesn't re-announce the same front.
- **Minimum spacing.** Eight seconds between alerts. A suppressed alert is left
  *unannounced*, so the next location update reconsiders it — by which point
  proximity has only improved.
- **Severity gates.** Only `.moderate` and above are ever spoken.

`beginTrip` takes an `MKPolyline`, not an `MKRoute`, purely so this class is
testable — `MKRoute` cannot be constructed outside MapKit.

## Route geometry

`RouteGeometry` is pure functions over polylines, shared by progress tracking,
off-route detection, incident matching and the weather scan.

The one non-obvious rule: `snap` takes a `searchingFrom` index and progress
tracking always searches **forward** from where it was. On a route that doubles
back — a cloverleaf, an out-and-back errand — a global nearest-point search
will happily snap the driver onto the returning leg and report that they have
travelled 20 km in one second. There is a test for exactly that.

`coordinate(at:)` binary-searches the cumulative distances, which keeps the
weather scan cheap on routes with tens of thousands of vertices.

## Incident credibility

Reports are not trusted equally or forever:

- **Per-kind TTL.** Police 30 minutes, crashes an hour, flooding three hours,
  road closures six. Police move; a closed road does not.
- **Confirmations extend, but not indefinitely.** Each upvote adds a quarter of
  the base TTL, capped at three times base.
- **Downvotes suppress.** More downs than ups and the report stops being shown.
- **Heading filter.** A report carries the reporter's bearing. When matching
  against a route, anything more than 90° off the route's bearing at that point
  is dropped — that jam is on the other carriageway.

## Substitution points

Three protocols, each with a working default and a real alternative:

| Protocol | Default | Alternative |
|---|---|---|
| `WeatherProvider` | `OpenMeteoProvider` — free, keyless | `WeatherKitProvider` — Apple data + official alerts |
| `IncidentStore` | `LocalIncidentStore` — on-device JSON | `RemoteIncidentStore` — HTTP backend with offline fallback |

Both are chosen in `AppEnvironment`'s two factory methods, and nothing above
that line knows which is in use.
