// Client for the free OpenSky Network REST API.
//
// The `/states/all` endpoint is available anonymously (no API key) but is
// rate-limited, so we always request a bounding box around the visible map
// region rather than the whole planet.
//
// State-vector field order is documented at:
// https://openskynetwork.github.io/opensky-api/rest.html#response

const BASE_URL = 'https://opensky-network.org/api/states/all';

// Index of each field inside an OpenSky state vector.
const FIELD = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  heading: 10, // "true_track", degrees clockwise from north
  verticalRate: 11,
  geoAltitude: 13,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert a raw OpenSky state array into a friendly aircraft object.
 * Returns null for aircraft without a usable position.
 */
function parseState(state) {
  const latitude = state[FIELD.latitude];
  const longitude = state[FIELD.longitude];
  if (latitude == null || longitude == null) return null;

  const callsign = (state[FIELD.callsign] || '').trim();
  return {
    id: state[FIELD.icao24],
    callsign,
    displayName: callsign || String(state[FIELD.icao24] || '').toUpperCase(),
    originCountry: state[FIELD.originCountry] || 'Unknown',
    latitude,
    longitude,
    baroAltitude: state[FIELD.baroAltitude], // metres
    geoAltitude: state[FIELD.geoAltitude], // metres
    onGround: Boolean(state[FIELD.onGround]),
    velocity: state[FIELD.velocity], // m/s
    heading: state[FIELD.heading], // degrees
    verticalRate: state[FIELD.verticalRate], // m/s
  };
}

/**
 * Fetch airborne aircraft within a react-native-maps region.
 *
 * @param {{latitude:number, longitude:number, latitudeDelta:number, longitudeDelta:number}} region
 * @returns {Promise<Array>} list of aircraft
 */
export async function fetchAircraft(region) {
  const latMin = clamp(region.latitude - region.latitudeDelta / 2, -90, 90);
  const latMax = clamp(region.latitude + region.latitudeDelta / 2, -90, 90);
  const lonMin = clamp(region.longitude - region.longitudeDelta / 2, -180, 180);
  const lonMax = clamp(region.longitude + region.longitudeDelta / 2, -180, 180);

  const url =
    `${BASE_URL}?lamin=${latMin.toFixed(4)}&lamax=${latMax.toFixed(4)}` +
    `&lomin=${lonMin.toFixed(4)}&lomax=${lonMax.toFixed(4)}`;

  const response = await fetch(url);

  if (response.status === 429) {
    throw new Error('OpenSky is rate-limiting anonymous requests. Try again shortly.');
  }
  if (!response.ok) {
    throw new Error(`OpenSky returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  const states = data.states || [];

  return states
    .map(parseState)
    .filter((aircraft) => aircraft && !aircraft.onGround);
}

// ---- Unit conversions (metric API -> aviation-friendly units) ----

export const toFeet = (metres) =>
  metres == null ? null : Math.round(metres * 3.28084);

export const toKnots = (metresPerSecond) =>
  metresPerSecond == null ? null : Math.round(metresPerSecond * 1.94384);

export const toFeetPerMinute = (metresPerSecond) =>
  metresPerSecond == null ? null : Math.round(metresPerSecond * 196.85);
