import { Coordinate, coordinateAtDistance, cumulativeDistances } from '../geo';
import {
  RouteWeatherSegment,
  Severity,
  WeatherProvider,
  snapshotSeverity,
} from './types';

export type RouteWeatherOptions = {
  /**
   * Distance between samples. 12 km at motorway speed is roughly one sample
   * every 7 minutes — fine enough to catch a front, coarse enough to stay
   * inside a sensible request budget.
   */
  sampleSpacing?: number;
  /** Hard cap so a cross-country route can't fire off hundreds of requests. */
  maxSamples?: number;
  /** Concurrent provider requests. */
  concurrency?: number;
};

type Sample = {
  coordinate: Coordinate;
  distanceAlongRoute: number;
  arrivalTime: number;
};

/**
 * Scans a route and reports the weather the driver will actually meet —
 * forecast at each point for the moment they get there, not for now.
 *
 * This is the piece a plain navigation app doesn't have. Leaving at 16:00 for
 * a three-hour drive, what matters is the snow at hour three, not the clear
 * sky out of the window.
 */
export class RouteWeatherService {
  private readonly sampleSpacing: number;
  private readonly maxSamples: number;
  private readonly concurrency: number;

  constructor(
    private provider: WeatherProvider,
    options: RouteWeatherOptions = {},
  ) {
    this.sampleSpacing = options.sampleSpacing ?? 12_000;
    this.maxSamples = options.maxSamples ?? 40;
    this.concurrency = options.concurrency ?? 6;
  }

  /**
   * Notable weather along a route, merged into segments. Stretches with no
   * severity are dropped — a clear run is not news.
   *
   * @param coordinates the route polyline
   * @param durationSeconds the route's expected driving time
   * @param departure when the driver sets off
   * @param signal abort when the route changes underneath us
   */
  async scan(
    coordinates: Coordinate[],
    durationSeconds: number,
    departure = Date.now(),
    signal?: AbortSignal,
  ): Promise<RouteWeatherSegment[]> {
    if (coordinates.length < 2) return [];

    const cumulative = cumulativeDistances(coordinates);
    const total = cumulative[cumulative.length - 1];
    if (total <= 0) return [];

    const averageSpeed = total / Math.max(durationSeconds, 1);
    const samples = this.samplePoints(total, coordinates, cumulative, departure, averageSpeed);
    const segments = await this.fetchSnapshots(samples, signal);
    return this.merge(segments);
  }

  private samplePoints(
    total: number,
    coordinates: Coordinate[],
    cumulative: number[],
    departure: number,
    averageSpeed: number,
  ): Sample[] {
    // Widen the spacing rather than truncate the route: a long drive gets
    // coarser samples but still covers the whole way to the destination.
    const spacing = Math.max(this.sampleSpacing, total / this.maxSamples);
    const samples: Sample[] = [];

    for (let metres = 0; metres <= total; metres += spacing) {
      const coordinate = coordinateAtDistance(metres, coordinates, cumulative);
      if (!coordinate) continue;
      samples.push({
        coordinate,
        distanceAlongRoute: metres,
        arrivalTime: departure + (metres / Math.max(averageSpeed, 1)) * 1000,
      });
    }
    return samples;
  }

  private async fetchSnapshots(
    samples: Sample[],
    signal?: AbortSignal,
  ): Promise<RouteWeatherSegment[]> {
    const results: RouteWeatherSegment[] = [];

    // Fetched in batches: fast enough that the scan finishes while the trip
    // preview is still on screen, without opening forty sockets at once.
    for (let start = 0; start < samples.length; start += this.concurrency) {
      if (signal?.aborted) break;
      const batch = samples.slice(start, start + this.concurrency);

      const settled = await Promise.all(
        batch.map(async (sample): Promise<RouteWeatherSegment | null> => {
          try {
            const snapshot = await this.provider.snapshot(sample.coordinate, sample.arrivalTime);
            return {
              id: `${Math.round(sample.distanceAlongRoute)}`,
              distanceAlongRoute: sample.distanceAlongRoute,
              arrivalTime: sample.arrivalTime,
              snapshot,
            };
          } catch {
            // One failed cell must not sink the whole scan; the driver still
            // gets warned about every other stretch of the route.
            return null;
          }
        }),
      );

      for (const segment of settled) {
        if (segment) results.push(segment);
      }
    }

    return results.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute);
  }

  /**
   * Collapses runs of samples sharing a condition into one segment, keeping
   * the worst reading of the run. Twelve consecutive "rain" samples should be
   * one warning, not twelve.
   */
  private merge(segments: RouteWeatherSegment[]): RouteWeatherSegment[] {
    const merged: RouteWeatherSegment[] = [];
    // Contiguity is measured against the last sample actually seen, not
    // against the representative segment being kept. Measuring against the
    // representative splits any front longer than the tolerance into pieces —
    // a 50 km band of rain became two warnings.
    let lastSeenDistance = Number.NEGATIVE_INFINITY;

    for (const segment of segments) {
      if (snapshotSeverity(segment.snapshot) === Severity.none) continue;

      const last = merged[merged.length - 1];
      const contiguous =
        last !== undefined &&
        last.snapshot.condition === segment.snapshot.condition &&
        segment.distanceAlongRoute - lastSeenDistance <= this.sampleSpacing * 2.5;

      if (contiguous) {
        lastSeenDistance = segment.distanceAlongRoute;
        if (snapshotSeverity(segment.snapshot) > snapshotSeverity(last.snapshot)) {
          // Take the worse reading, but keep where the run *starts*: the
          // driver meets the front at its edge, so warning them about the
          // distance to its worst point would be too late.
          merged[merged.length - 1] = {
            ...segment,
            id: last.id,
            distanceAlongRoute: last.distanceAlongRoute,
            arrivalTime: last.arrivalTime,
          };
        }
        continue;
      }

      merged.push(segment);
      lastSeenDistance = segment.distanceAlongRoute;
    }

    return merged;
  }
}
