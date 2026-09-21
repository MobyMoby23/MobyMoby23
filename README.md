# RFID Tool

An iPhone app for reading, writing and converting NFC/RFID tag data. Built with
Expo and TypeScript.

## Read this first: Expo Go and NFC

**Expo Go cannot scan tags.** Core NFC is not one of the native modules baked
into the Expo Go app, so no JavaScript running inside Expo Go can reach the NFC
radio — this is a limit of Expo Go itself, not of this project.

The app handles that instead of pretending otherwise:

| | In Expo Go | In a development build |
|---|---|---|
| Convert tab (all three tools) | fully working | fully working |
| Write tab — compose & preview NDEF | fully working | fully working |
| Read / Write against a real tag | **simulated**, clearly labelled | real Core NFC |

So you can develop, lay out and test the entire app in Expo Go, and the
identical code talks to real tags the moment you build a dev client. Every
simulated result is tagged `DEMO` in the UI and in history, so a fake scan is
never mistaken for a real one.

### Running in Expo Go

```bash
npm install
npx expo start
```

Scan the QR code with the Camera app and open it in Expo Go.

### Running with real NFC

`expo-dev-client` and `eas.json` are already set up, so this is a one-time build
that keeps the same fast-refresh workflow as Expo Go.

**With EAS (no Mac required):**

```bash
npm install -g eas-cli
eas login
eas device:create          # register the iPhone you will install on
npm run build:dev          # eas build --profile development --platform ios
```

Install the resulting build from the link EAS prints, then `npm start` and open
it from the dev launcher.

**Locally (needs Xcode on a Mac):**

```bash
npx expo run:ios --device
```

One-time setup in the Apple Developer portal: enable the **Near Field
Communication Tag Reading** capability for the App ID
`com.mobymoby23.rfidtool`. The matching entitlement and the
`NFCReaderUsageDescription` string are already configured in `app.json` via the
`react-native-nfc-manager` config plugin, so nothing else needs editing.

Device requirements: iPhone 7 or newer on iOS 13+ (iOS 13 is what added NDEF
*writing*; iOS 11–12 can only read).

Once `expo-dev-client` is installed, `npm start` targets the dev build by
default. Use `npm run start:go` when you want Expo Go instead.

## What it does

**Read** — scans a tag and reports the UID (in four notations), the tag
technologies, NDEF capacity, whether it is still writable, and every NDEF
record decoded into something readable. Scans are saved to history
automatically.

**Write** — composes an NDEF message as Text, URL or arbitrary hex inside an
external-type record, shows the exact bytes and size before you commit, and
optionally locks the tag read-only afterwards.

**Convert** — three tools:

- *Bytes*: hex ⇄ decimal ⇄ binary ⇄ UTF-8 ⇄ base64, plus byte-reversed and
  bit-reversed views for when a reader reports a UID the other way round.
- *Wiegand*: 26-bit (H10301) and 34-bit access badges, both directions, with
  parity checking.
- *EM4100*: the 125 kHz fob formats — full hex, customer code, 10-digit,
  3+5 split, 5-digit and byte-reversed.

**History** — every scan, stored on the device only, with one tap to send a UID
to the converter.

### A note on frequencies

An iPhone's NFC radio is 13.56 MHz: ISO 14443 A/B, ISO 15693 and FeliCa. It
**cannot** read or write 125 kHz tags (EM4100, HID Prox) — no iOS app can. The
EM4100 tool converts numbers you already have from a badge or a desktop reader;
it does not scan them.

## Project layout

```
eas.json                EAS build profiles (development / preview / production)
app/                    expo-router routes
  _layout.tsx           root stack
  (tabs)/               Read · Write · Convert · History
src/lib/
  codec.ts              hex/dec/bin/UTF-8/base64 primitives, byte + bit order
  convert.ts            format detection and the all-notations view
  ndef.ts               NDEF encoder/decoder, no native dependency
  wiegand.ts            26- and 34-bit Wiegand with parity
  em4100.ts             125 kHz tag ID formats
  nfc.ts                Core NFC bridge, availability probing, demo fallback
  history.ts            AsyncStorage-backed scan history
src/ui/                 theme and shared components
tests/                  conversion tests (node:test)
```

## Tests

The conversion layer is pure and dependency-free, so it runs straight on Node:

```bash
npm test
```
