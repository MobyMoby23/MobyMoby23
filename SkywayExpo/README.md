# Skyway (Expo)

A CarPlay navigation app built with Expo: turn-by-turn driving directions with
crowd-sourced hazard reports — the Waze idea — plus weather woven through the
whole thing rather than bolted on as a separate tab.

This is the **primary implementation**. A native Swift/SwiftUI version lives in
`../Skyway` and is kept as a reference for the behaviour.

## The idea

A forecast for *where you are now* is nearly useless before a three-hour drive.
Skyway forecasts each point on your route **for the moment you will actually be
there**, then uses that one scan three ways:

- coloured severity bands along the route, on both the phone and the car screen
- a line under each route choice, so you can trade four minutes to avoid hail
- proximity warnings, spoken, as you approach

Severity reads the numbers rather than the label: 25 m/s gusts under a clear
sky, 150 m visibility, or drizzle at 0 °C (black ice) all escalate past what
the condition name suggests.

## Read this first: Expo Go will not work

CarPlay **cannot** run in Expo Go. Expo Go is a fixed, pre-built app signed with
Expo's own entitlements; CarPlay requires *your* binary to carry Apple's
`com.apple.developer.carplay-maps` entitlement and register a CarPlay scene
delegate in native code. No JavaScript can add that to Expo Go.

You need a **development build**. The good news is that you never need Xcode —
EAS Build compiles on Expo's Macs:

```sh
npm install
npx eas login
npx eas init                     # writes your real projectId into app.config.ts
npx eas build --profile development --platform ios
```

Install the resulting build on your iPhone, then `npm start` and connect to it.

## Setup

### 1. Mapbox token (required)

Directions and place search come from Mapbox. Create a **public** token
(`pk.…`) at <https://account.mapbox.com/access-tokens/>, then:

```sh
cp .env.example .env
# set EXPO_PUBLIC_MAPBOX_TOKEN=pk....
```

`EXPO_PUBLIC_` variables are inlined into the JS bundle, so anyone with the app
can read this. That is normal for a Mapbox client token — but set URL
restrictions on it, and never put a secret (`sk.…`) token here. For EAS builds,
set the same variable under the build profile in `eas.json` or as an EAS secret.

### 2. CarPlay entitlement (required for the car screen)

`com.apple.developer.carplay-maps` is not self-service. Apple grants it per App
ID, on request, after review: <https://developer.apple.com/contact/carplay/>

Until it is granted:

- the app builds and the phone half works completely
- the CarPlay scene never connects, so the car screen stays blank
- signing may fail because the entitlement isn't in your provisioning profile —
  remove the `entitlements` block from `app.config.ts` to unblock the phone
  build while you wait

Once granted, test with the CarPlay Simulator:
**Simulator → I/O → External Displays → CarPlay**.

### 3. Optional: a report backend

Set `EXPO_PUBLIC_INCIDENT_BASE_URL` and reports go to your server instead of
on-device storage. Three endpoints:

```
GET  /incidents?lat={lat}&lon={lon}&radius={metres}   -> Incident[]
POST /incidents                                        <- Incident
POST /incidents/{id}/vote                              <- {"confirms": true}
```

Writes go to the local store first, so a driver's own report shows immediately
and survives a failed push. Without a backend the app still works — reports are
just visible only to you, which is an honest limitation: crowd-sourcing needs a
crowd.

## What it does

**Navigation** — place search, alternate routes, spoken turn-by-turn, ETA that
blends the plan with the speed actually being driven, and rerouting that is
rate-limited so one bad GPS fix in a tunnel doesn't trigger it.

**Community reports** — eight kinds, one-tap reporting from phone or car,
"Still there"/"Gone" voting, per-kind expiry (police 30 min, road closure 6 hr)
extended by confirmations up to a cap, downvote suppression, and a heading
filter that drops reports from the opposite carriageway.

**Weather** — conditions here, on the route, and hour-by-hour at the
destination, from Open-Meteo (free, no key, no account).

**CarPlay** — native map with follow camera, route drawn in weather-severity
colours, trip previews carrying the weather for each choice, turn cards with
real manoeuvre symbols, search, one-tap hazard reporting, and a spoken weather
summary.

## What the CarPlay module can't do yet

`@bradford-tech/expo-carplay` is young (0.4.0) and three template types are not
implemented. Rather than pretend otherwise, the car UI is designed around what
exists:

| Wanted | Status | What the app does instead |
|---|---|---|
| Navigation alert banner | not implemented | Warnings are **spoken**, and mirrored into a coloured pill map button. Voice is the channel that matters at speed anyway. |
| Grid template (report menu) | not implemented | The Report bar button swaps the three map buttons into report pills for 8 seconds. |
| List template (weather screen) | not implemented | The Weather bar button **speaks** a route weather summary. |

All three are ordinary CarPlay features; if the module adds them, the
substitutes in `src/carplay/controller.ts` can be replaced directly.

## Layout

```
src/
  core/        Pure TypeScript — no React, no React Native. All of the
               interesting logic lives here, and all of it is tested.
    geo.ts       polyline projection, off-route detection, slicing
    progress.ts  route tracking and ETA
    alerts.ts    the one place that decides what the driver is told
    weather/     provider, arrival-time route scan, severity rules
    incidents/   report lifetime, credibility, route matching, storage
    routing/     Mapbox directions and geocoding
  state/       zustand store shared by both screens
  carplay/     the car screen
  phone/       React Native UI
__tests__/     59 tests over src/core
```

`src/core/alerts.ts` is the piece worth reading first: hazards and weather both
land there, so there is exactly one place that answers "is this worth
interrupting someone at 70 mph for?".

The store is a **vanilla** zustand store on purpose. CarPlay is driven by native
scene events, not a component tree, so it needs to read and subscribe without
hooks — and the car can connect when the phone app was never opened. One trip,
two screens.

## Checks

```sh
npm test        # 59 tests, pure logic, no native runtime needed
npm run typecheck
npx expo prebuild --platform ios --no-install   # runs the CarPlay config plugin
```

All three pass. What has **not** been verified is a real iOS compile or
anything on an actual car screen — that needs EAS Build and the Apple
entitlement.

## Known limits

- No speed limits or camera warnings — would need another data source.
- No lane guidance; Mapbox provides it, the CarPlay module doesn't expose it.
- Warns about reported jams but doesn't reroute around them.
- Background location needs the development build; it does nothing in Expo Go.
- Android Auto is not implemented, though the module and the core logic would
  both allow it.
