import { AlertEngine, formatDistance, formatDuration } from '../src/core/alerts';
import type { Coordinate } from '../src/core/geo';
import { INCIDENT_TTL, Incident, IncidentKind } from '../src/core/incidents/types';
import type { RouteWeatherSegment, SkyCondition } from '../src/core/weather/types';

/** ~11 km of route heading east. */
const route: Coordinate[] = Array.from({ length: 11 }, (_, index) => ({
  latitude: 0,
  longitude: index * 0.01,
}));

function incident(kind: IncidentKind, longitude: number, overrides: Partial<Incident> = {}): Incident {
  return {
    id: `${kind}-${longitude}`,
    kind,
    coordinate: { latitude: 0, longitude },
    reportedAt: Date.now(),
    heading: null,
    upvotes: 0,
    downvotes: 0,
    ...overrides,
  };
}

function weatherSegment(distanceAlongRoute: number, condition: SkyCondition): RouteWeatherSegment {
  return {
    id: `w-${distanceAlongRoute}`,
    distanceAlongRoute,
    arrivalTime: Date.now() + 600_000,
    snapshot: {
      coordinate: { latitude: 0, longitude: 0 },
      date: Date.now(),
      condition,
      temperature: 6,
      apparentTemperature: 4,
      precipitationAmount: 2,
      precipitationChance: 0.9,
      windSpeed: 6,
      windGust: 9,
      visibility: 4_000,
      isDaylight: true,
    },
  };
}

function makeEngine(): AlertEngine {
  const engine = new AlertEngine();
  engine.beginTrip(route);
  return engine;
}

const at = (longitude: number): Coordinate => ({ latitude: 0, longitude });

describe('incident alerts', () => {
  it('raises an alert for a hazard ahead', () => {
    const engine = makeEngine();
    engine.setIncidents([incident('crash', 0.008)]);

    const alert = engine.evaluate(at(0.001), 20);

    expect(alert).not.toBeNull();
    expect(alert!.title).toBe('Crash');
    expect(alert!.kind).toBe('incident');
  });

  it('ignores a hazard behind the driver', () => {
    const engine = makeEngine();
    engine.setIncidents([incident('crash', 0.001)]);

    expect(engine.evaluate(at(0.05), 20)).toBeNull();
  });

  it('waits until a distant hazard is inside its warning window', () => {
    const engine = makeEngine();
    engine.setIncidents([incident('police', 0.09)]);

    expect(engine.evaluate(at(0), 20)).toBeNull();
  });

  it('ignores an expired report', () => {
    const engine = makeEngine();
    engine.setIncidents([
      incident('police', 0.005, { reportedAt: Date.now() - INCIDENT_TTL.police - 60_000 }),
    ]);

    expect(engine.evaluate(at(0.001), 20)).toBeNull();
  });

  it('ignores a report the crowd has voted down', () => {
    const engine = makeEngine();
    engine.setIncidents([incident('crash', 0.008, { upvotes: 1, downvotes: 4 })]);

    expect(engine.evaluate(at(0.001), 20)).toBeNull();
  });

  it('announces the same hazard only once per trip', () => {
    const engine = makeEngine();
    engine.setIncidents([incident('crash', 0.008)]);

    const first = engine.evaluate(at(0.001), 20);
    const second = engine.evaluate(at(0.002), 20, Date.now() + 30_000);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('starts a fresh slate on a new trip', () => {
    const engine = makeEngine();
    const hazard = incident('crash', 0.008);
    engine.setIncidents([hazard]);
    expect(engine.evaluate(at(0.001), 20)).not.toBeNull();

    engine.endTrip();
    engine.beginTrip(route);
    engine.setIncidents([hazard]);

    expect(engine.evaluate(at(0.001), 20)).not.toBeNull();
  });
});

describe('weather alerts', () => {
  it('stays quiet for weather below moderate severity', () => {
    const engine = makeEngine();
    engine.setWeather([weatherSegment(900, 'drizzle')]);

    expect(engine.evaluate(at(0.001), 25)).toBeNull();
  });

  it('warns about severe weather on the route', () => {
    const engine = makeEngine();
    engine.setWeather([weatherSegment(900, 'heavySnow')]);

    const alert = engine.evaluate(at(0.001), 25);

    expect(alert).not.toBeNull();
    expect(alert!.title).toBe('Heavy snow');
    expect(alert!.kind).toBe('weather');
  });

  it('scales its lead distance with speed, so the warning lands at the same time', () => {
    // 4 km ahead: too far at 8 m/s in town, in range at 30 m/s on a motorway.
    const slow = makeEngine();
    slow.setWeather([weatherSegment(4_000, 'heavyRain')]);
    expect(slow.evaluate(at(0), 8)).toBeNull();

    const fast = makeEngine();
    fast.setWeather([weatherSegment(4_000, 'heavyRain')]);
    expect(fast.evaluate(at(0), 30)).not.toBeNull();
  });

  it('buckets by 5 km so a drifting sample cannot re-announce the same front', () => {
    const engine = makeEngine();
    engine.setWeather([weatherSegment(900, 'heavyRain')]);
    expect(engine.evaluate(at(0), 25)).not.toBeNull();

    engine.setWeather([weatherSegment(1_100, 'heavyRain')]);
    expect(engine.evaluate(at(0.001), 25, Date.now() + 30_000)).toBeNull();
  });
});

describe('alert spacing', () => {
  it('does not stack two alerts back to back', () => {
    const engine = makeEngine();
    const now = Date.now();
    engine.setIncidents([incident('crash', 0.008), incident('police', 0.0085)]);

    expect(engine.evaluate(at(0.001), 20, now)).not.toBeNull();
    expect(engine.evaluate(at(0.0012), 20, now + 1_000)).toBeNull();
  });

  it('lets the second alert through once the gap has passed', () => {
    const engine = makeEngine();
    const now = Date.now();
    // The police report must be inside its own 800 m window at the second
    // evaluation, or the null would mean "not close enough yet" rather than
    // "spacing rule" and the test would prove nothing.
    engine.setIncidents([incident('crash', 0.008), incident('police', 0.0083)]);

    engine.evaluate(at(0.001), 20, now);
    const second = engine.evaluate(at(0.0012), 20, now + 9_000);

    expect(second).not.toBeNull();
  });

  it('prefers hazards over weather when both are due', () => {
    const engine = makeEngine();
    engine.setIncidents([incident('crash', 0.008)]);
    engine.setWeather([weatherSegment(900, 'heavySnow')]);

    expect(engine.evaluate(at(0.001), 25)!.kind).toBe('incident');
  });

  it('stays silent with no route', () => {
    const engine = new AlertEngine();
    engine.setIncidents([incident('crash', 0.008)]);

    expect(engine.evaluate(at(0.001), 20)).toBeNull();
  });
});

describe('formatting', () => {
  it('rounds distance hard, because precision is noise at speed', () => {
    expect(formatDistance(43)).toBe('40 m');
    expect(formatDistance(380)).toBe('400 m');
    expect(formatDistance(1_240)).toBe('1.2 km');
    expect(formatDistance(23_400)).toBe('23 km');
  });

  it('formats duration in hours and minutes', () => {
    expect(formatDuration(90)).toBe('2 min');
    expect(formatDuration(3_600)).toBe('1 hr');
    expect(formatDuration(5_400)).toBe('1 hr 30 min');
  });
});
