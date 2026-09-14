/**
 * Polyline maths shared by route progress, off-route detection, the alert
 * engine and the weather scanner. Pure functions, no React Native imports —
 * which is what makes this file testable in plain node.
 */

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type PointOnRoute = {
  coordinate: Coordinate;
  /** Metres travelled along the route to reach this point. */
  distanceAlongRoute: number;
  /** Metres between the queried location and the route itself. */
  lateralDistance: number;
  /** Index of the polyline segment this point falls on. */
  segmentIndex: number;
};

const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a flat approximation: at UK latitudes a naive
 * equirectangular formula is out by enough over a 400 km route to shift the
 * weather samples into the wrong forecast cell.
 */
export function distance(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance to each vertex of the route. Always starts at 0. */
export function cumulativeDistances(coordinates: Coordinate[]): number[] {
  const result: number[] = [0];
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distance(coordinates[index - 1], coordinates[index]);
    result.push(total);
  }
  return result;
}

/**
 * Local metres-per-degree scale at a given latitude, so segment projection can
 * be done in a flat plane. Accurate enough over the ~100 m spans of a single
 * polyline segment, and far cheaper than spherical projection per segment.
 */
function localScale(latitude: number): { x: number; y: number } {
  return {
    x: (Math.PI / 180) * EARTH_RADIUS_METRES * Math.cos(toRadians(latitude)),
    y: (Math.PI / 180) * EARTH_RADIUS_METRES,
  };
}

/**
 * Projects `point` onto the route.
 *
 * `searchFrom` matters more than it looks: progress tracking must always
 * search *forward* from where it was. On a route that doubles back — a
 * cloverleaf, an out-and-back errand — a global nearest-point search will
 * happily snap the driver onto the returning leg and report that they have
 * travelled 20 km in one second.
 */
export function snapToRoute(
  point: Coordinate,
  coordinates: Coordinate[],
  cumulative: number[],
  searchFrom = 0,
): PointOnRoute | null {
  if (coordinates.length < 2) return null;

  const scale = localScale(point.latitude);
  const px = point.longitude * scale.x;
  const py = point.latitude * scale.y;

  let best: PointOnRoute | null = null;
  let bestLateral = Number.POSITIVE_INFINITY;

  for (let index = Math.max(0, searchFrom); index < coordinates.length - 1; index += 1) {
    const a = coordinates[index];
    const b = coordinates[index + 1];

    const ax = a.longitude * scale.x;
    const ay = a.latitude * scale.y;
    const bx = b.longitude * scale.x;
    const by = b.latitude * scale.y;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    let t = 0;
    if (lengthSquared > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
      t = Math.min(1, Math.max(0, t));
    }

    const projectedX = ax + t * dx;
    const projectedY = ay + t * dy;
    const lateral = Math.hypot(px - projectedX, py - projectedY);
    if (lateral >= bestLateral) continue;

    bestLateral = lateral;
    const segmentLength = cumulative[index + 1] - cumulative[index];
    best = {
      coordinate: {
        latitude: projectedY / scale.y,
        longitude: projectedX / scale.x,
      },
      distanceAlongRoute: cumulative[index] + segmentLength * t,
      lateralDistance: lateral,
      segmentIndex: index,
    };
  }

  return best;
}

/**
 * The coordinate `metres` from the route's start.
 *
 * Binary search over the cumulative distances, which keeps the weather scan
 * cheap on a route with tens of thousands of vertices.
 */
export function coordinateAtDistance(
  metres: number,
  coordinates: Coordinate[],
  cumulative: number[],
): Coordinate | null {
  if (coordinates.length === 0) return null;
  const total = cumulative[cumulative.length - 1];
  if (metres <= 0) return coordinates[0];
  if (metres >= total) return coordinates[coordinates.length - 1];

  let low = 0;
  let high = cumulative.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] <= metres) low = mid;
    else high = mid;
  }

  const segmentLength = cumulative[high] - cumulative[low];
  if (segmentLength <= 0) return coordinates[low];

  const t = (metres - cumulative[low]) / segmentLength;
  return {
    latitude: coordinates[low].latitude + (coordinates[high].latitude - coordinates[low].latitude) * t,
    longitude: coordinates[low].longitude + (coordinates[high].longitude - coordinates[low].longitude) * t,
  };
}

/** The stretch of route between two distances, as coordinates. */
export function sliceRoute(
  fromMetres: number,
  toMetres: number,
  coordinates: Coordinate[],
  cumulative: number[],
  stepMetres = 250,
): Coordinate[] {
  const start = Math.max(0, fromMetres);
  const end = Math.min(cumulative[cumulative.length - 1] ?? 0, toMetres);
  if (end <= start) return [];

  const slice: Coordinate[] = [];
  for (let metres = start; metres < end; metres += stepMetres) {
    const coordinate = coordinateAtDistance(metres, coordinates, cumulative);
    if (coordinate) slice.push(coordinate);
  }
  const last = coordinateAtDistance(end, coordinates, cumulative);
  if (last) slice.push(last);
  return slice;
}

/** Bearing in degrees from `a` to `b`, 0 = north. */
export function bearing(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two bearings, 0...180. */
export function angleBetween(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}
