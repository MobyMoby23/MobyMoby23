import {
  angleBetween,
  bearing,
  coordinateAtDistance,
  cumulativeDistances,
  distance,
  sliceRoute,
  snapToRoute,
} from '../src/core/geo';

/** A straight east-west line at the equator, one vertex every 0.01°. */
const line = Array.from({ length: 11 }, (_, index) => ({
  latitude: 0,
  longitude: index * 0.01,
}));
const cumulative = cumulativeDistances(line);

describe('distance', () => {
  it('measures roughly 1.11 km per 0.01 degree of longitude at the equator', () => {
    expect(distance(line[0], line[1])).toBeCloseTo(1113, -2);
  });

  it('is zero for a point against itself', () => {
    expect(distance(line[3], line[3])).toBe(0);
  });
});

describe('cumulativeDistances', () => {
  it('starts at zero and increases monotonically', () => {
    expect(cumulative).toHaveLength(line.length);
    expect(cumulative[0]).toBe(0);
    for (let index = 1; index < cumulative.length; index += 1) {
      expect(cumulative[index]).toBeGreaterThan(cumulative[index - 1]);
    }
  });
});

describe('snapToRoute', () => {
  it('finds a point on the route with no lateral offset', () => {
    const snapped = snapToRoute({ latitude: 0, longitude: 0.025 }, line, cumulative);

    expect(snapped).not.toBeNull();
    expect(snapped!.lateralDistance).toBeLessThan(1);
    expect(snapped!.distanceAlongRoute).toBeCloseTo((cumulative[2] + cumulative[3]) / 2, -1);
  });

  it('reports lateral distance for a point beside the route', () => {
    // 0.001° of latitude is about 111 m off the line.
    const snapped = snapToRoute({ latitude: 0.001, longitude: 0.05 }, line, cumulative);

    expect(snapped!.lateralDistance).toBeGreaterThan(100);
    expect(snapped!.lateralDistance).toBeLessThan(125);
  });

  it('searches forward only, so a doubling-back route cannot teleport progress', () => {
    // This is the bug the searchFrom parameter exists to prevent: on an
    // out-and-back route a global nearest-point search snaps the driver onto
    // the returning leg and reports a 20 km jump in one second.
    const outAndBack = [...line, ...[...line].reverse()];
    const outAndBackCumulative = cumulativeDistances(outAndBack);
    const ambiguous = { latitude: 0, longitude: 0.02 };

    const early = snapToRoute(ambiguous, outAndBack, outAndBackCumulative);
    const late = snapToRoute(ambiguous, outAndBack, outAndBackCumulative, 12);

    expect(early!.distanceAlongRoute).toBeLessThan(late!.distanceAlongRoute);
  });

  it('returns null for a degenerate route', () => {
    expect(snapToRoute(line[0], [line[0]], [0])).toBeNull();
  });
});

describe('coordinateAtDistance', () => {
  it('interpolates along the route', () => {
    const total = cumulative[cumulative.length - 1];
    const midpoint = coordinateAtDistance(total / 2, line, cumulative);

    expect(midpoint!.longitude).toBeCloseTo(0.05, 4);
  });

  it('clamps to the ends rather than extrapolating', () => {
    expect(coordinateAtDistance(-500, line, cumulative)!.longitude).toBe(line[0].longitude);
    expect(coordinateAtDistance(1e9, line, cumulative)!.longitude).toBe(line[line.length - 1].longitude);
  });
});

describe('sliceRoute', () => {
  it('returns the stretch between two distances', () => {
    const slice = sliceRoute(2_000, 5_000, line, cumulative, 500);

    expect(slice.length).toBeGreaterThan(2);
    expect(slice[0].longitude).toBeCloseTo(0.018, 3);
    expect(slice[slice.length - 1].longitude).toBeCloseTo(0.045, 3);
  });

  it('is empty when the range is inverted or zero-length', () => {
    expect(sliceRoute(5_000, 2_000, line, cumulative)).toEqual([]);
    expect(sliceRoute(3_000, 3_000, line, cumulative)).toEqual([]);
  });
});

describe('bearing and angleBetween', () => {
  it('reads due east along the line', () => {
    expect(bearing(line[0], line[1])).toBeCloseTo(90, 1);
  });

  it('takes the short way around north', () => {
    expect(angleBetween(350, 10)).toBeCloseTo(20);
    expect(angleBetween(10, 350)).toBeCloseTo(20);
    expect(angleBetween(0, 180)).toBeCloseTo(180);
  });
});
