import type { Coordinate } from '../geo';

export type IncidentKind =
  | 'police'
  | 'crash'
  | 'hazard'
  | 'heavyTraffic'
  | 'roadClosed'
  | 'objectOnRoad'
  | 'flooding'
  | 'ice';

export const INCIDENT_KINDS: IncidentKind[] = [
  'police',
  'crash',
  'hazard',
  'heavyTraffic',
  'roadClosed',
  'objectOnRoad',
  'flooding',
  'ice',
];

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  police: 'Police',
  crash: 'Crash',
  hazard: 'Hazard',
  heavyTraffic: 'Heavy traffic',
  roadClosed: 'Road closed',
  objectOnRoad: 'Object on road',
  flooding: 'Flooding',
  ice: 'Ice',
};

/** SF Symbol names, used on the phone map and for CarPlay buttons. */
export const INCIDENT_SYMBOL: Record<IncidentKind, string> = {
  police: 'shield.lefthalf.filled',
  crash: 'car.side.rear.and.collision.and.car.side.front',
  hazard: 'exclamationmark.triangle.fill',
  heavyTraffic: 'car.2.fill',
  roadClosed: 'xmark.octagon.fill',
  objectOnRoad: 'shippingbox.fill',
  flooding: 'water.waves',
  ice: 'snowflake',
};

/**
 * How long a report of each kind stays trustworthy without confirmation,
 * in milliseconds. Police move; a closed road does not.
 */
export const INCIDENT_TTL: Record<IncidentKind, number> = {
  police: 30 * 60_000,
  crash: 60 * 60_000,
  heavyTraffic: 60 * 60_000,
  hazard: 90 * 60_000,
  objectOnRoad: 90 * 60_000,
  flooding: 3 * 60 * 60_000,
  ice: 3 * 60 * 60_000,
  roadClosed: 6 * 60 * 60_000,
};

/** Metres ahead at which the driver should be warned. */
export const INCIDENT_WARNING_DISTANCE: Record<IncidentKind, number> = {
  police: 800,
  heavyTraffic: 800,
  crash: 1_000,
  hazard: 1_000,
  objectOnRoad: 1_000,
  flooding: 1_500,
  ice: 1_500,
  roadClosed: 2_000,
};

/**
 * A community-reported road event — the crowd-sourced layer that makes a
 * navigation app feel alive rather than just a router.
 */
export type Incident = {
  id: string;
  kind: IncidentKind;
  coordinate: Coordinate;
  reportedAt: number;
  /**
   * Bearing of the reporter in degrees, when known. Used to avoid warning
   * about an incident on the opposite carriageway.
   */
  heading: number | null;
  upvotes: number;
  downvotes: number;
  note?: string;
};

/**
 * When a report stops being shown.
 *
 * Every confirmation buys it another quarter of its base lifetime, capped at
 * three times the base so nothing lives forever.
 */
export function expiresAt(incident: Incident): number {
  const base = INCIDENT_TTL[incident.kind];
  const bonus = Math.min(incident.upvotes * base * 0.25, base * 2);
  return incident.reportedAt + base + bonus;
}

export function isExpired(incident: Incident, now = Date.now()): boolean {
  return now >= expiresAt(incident);
}

/** Reports the crowd has voted down more than up are suppressed. */
export function isCredible(incident: Incident): boolean {
  return incident.upvotes >= incident.downvotes;
}

export function isActive(incident: Incident, now = Date.now()): boolean {
  return !isExpired(incident, now) && isCredible(incident);
}

export interface IncidentStore {
  nearby(coordinate: Coordinate, radius: number): Promise<Incident[]>;
  report(incident: Incident): Promise<void>;
  vote(id: string, confirms: boolean): Promise<void>;
}
