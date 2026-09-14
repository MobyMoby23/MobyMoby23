import type { Coordinate } from '../geo';
import type {
  ManeuverModifier,
  ManeuverType,
  Place,
  Route,
  RouteStep,
  RoutingProvider,
} from './types';

const DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic';
const GEOCODING_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

type MapboxManeuver = {
  type?: string;
  modifier?: string;
  instruction?: string;
  location?: [number, number];
  exit?: number;
};

type MapboxStep = {
  maneuver?: MapboxManeuver;
  distance?: number;
  duration?: number;
  name?: string;
  bannerInstructions?: { primary?: { text?: string } }[];
};

type MapboxRoute = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { steps?: MapboxStep[] }[];
};

type DirectionsResponse = {
  routes?: MapboxRoute[];
  code?: string;
  message?: string;
};

type GeocodingResponse = {
  features?: {
    id?: string;
    text?: string;
    place_name?: string;
    center?: [number, number];
  }[];
};

/**
 * Mapbox Directions and Geocoding.
 *
 * `driving-traffic` rather than plain `driving`: the whole point of the ETA is
 * that it reflects the road as it is now, and traffic-aware durations are what
 * make the arrival-time weather forecast land on the right hour.
 */
export class MapboxProvider implements RoutingProvider {
  constructor(private accessToken: string) {}

  get isConfigured(): boolean {
    return this.accessToken.length > 0;
  }

  async route(origin: Coordinate, destination: Coordinate, signal?: AbortSignal): Promise<Route[]> {
    this.assertToken();

    const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const params = new URLSearchParams({
      access_token: this.accessToken,
      alternatives: 'true',
      geometries: 'geojson',
      overview: 'full',
      steps: 'true',
      banner_instructions: 'true',
      annotations: 'duration,distance',
    });

    const response = await fetch(`${DIRECTIONS_BASE}/${coordinates}?${params}`, { signal });
    const body = (await response.json()) as DirectionsResponse;

    if (!response.ok || (body.code && body.code !== 'Ok')) {
      throw new Error(body.message ?? `Mapbox Directions returned ${response.status}`);
    }

    return (body.routes ?? []).map((route, index) => this.parseRoute(route, index));
  }

  async search(query: string, near?: Coordinate, signal?: AbortSignal): Promise<Place[]> {
    this.assertToken();
    const trimmed = query.trim();
    if (!trimmed) return [];

    const params = new URLSearchParams({
      access_token: this.accessToken,
      limit: '10',
      types: 'address,poi,place,postcode,neighborhood,locality',
    });
    if (near) {
      params.set('proximity', `${near.longitude},${near.latitude}`);
    }

    const response = await fetch(
      `${GEOCODING_BASE}/${encodeURIComponent(trimmed)}.json?${params}`,
      { signal },
    );
    if (!response.ok) {
      throw new Error(`Mapbox Geocoding returned ${response.status}`);
    }

    const body = (await response.json()) as GeocodingResponse;
    return (body.features ?? [])
      .filter((feature) => Array.isArray(feature.center))
      .map((feature, index) => ({
        id: feature.id ?? `place-${index}`,
        name: feature.text ?? feature.place_name ?? 'Unnamed place',
        subtitle: feature.place_name,
        coordinate: {
          latitude: feature.center![1],
          longitude: feature.center![0],
        },
      }));
  }

  private assertToken(): void {
    if (!this.isConfigured) {
      throw new Error(
        'No Mapbox access token. Set EXPO_PUBLIC_MAPBOX_TOKEN — see SkywayExpo/README.md.',
      );
    }
  }

  private parseRoute(route: MapboxRoute, index: number): Route {
    const coordinates: Coordinate[] = (route.geometry?.coordinates ?? []).map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    }));

    const steps: RouteStep[] = [];
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        steps.push(this.parseStep(step));
      }
    }

    return {
      id: `route-${index}`,
      distance: route.distance ?? 0,
      duration: route.duration ?? 0,
      coordinates,
      steps,
      weather: [],
      incidents: [],
    };
  }

  private parseStep(step: MapboxStep): RouteStep {
    const maneuver = step.maneuver ?? {};
    const location = maneuver.location;

    return {
      instruction: maneuver.instruction ?? step.name ?? 'Continue',
      // The banner primary text is Mapbox's own short form, sized for a
      // narrow strip — exactly what a small head unit wants.
      shortInstruction: step.bannerInstructions?.[0]?.primary?.text,
      type: parseManeuverType(maneuver.type),
      modifier: parseModifier(maneuver.modifier),
      distance: step.distance ?? 0,
      duration: step.duration ?? 0,
      location: location
        ? { latitude: location[1], longitude: location[0] }
        : { latitude: 0, longitude: 0 },
      exit: maneuver.exit,
    };
  }
}

export function parseManeuverType(type?: string): ManeuverType {
  switch (type) {
    case 'depart':
      return 'depart';
    case 'arrive':
      return 'arrive';
    case 'merge':
      return 'merge';
    case 'on ramp':
      return 'onRamp';
    case 'off ramp':
      return 'offRamp';
    case 'fork':
      return 'fork';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return 'roundabout';
    case 'turn':
    case 'end of road':
    case 'new name':
      return 'turn';
    default:
      return 'continue';
  }
}

export function parseModifier(modifier?: string): ManeuverModifier {
  switch (modifier) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'slight left':
      return 'slightLeft';
    case 'slight right':
      return 'slightRight';
    case 'sharp left':
      return 'sharpLeft';
    case 'sharp right':
      return 'sharpRight';
    case 'uturn':
      return 'uTurn';
    case 'straight':
      return 'straight';
    default:
      return 'none';
  }
}
