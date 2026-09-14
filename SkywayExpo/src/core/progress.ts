import { Coordinate, cumulativeDistances, snapToRoute } from './geo';
import type { Route } from './routing/types';

export type TripProgress = {
  /** Metres. */
  distanceRemaining: number;
  /** Seconds. */
  timeRemaining: number;
  /** Metres to the next manoeuvre. */
  distanceToNextManeuver: number;
  stepIndex: number;
  isOffRoute: boolean;
  /** Metres travelled along the route. */
  distanceAlongRoute: number;
};

export const ZERO_PROGRESS: TripProgress = {
  distanceRemaining: 0,
  timeRemaining: 0,
  distanceToNextManeuver: 0,
  stepIndex: 0,
  isOffRoute: false,
  distanceAlongRoute: 0,
};

/** Distance from the route beyond which the driver is considered off it. */
export const OFF_ROUTE_THRESHOLD = 45;

/**
 * Tracks a car's position against a route.
 *
 * Stateful in exactly one respect: it remembers where the driver was, so the
 * snap search only ever moves forward. Without that, a route that doubles back
 * can teleport progress to the returning leg.
 */
export class RouteTracker {
  private coordinates: Coordinate[];
  private cumulative: number[];
  private stepStartDistances: number[];
  private searchIndex = 0;

  constructor(private route: Route) {
    this.coordinates = route.coordinates;
    this.cumulative = cumulativeDistances(route.coordinates);
    this.stepStartDistances = this.computeStepStarts();
  }

  get totalDistance(): number {
    return this.cumulative[this.cumulative.length - 1] ?? this.route.distance;
  }

  /**
   * Each step reports the coordinate of its manoeuvre; snapping that onto the
   * full polyline tells us where the step begins in route distance.
   */
  private computeStepStarts(): number[] {
    return this.route.steps.map((step) => {
      const snapped = snapToRoute(step.location, this.coordinates, this.cumulative);
      return snapped?.distanceAlongRoute ?? 0;
    });
  }

  update(location: Coordinate, speed: number): TripProgress | null {
    const snapped = snapToRoute(
      location,
      this.coordinates,
      this.cumulative,
      Math.max(0, this.searchIndex - 5),
    );
    if (!snapped) return null;

    this.searchIndex = snapped.segmentIndex;

    const total = this.totalDistance;
    const distanceRemaining = Math.max(0, total - snapped.distanceAlongRoute);
    const stepIndex = this.stepIndexFor(snapped.distanceAlongRoute);
    const nextStepStart =
      stepIndex + 1 < this.stepStartDistances.length
        ? this.stepStartDistances[stepIndex + 1]
        : total;

    return {
      distanceRemaining,
      timeRemaining: this.estimateTimeRemaining(distanceRemaining, total, speed),
      distanceToNextManeuver: Math.max(0, nextStepStart - snapped.distanceAlongRoute),
      stepIndex,
      isOffRoute: snapped.lateralDistance > OFF_ROUTE_THRESHOLD,
      distanceAlongRoute: snapped.distanceAlongRoute,
    };
  }

  /** The last step whose start the driver has already passed. */
  private stepIndexFor(distanceAlongRoute: number): number {
    let index = 0;
    for (let candidate = 0; candidate < this.stepStartDistances.length; candidate += 1) {
      if (this.stepStartDistances[candidate] <= distanceAlongRoute) index = candidate;
    }
    return index;
  }

  /**
   * Blends the route's own estimate with the speed actually being driven, so a
   * crawl in traffic pushes the ETA out instead of pretending.
   *
   * The plan is weighted more heavily: a momentary 20 km/h through a village
   * should not claim the remaining motorway will be driven at 20 km/h.
   */
  private estimateTimeRemaining(
    distanceRemaining: number,
    total: number,
    speed: number,
  ): number {
    if (total <= 0) return 0;
    const plannedAverage = total / Math.max(this.route.duration, 1);
    const plannedEstimate = distanceRemaining / Math.max(plannedAverage, 1);

    if (speed <= 2) return plannedEstimate;
    const observedEstimate = distanceRemaining / speed;
    return plannedEstimate * 0.75 + observedEstimate * 0.25;
  }
}
