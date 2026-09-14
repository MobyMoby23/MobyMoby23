import { incidentsOnRoute } from '../src/core/incidents/match';
import {
  INCIDENT_TTL,
  INCIDENT_WARNING_DISTANCE,
  Incident,
  IncidentKind,
  expiresAt,
  isActive,
  isCredible,
  isExpired,
} from '../src/core/incidents/types';

function incident(kind: IncidentKind, overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'test',
    kind,
    coordinate: { latitude: 51.5, longitude: -0.12 },
    reportedAt: Date.now(),
    heading: null,
    upvotes: 0,
    downvotes: 0,
    ...overrides,
  };
}

describe('incident lifetime', () => {
  it('treats a fresh report as active', () => {
    const fresh = incident('crash');
    expect(isExpired(fresh)).toBe(false);
    expect(isCredible(fresh)).toBe(true);
    expect(isActive(fresh)).toBe(true);
  });

  it('expires a report after its kind-specific lifetime', () => {
    const old = incident('police', { reportedAt: Date.now() - INCIDENT_TTL.police - 60_000 });
    expect(isExpired(old)).toBe(true);
  });

  it('extends lifetime when other drivers confirm', () => {
    const reportedAt = Date.now() - INCIDENT_TTL.police - 60_000;
    expect(isExpired(incident('police', { reportedAt }))).toBe(true);
    expect(isExpired(incident('police', { reportedAt, upvotes: 4 }))).toBe(false);
  });

  it('caps the extension so nothing lives forever', () => {
    const heavilyConfirmed = incident('police', { upvotes: 10_000 });
    expect(expiresAt(heavilyConfirmed) - heavilyConfirmed.reportedAt).toBe(INCIDENT_TTL.police * 3);
  });

  it('suppresses a report voted down more than up', () => {
    const disputed = incident('hazard', { upvotes: 1, downvotes: 3 });
    expect(isCredible(disputed)).toBe(false);
    expect(isActive(disputed)).toBe(false);
  });

  it('outlives moving hazards for a road closure', () => {
    expect(INCIDENT_TTL.roadClosed).toBeGreaterThan(INCIDENT_TTL.police);
    expect(INCIDENT_WARNING_DISTANCE.roadClosed).toBeGreaterThan(INCIDENT_WARNING_DISTANCE.police);
  });
});

describe('matching incidents to a route', () => {
  const route = Array.from({ length: 11 }, (_, index) => ({ latitude: 0, longitude: index * 0.01 }));

  it('keeps a report sitting on the route', () => {
    const onRoute = incident('crash', { coordinate: { latitude: 0, longitude: 0.05 } });
    expect(incidentsOnRoute([onRoute], route)).toHaveLength(1);
  });

  it('drops a report on a parallel street', () => {
    // ~330 m off the line, well outside the 60 m corridor.
    const parallel = incident('crash', { coordinate: { latitude: 0.003, longitude: 0.05 } });
    expect(incidentsOnRoute([parallel], route)).toHaveLength(0);
  });

  it('drops a report from the opposite carriageway', () => {
    // The route runs east (90°); this reporter was heading west.
    const oncoming = incident('heavyTraffic', {
      coordinate: { latitude: 0, longitude: 0.05 },
      heading: 270,
    });
    expect(incidentsOnRoute([oncoming], route)).toHaveLength(0);
  });

  it('keeps a report from a driver going the same way', () => {
    const sameWay = incident('heavyTraffic', {
      coordinate: { latitude: 0, longitude: 0.05 },
      heading: 92,
    });
    expect(incidentsOnRoute([sameWay], route)).toHaveLength(1);
  });

  it('returns them in the order they will be met', () => {
    const far = incident('crash', { id: 'far', coordinate: { latitude: 0, longitude: 0.08 } });
    const near = incident('police', { id: 'near', coordinate: { latitude: 0, longitude: 0.02 } });

    expect(incidentsOnRoute([far, near], route).map((entry) => entry.id)).toEqual(['near', 'far']);
  });

  it('drops expired reports', () => {
    const stale = incident('police', {
      coordinate: { latitude: 0, longitude: 0.05 },
      reportedAt: Date.now() - INCIDENT_TTL.police - 60_000,
    });
    expect(incidentsOnRoute([stale], route)).toHaveLength(0);
  });
});
