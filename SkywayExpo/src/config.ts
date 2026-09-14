/**
 * Runtime configuration.
 *
 * `EXPO_PUBLIC_` variables are inlined into the JS bundle at build time, so
 * anything here is readable by anyone with the app. That is fine for a Mapbox
 * *public* token (`pk.…`), which is designed to ship in clients — but scope it
 * and set URL restrictions in your Mapbox account. Never put a secret token
 * (`sk.…`) here.
 */
export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

/**
 * Base URL of a community-report backend. Leave unset and reports are stored
 * on-device, so the app works with no server at all.
 */
export const INCIDENT_BASE_URL = process.env.EXPO_PUBLIC_INCIDENT_BASE_URL ?? '';

export const IS_MAPBOX_CONFIGURED = MAPBOX_TOKEN.length > 0;
