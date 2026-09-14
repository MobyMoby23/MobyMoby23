import type { Coordinate } from '../geo';
import type { RouteWeatherSegment } from '../weather/types';
import type { Incident } from '../incidents/types';

export type Place = {
  id: string;
  name: string;
  subtitle?: string;
  coordinate: Coordinate;
};

/**
 * A single instruction. Unlike the MapKit version of this app, the manoeuvre
 * comes back as a structured type rather than being guessed from the
 * instruction text — which is why the turn arrows are actually correct.
 */
export type ManeuverType =
  | 'depart'
  | 'turn'
  | 'merge'
  | 'onRamp'
  | 'offRamp'
  | 'fork'
  | 'roundabout'
  | 'continue'
  | 'arrive';

export type ManeuverModifier =
  | 'left'
  | 'right'
  | 'slightLeft'
  | 'slightRight'
  | 'sharpLeft'
  | 'sharpRight'
  | 'straight'
  | 'uTurn'
  | 'none';

export type RouteStep = {
  instruction: string;
  /** Short form for narrow CarPlay screens, when the provider gives one. */
  shortInstruction?: string;
  type: ManeuverType;
  modifier: ManeuverModifier;
  /** Metres covered by this step. */
  distance: number;
  /** Seconds. */
  duration: number;
  /** Where the manoeuvre happens. */
  location: Coordinate;
  /** Roundabout exit number, when relevant. */
  exit?: number;
};

export type Route = {
  id: string;
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  coordinates: Coordinate[];
  steps: RouteStep[];
  /** Populated once the weather scan finishes. */
  weather: RouteWeatherSegment[];
  /** Incidents sitting on this route, in the direction of travel. */
  incidents: Incident[];
};

export interface RoutingProvider {
  /** Driving routes from A to B, best first, with alternatives when available. */
  route(origin: Coordinate, destination: Coordinate, signal?: AbortSignal): Promise<Route[]>;
  /** Place search, biased towards the driver. */
  search(query: string, near?: Coordinate, signal?: AbortSignal): Promise<Place[]>;
}

/** SF Symbol for a manoeuvre — used on the phone HUD and the CarPlay turn card. */
export function maneuverSymbol(step: Pick<RouteStep, 'type' | 'modifier'>): string {
  if (step.type === 'arrive') return 'mappin.circle.fill';
  if (step.type === 'depart') return 'location.north.line.fill';
  if (step.type === 'roundabout') return 'arrow.triangle.turn.up.right.circle';
  if (step.type === 'merge') return 'arrow.merge';
  if (step.type === 'onRamp' || step.type === 'offRamp') {
    return step.modifier.includes('eft') ? 'arrow.up.left' : 'arrow.up.right';
  }

  switch (step.modifier) {
    case 'left':
      return 'arrow.turn.up.left';
    case 'right':
      return 'arrow.turn.up.right';
    case 'slightLeft':
      return 'arrow.up.left';
    case 'slightRight':
      return 'arrow.up.right';
    case 'sharpLeft':
      return 'arrow.uturn.left';
    case 'sharpRight':
      return 'arrow.uturn.right';
    case 'uTurn':
      return 'arrow.uturn.down';
    default:
      return 'arrow.up';
  }
}
