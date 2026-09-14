# Skyway

A CarPlay navigation app for iPhone: turn-by-turn driving directions with
crowd-sourced hazard reports — the Waze idea — plus weather woven through the
whole thing rather than bolted on as a separate tab.

The weather part is the point. A forecast for *where you are now* is easy and
not very useful when you are about to drive for three hours. Skyway forecasts
each point on your route **for the moment you will actually be there**, shows
the bad stretches as coloured bands on the map, puts them under each route
choice so you can trade four minutes for avoiding a hail band, and warns you as
you approach — in the car, out loud, on CarPlay's own alert banner.

## What it does

**Navigation**
- Destination search with live completions, biased to where you are
- Multiple route choices with distance, time, weather and hazards on each
- Turn-by-turn guidance with spoken instructions that duck your music
- Automatic rerouting when you leave the route, rate-limited so one bad GPS
  fix in a tunnel doesn't trigger it
- ETA that blends the planned average with the speed you are actually doing

**Community reports**
- Eight report kinds: police, crash, hazard, heavy traffic, road closed,
  object on road, flooding, ice
- One tap to report, from the phone or from a CarPlay grid
- "Still there" / "Not there" voting from the alert banner
- Reports expire on a per-kind timer — police in 30 minutes, a road closure in
  six hours — and confirmations extend that, up to a cap
- Reports on the opposite carriageway are filtered out by comparing the
  reporter's heading against the route's bearing

**Weather**
- Conditions where you are, on the route, and hour-by-hour at the destination
- Route scan forecasts arrival time at each sample point, merges runs of the
  same condition, and names the worst few places
- Severity accounts for the numbers, not just the label: 25 m/s gusts under a
  clear sky, 150 m visibility, or drizzle at 0 °C (black ice) all escalate
- Severe-weather warnings on the route, when the provider has them

**CarPlay**
- Own map drawn into the car screen, with route, weather bands and hazard pins
- Trip previews with weather on each route choice
- Native guidance panel, turn cards and travel estimates
- Hazards and weather surface as `CPNavigationAlert`, which the system sizes
  and times to its own driver-safety rules
- Search, weather, report and nearby-stops (fuel, charging, parking, coffee)
  templates reachable from the map's nav bar
- Pan, zoom and recentre wired to the car's knob or trackpad

## Building it

There is no `.xcodeproj` checked in — it is generated, so it never conflicts:

```sh
brew install xcodegen
cd Skyway
xcodegen generate
open Skyway.xcodeproj
```

Set `DEVELOPMENT_TEAM` in `project.yml` (or pick your team in Xcode) and run.
Requires Xcode 15+ and iOS 17.

**It builds and runs on the phone with no accounts and no API keys.** Weather
comes from Open-Meteo, which is free and keyless; community reports are stored
on-device. Both are swappable — see below.

### The CarPlay half needs Apple's permission

`com.apple.developer.carplay-maps` is not self-service. Until Apple grants it
for your App ID, the app compiles and the phone side works fully, but the car
screen stays blank — the CarPlay scene never connects. Request it at
<https://developer.apple.com/contact/carplay/>.

To try the CarPlay UI before then, use the **CarPlay Simulator** (Simulator →
I/O → External Displays → CarPlay). The entitlement is still required for the
scene to connect, so this is a way to iterate on layout once you have it, not a
way around it.

### Optional: WeatherKit instead of Open-Meteo

Apple's own data, including official severe-weather alerts, which Open-Meteo
does not provide. Needs a paid developer account and the WeatherKit capability
on the App ID. Add `USE_WEATHERKIT` to `SWIFT_ACTIVE_COMPILATION_CONDITIONS` in
`project.yml` and `AppEnvironment` picks it up. Nothing else changes —
everything above talks to the `WeatherProvider` protocol.

### Optional: a real backend for reports

Crowd-sourcing needs a crowd. Set `SkywayIncidentBaseURL` in `Info.plist` and
`AppEnvironment` switches from `LocalIncidentStore` to `RemoteIncidentStore`,
which speaks three endpoints (`GET /incidents?lat&lon&radius`,
`POST /incidents`, `POST /incidents/{id}/vote`) and falls back to the on-device
cache when the network is gone. Edit that one type if your server speaks
something else.

## Layout

```
Sources/
  App/         Entry point, scene routing, and the composition root both
               scenes share — the reason a trip started on the phone is
               already running when you plug into the car
  Models/      Incident, weather, trip and alert types. No UIKit, no MapKit
               beyond geometry
  Services/    Location, search, routing, geometry, voice, alert engine
    Weather/   Provider protocol + WeatherKit and Open-Meteo, route scanner
    Incidents/ Store protocol + local and remote, matching against a route
  Phone/       SwiftUI
  CarPlay/     Scene delegate, template controller, the car's map
Tests/         Geometry, incident lifetime, weather severity, alert engine
```

`AlertEngine` is the piece worth reading first: hazards and weather both land
there, so there is exactly one place that answers "is this worth interrupting
someone at 70 mph for?".

## Tests

`⌘U` in Xcode, or:

```sh
xcodebuild test -scheme Skyway -destination 'platform=iOS Simulator,name=iPhone 15'
```

They cover the logic that does not need a car: polyline projection and
off-route detection, report expiry and vote credibility, weather severity
escalation, and the alert engine's dedupe and threshold rules.

## Known limits

- Speed limits and speed-camera warnings are not implemented — MapKit does not
  expose speed limit data, so this needs a separate data source.
- Manoeuvre arrows are inferred from MapKit's instruction text, because MapKit
  has no manoeuvre enum. It is crude, and it is what MapKit-based apps do.
- Lane guidance and junction views are not available through MapKit at all.
- Traffic-aware routing is whatever `MKDirections` gives you; there is no
  rerouting *around* a reported jam yet, only warning about it.
