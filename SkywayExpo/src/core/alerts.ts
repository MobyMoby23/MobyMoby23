import { Coordinate, cumulativeDistances, snapToRoute } from './geo';
import {
  INCIDENT_LABEL,
  INCIDENT_SYMBOL,
  INCIDENT_WARNING_DISTANCE,
  Incident,
  isActive,
} from './incidents/types';
import {
  CONDITION_LABEL,
  CONDITION_SYMBOL,
  DrivingSeverity,
  RouteWeatherSegment,
  SEVERITY_COLOR,
  Severity,
  snapshotSeverity,
} from './weather/types';

export type DriverAlert = {
  id: string;
  kind: 'incident' | 'weather';
  title: string;
  subtitle: string;
  spokenText: string;
  /** SF Symbol. */
  symbol: string;
  severity: DrivingSeverity;
  color: string;
  /** Metres ahead of the driver when the alert was raised. */
  distanceAhead: number;
  createdAt: number;
  incident?: Incident;
};

export type AlertEngineOptions = {
  /** How long an alert stays current before it clears itself, in ms. */
  alertDurationMs?: number;
  /** Minimum gap between alerts, so three hazards don't stack into a wall. */
  minimumSpacingMs?: number;
};

/**
 * Decides what the driver is told and when.
 *
 * Hazard reports and route weather both converge here, so there is exactly one
 * place that answers "is this worth interrupting someone at 70 mph for?".
 * Everything downstream — the CarPlay banner button, the phone banner, the
 * spoken line — renders whatever this emits.
 */
export class AlertEngine {
  private announced = new Set<string>();
  private coordinates: Coordinate[] = [];
  private cumulative: number[] = [];
  private weather: RouteWeatherSegment[] = [];
  private incidents: Incident[] = [];
  private lastAlertAt = 0;

  private readonly alertDurationMs: number;
  private readonly minimumSpacingMs: number;

  constructor(options: AlertEngineOptions = {}) {
    this.alertDurationMs = options.alertDurationMs ?? 12_000;
    this.minimumSpacingMs = options.minimumSpacingMs ?? 8_000;
  }

  beginTrip(coordinates: Coordinate[]): void {
    this.coordinates = coordinates;
    this.cumulative = cumulativeDistances(coordinates);
    this.announced.clear();
    this.lastAlertAt = 0;
  }

  endTrip(): void {
    this.coordinates = [];
    this.cumulative = [];
    this.weather = [];
    this.incidents = [];
    this.announced.clear();
  }

  setWeather(segments: RouteWeatherSegment[]): void {
    this.weather = segments;
  }

  setIncidents(incidents: Incident[]): void {
    this.incidents = incidents;
  }

  /** True once an alert has been on screen long enough to clear. */
  hasExpired(alert: DriverAlert, now = Date.now()): boolean {
    return now - alert.createdAt > this.alertDurationMs;
  }

  /**
   * Called on every location update while navigating. Returns at most one new
   * alert — never a burst.
   */
  evaluate(location: Coordinate, speed: number, now = Date.now()): DriverAlert | null {
    if (this.coordinates.length < 2) return null;

    const snapped = snapToRoute(location, this.coordinates, this.cumulative);
    if (!snapped) return null;

    const travelled = snapped.distanceAlongRoute;
    const candidate =
      this.nextIncidentAlert(travelled, now) ?? this.nextWeatherAlert(travelled, speed, now);
    if (!candidate) return null;

    if (this.announced.has(candidate.id)) return null;
    if (now - this.lastAlertAt < this.minimumSpacingMs) {
      // Too soon after the last one. Leave it unannounced so the next location
      // update reconsiders it — proximity has only got better.
      return null;
    }

    this.announced.add(candidate.id);
    this.lastAlertAt = now;
    return candidate;
  }

  private nextIncidentAlert(travelled: number, now: number): DriverAlert | null {
    for (const incident of this.incidents) {
      if (!isActive(incident, now)) continue;

      const snapped = snapToRoute(incident.coordinate, this.coordinates, this.cumulative);
      if (!snapped) continue;

      const distanceAhead = snapped.distanceAlongRoute - travelled;
      if (distanceAhead <= 0 || distanceAhead > INCIDENT_WARNING_DISTANCE[incident.kind]) continue;

      const id = `incident-${incident.id}`;
      if (this.announced.has(id)) continue;

      const label = INCIDENT_LABEL[incident.kind];
      const distanceText = formatDistance(distanceAhead);
      const severity: DrivingSeverity =
        incident.kind === 'roadClosed' ? Severity.high : Severity.moderate;

      return {
        id,
        kind: 'incident',
        title: label,
        subtitle: `${distanceText} ahead`,
        spokenText: `${label} reported ${distanceText} ahead.`,
        symbol: INCIDENT_SYMBOL[incident.kind],
        severity,
        color: SEVERITY_COLOR[severity],
        distanceAhead,
        createdAt: now,
        incident,
      };
    }
    return null;
  }

  private nextWeatherAlert(travelled: number, speed: number, now: number): DriverAlert | null {
    // Weather is warned about on time, not distance: two and a half minutes'
    // notice at 30 km/h in town is a few hundred metres, on a motorway it is a
    // couple of kilometres, and it feels the same to the driver in both.
    const lead = Math.max(speed, 8) * 150;

    for (const segment of this.weather) {
      const severity = snapshotSeverity(segment.snapshot);
      if (severity < Severity.moderate) continue;

      const distanceAhead = segment.distanceAlongRoute - travelled;
      if (distanceAhead <= 0 || distanceAhead > lead) continue;

      // Bucketed by 5 km so a drifting sample can't re-announce the same front.
      const id = `weather-${segment.snapshot.condition}-${Math.floor(segment.distanceAlongRoute / 5_000)}`;
      if (this.announced.has(id)) continue;

      const label = CONDITION_LABEL[segment.snapshot.condition];
      const distanceText = formatDistance(distanceAhead);
      const place = segment.placeName ? ` near ${segment.placeName}` : '';

      return {
        id,
        kind: 'weather',
        title: label,
        subtitle: `${distanceText} ahead${place}`,
        spokenText: `${label}${place}, ${distanceText} ahead.`,
        symbol: CONDITION_SYMBOL[segment.snapshot.condition],
        severity,
        color: SEVERITY_COLOR[severity],
        distanceAhead,
        createdAt: now,
      };
    }
    return null;
  }
}

/** Driver-facing distance: rounded hard, because precision is noise at speed. */
export function formatDistance(metres: number): string {
  if (metres < 950) {
    const rounded = metres < 100 ? Math.round(metres / 10) * 10 : Math.round(metres / 50) * 50;
    return `${rounded} m`;
  }
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
