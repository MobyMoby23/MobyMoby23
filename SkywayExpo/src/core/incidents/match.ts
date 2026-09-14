import { Coordinate, angleBetween, bearing, cumulativeDistances, snapToRoute } from '../geo';
import { Incident, isActive } from './types';

/**
 * Incidents that actually sit on the route, in the direction of travel.
 *
 * Two filters matter. Lateral distance keeps out reports on a parallel street;
 * bearing keeps out reports on the opposite carriageway of a dual
 * carriageway, which is the classic false positive.
 */
export function incidentsOnRoute(
  incidents: Incident[],
  coordinates: Coordinate[],
  corridorWidth = 60,
): Incident[] {
  if (coordinates.length < 2) return [];
  const cumulative = cumulativeDistances(coordinates);

  const matched: { incident: Incident; along: number }[] = [];

  for (const incident of incidents) {
    if (!isActive(incident)) continue;

    const snapped = snapToRoute(incident.coordinate, coordinates, cumulative);
    if (!snapped || snapped.lateralDistance > corridorWidth) continue;

    if (incident.heading !== null) {
      const segmentIndex = Math.min(snapped.segmentIndex, coordinates.length - 2);
      const routeBearing = bearing(coordinates[segmentIndex], coordinates[segmentIndex + 1]);
      // More than 90° apart means the reporter was travelling the other way;
      // that jam is not this driver's problem.
      if (angleBetween(incident.heading, routeBearing) >= 90) continue;
    }

    matched.push({ incident, along: snapped.distanceAlongRoute });
  }

  return matched.sort((a, b) => a.along - b.along).map((entry) => entry.incident);
}
