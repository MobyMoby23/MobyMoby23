# Setup

## 1. Generate the project

```sh
brew install xcodegen
cd Skyway
xcodegen generate
open Skyway.xcodeproj
```

The `.xcodeproj` is generated rather than committed, so it never produces merge
conflicts. Regenerate it whenever you add a file.

## 2. Signing

Put your 10-character Team ID in `project.yml` under
`settings.base.DEVELOPMENT_TEAM`, or select your team in Xcode's Signing &
Capabilities tab after generating.

Change `PRODUCT_BUNDLE_IDENTIFIER` from `com.example.skyway` to something you
own before requesting any capability against it.

## 3. Run it

Build and run on a device or simulator. Grant location access when asked.
Everything on the phone works at this point: search, routing, guidance, voice,
weather on the route, and hazard reports stored on the device.

Simulator note: `Features → Location → Freeway Drive` gives you a moving
location, which is enough to watch progress tracking, rerouting and alerts fire
without leaving your desk.

## 4. CarPlay

### The entitlement

`com.apple.developer.carplay-maps` is already in
`Sources/Resources/Skyway.entitlements`, but declaring it is not the same as
having it. Apple grants it per App ID, on request, after review:

<https://developer.apple.com/contact/carplay/>

Until it is granted:

- The app builds and runs.
- The phone half works completely.
- The CarPlay scene never connects, so the car screen stays blank.

You may also see a provisioning error at signing time, because the entitlement
in the file is not in the profile. If that blocks you while you wait, comment
out the `carplay-maps` key and the phone build carries on.

### Testing without a car

Once the entitlement is granted, use the CarPlay Simulator:

**Simulator → I/O → External Displays → CarPlay**

That gives you the head-unit screen, including the knob and trackpad input
paths that `CPMapTemplate`'s pan callbacks handle.

### What to check on the car screen

- Search from the nav bar, pick a destination, and confirm the trip preview
  shows weather under each route choice — it appears a beat late, when the scan
  finishes, which is intentional.
- Start guidance and confirm the turn card, ETA and distance-to-turn update.
- Tap the report button (speech-bubble icon) and file a hazard.
- Drive past a hazard in the simulator and confirm the `CPNavigationAlert`
  appears with "Still there" / "Not there".
- Pan with the trackpad, then hit recentre.

## 5. Optional: WeatherKit

Apple's forecast data, plus official severe-weather alerts (which Open-Meteo
does not have).

1. Enable the **WeatherKit** capability on your App ID in the developer portal,
   and add the WeatherKit service to the App ID's app services.
2. Add `USE_WEATHERKIT` to `SWIFT_ACTIVE_COMPILATION_CONDITIONS` in
   `project.yml`:
   ```yaml
   SWIFT_ACTIVE_COMPILATION_CONDITIONS: "$(inherited) USE_WEATHERKIT"
   ```
3. Regenerate and rebuild.

Requires a paid Apple Developer Program membership. Calls are metered — the
`WeatherCache` in front of the provider exists mostly for this reason.

Attribution: WeatherKit requires you to display the Apple Weather trademark and
a link to the data-source page. That is not implemented; add it before shipping.

## 6. Optional: a report backend

Set `SkywayIncidentBaseURL` in `Sources/Resources/Info.plist` to your server's
base URL. `AppEnvironment` will use `RemoteIncidentStore` instead of the local
one.

Endpoints expected:

```
GET  /incidents?lat={lat}&lon={lon}&radius={metres}   -> [Incident]
POST /incidents                                        <- Incident
POST /incidents/{uuid}/vote                            <- {"confirms": true}
```

`Incident`'s JSON shape is whatever `Codable` synthesises from
`Sources/Models/Incident.swift`. Writes go to the local store first, so a
driver's own report shows immediately and survives a failed push.

## Before shipping

- Request the CarPlay entitlement early; review takes time.
- Add an app icon and launch screen — neither is in the repo.
- WeatherKit attribution, if you switched providers.
- A privacy manifest (`PrivacyInfo.xcprivacy`) covering location use.
- Decide what happens to reports server-side: rate limiting, abuse handling and
  retention are all real problems the client cannot solve.
