# Flight Tracker ✈️

A live aircraft map for iPhone (and Android), built with **Expo** / React Native.
It shows planes currently in the air using the free
[OpenSky Network](https://opensky-network.org/) API — no API key or sign-up
required. Pan the map to load traffic for that area, tap a plane for its
altitude, speed, heading and vertical rate, or search for a specific callsign.

## Features

- 🗺️ Live map of airborne aircraft, each icon rotated to its true heading
- 🔄 Auto-refreshes every 20 seconds, plus a manual refresh button
- 📍 Loads traffic for whatever region you've panned/zoomed to
- 🔎 Search by flight callsign (e.g. `BAW123`) to jump to and select a plane
- 📊 Tap a plane for altitude (ft), ground speed (kt), heading and climb/descent rate
- 🔑 No account, no API key — anonymous OpenSky access

## Running it in Expo Go

You'll need [Node.js](https://nodejs.org/) and the **Expo Go** app on your phone.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npx expo start
```

Then scan the QR code from the terminal with the **Expo Go** app (Android) or
the **Camera** app (iOS). The app loads over your local network.

### Expo SDK version

This project targets **Expo SDK 51**. Expo Go only runs the SDK it was built
for, so if your installed Expo Go is newer and the project won't open, align
the versions:

```bash
npx expo install expo@latest   # bump the SDK
npx expo install --fix         # align all package versions to that SDK
```

## How it works

- `src/api/opensky.js` — calls `GET /states/all` with a bounding box derived
  from the visible map region, then parses OpenSky's positional
  [state vectors](https://openskynetwork.github.io/opensky-api/rest.html#response)
  into friendly objects and converts units (metres → feet, m/s → knots).
- `App.js` — renders the `react-native-maps` map, the aircraft markers, the
  status bar, the search bar and the tap-to-inspect detail card.

## Notes & limits

- **Anonymous rate limits.** OpenSky throttles unauthenticated requests. If you
  see a rate-limit message, wait a little or zoom into a smaller area (smaller
  bounding boxes are cheaper). You can raise the limits by creating a free
  OpenSky account and adding credentials to the request in `src/api/opensky.js`.
- Only airborne aircraft are shown; planes reporting *on ground* are filtered out.
- Coverage depends on OpenSky's crowd-sourced ADS-B receivers, so some regions
  (e.g. mid-ocean) will have few or no aircraft.
- Marker count is capped (250) per view to keep the map smooth in busy airspace.

## Tech

Expo · React Native · react-native-maps · OpenSky Network REST API
