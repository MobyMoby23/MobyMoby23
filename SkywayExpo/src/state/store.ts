import { create } from 'zustand';
import type { Coordinate } from '../core/geo';
import { AlertEngine, DriverAlert } from '../core/alerts';
import { RouteTracker, TripProgress, ZERO_PROGRESS } from '../core/progress';
import { LocalIncidentStore, RemoteIncidentStore } from '../core/incidents/store';
import { incidentsOnRoute } from '../core/incidents/match';
import {
  Incident,
  IncidentKind,
  IncidentStore,
  isActive,
} from '../core/incidents/types';
import { MapboxProvider } from '../core/routing/mapbox';
import type { Place, Route } from '../core/routing/types';
import { OpenMeteoProvider } from '../core/weather/openMeteo';
import { RouteWeatherService } from '../core/weather/routeWeather';
import type { HourlyForecast, RouteWeatherSegment, WeatherSnapshot } from '../core/weather/types';
import { MAPBOX_TOKEN, INCIDENT_BASE_URL } from '../config';

export type TripState = 'idle' | 'planning' | 'previewing' | 'navigating' | 'arrived';

/**
 * The single source of truth, shared by the phone UI and the CarPlay
 * controller.
 *
 * This is a zustand *vanilla* store on purpose. The CarPlay layer lives
 * outside React — it is driven by native scene events, not by a component
 * tree — so it needs to read and subscribe without hooks. Components use the
 * same store through the hook. One trip, two screens.
 */
export type SkywayState = {
  // Location
  location: Coordinate | null;
  heading: number | null;
  /** Metres per second. */
  speed: number;

  // Trip
  tripState: TripState;
  destination: Place | null;
  routes: Route[];
  selectedRouteId: string | null;
  progress: TripProgress;
  error: string | null;

  // Weather
  currentWeather: WeatherSnapshot | null;
  destinationForecast: HourlyForecast[];

  // Community
  incidents: Incident[];
  activeAlert: DriverAlert | null;

  // Preferences
  muted: boolean;
  carPlayConnected: boolean;
};

const routingProvider = new MapboxProvider(MAPBOX_TOKEN);
const weatherProvider = new OpenMeteoProvider();
const routeWeather = new RouteWeatherService(weatherProvider);
const incidentStore: IncidentStore = INCIDENT_BASE_URL
  ? new RemoteIncidentStore(INCIDENT_BASE_URL)
  : new LocalIncidentStore();
const alertEngine = new AlertEngine();

export const useSkyway = create<SkywayState>(() => ({
  location: null,
  heading: null,
  speed: 0,
  tripState: 'idle',
  destination: null,
  routes: [],
  selectedRouteId: null,
  progress: ZERO_PROGRESS,
  error: null,
  currentWeather: null,
  destinationForecast: [],
  incidents: [],
  activeAlert: null,
  muted: false,
  carPlayConnected: false,
}));

/** Non-hook accessors, for the CarPlay controller and the actions below. */
export const skyway = {
  get: useSkyway.getState,
  set: useSkyway.setState,
  subscribe: useSkyway.subscribe,
  routing: routingProvider,
  weather: weatherProvider,
  incidents: incidentStore,
  alerts: alertEngine,
};

export function selectedRoute(state: SkywayState = useSkyway.getState()): Route | null {
  return state.routes.find((route) => route.id === state.selectedRouteId) ?? state.routes[0] ?? null;
}

// ---------------------------------------------------------------------------
// Trip lifecycle
// ---------------------------------------------------------------------------

let tracker: RouteTracker | null = null;
let weatherScan: AbortController | null = null;
let routeRequest: AbortController | null = null;
let lastWeatherFix: Coordinate | null = null;
let lastIncidentFix: Coordinate | null = null;
let lastIncidentAt = 0;
let lastRerouteAt = 0;

/** Listeners the voice layer and the CarPlay layer attach to. */
type Listener = {
  onAlert?: (alert: DriverAlert) => void;
  onRouteChanged?: (route: Route) => void;
  onArrived?: (destination: Place) => void;
  onStepChanged?: (stepIndex: number) => void;
};

const listeners = new Set<Listener>();

export function addSkywayListener(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit<K extends keyof Listener>(event: K, ...args: Parameters<NonNullable<Listener[K]>>) {
  for (const listener of listeners) {
    const handler = listener[event] as ((...a: unknown[]) => void) | undefined;
    handler?.(...args);
  }
}

export async function planTrip(destination: Place): Promise<void> {
  const { location } = useSkyway.getState();
  if (!location) {
    useSkyway.setState({ error: 'Waiting for a GPS fix.' });
    return;
  }

  routeRequest?.abort();
  routeRequest = new AbortController();

  useSkyway.setState({
    tripState: 'planning',
    destination,
    error: null,
    routes: [],
    selectedRouteId: null,
  });

  try {
    const routes = await routingProvider.route(
      location,
      destination.coordinate,
      routeRequest.signal,
    );
    if (routes.length === 0) {
      useSkyway.setState({ tripState: 'idle', error: 'No driving route found.' });
      return;
    }

    const { incidents } = useSkyway.getState();
    const decorated = routes.map((route) => ({
      ...route,
      incidents: incidentsOnRoute(incidents, route.coordinates),
    }));

    useSkyway.setState({
      routes: decorated,
      selectedRouteId: decorated[0].id,
      tripState: 'previewing',
    });

    void scanWeather();
    void loadDestinationForecast(destination);
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    useSkyway.setState({ tripState: 'idle', error: (error as Error).message });
  }
}

/**
 * Scans every route option, so the driver can compare weather before choosing.
 * Runs after the preview is already on screen — the lines fill in a beat late,
 * which is intentional and better than making the driver wait for the map.
 */
async function scanWeather(): Promise<void> {
  weatherScan?.abort();
  weatherScan = new AbortController();
  const { signal } = weatherScan;

  const routes = useSkyway.getState().routes;
  for (const route of routes) {
    const segments = await routeWeather.scan(
      route.coordinates,
      route.duration,
      Date.now(),
      signal,
    );
    if (signal.aborted) return;

    useSkyway.setState((state) => ({
      routes: state.routes.map((candidate) =>
        candidate.id === route.id ? { ...candidate, weather: segments } : candidate,
      ),
    }));

    const active = selectedRoute();
    if (active?.id === route.id) {
      alertEngine.setWeather(segments);
    }
  }
}

async function loadDestinationForecast(destination: Place): Promise<void> {
  try {
    const forecast = await weatherProvider.hourly(destination.coordinate, 12);
    useSkyway.setState({ destinationForecast: forecast });
  } catch {
    useSkyway.setState({ destinationForecast: [] });
  }
}

export function selectRoute(routeId: string): void {
  useSkyway.setState({ selectedRouteId: routeId });
  const route = selectedRoute();
  if (route) alertEngine.setWeather(route.weather);
}

export function startTrip(route: Route): void {
  tracker = new RouteTracker(route);
  alertEngine.beginTrip(route.coordinates);
  alertEngine.setWeather(route.weather);
  alertEngine.setIncidents(route.incidents);

  useSkyway.setState({
    tripState: 'navigating',
    selectedRouteId: route.id,
    activeAlert: null,
    progress: ZERO_PROGRESS,
  });
  emit('onRouteChanged', route);
}

export function cancelTrip(): void {
  weatherScan?.abort();
  routeRequest?.abort();
  tracker = null;
  alertEngine.endTrip();

  useSkyway.setState({
    tripState: 'idle',
    destination: null,
    routes: [],
    selectedRouteId: null,
    progress: ZERO_PROGRESS,
    activeAlert: null,
    destinationForecast: [],
  });
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

let lastStepIndex = -1;

export function onLocationUpdate(location: Coordinate, heading: number | null, speed: number): void {
  useSkyway.setState({ location, heading, speed: Math.max(0, speed) });

  void refreshLocalWeather(location);
  void refreshIncidents(location);

  const state = useSkyway.getState();
  if (state.tripState !== 'navigating' || !tracker) return;

  const progress = tracker.update(location, speed);
  if (!progress) return;

  useSkyway.setState({ progress });

  if (progress.stepIndex !== lastStepIndex) {
    lastStepIndex = progress.stepIndex;
    emit('onStepChanged', progress.stepIndex);
  }

  if (progress.distanceRemaining < 40) {
    arrive();
    return;
  }

  const alert = alertEngine.evaluate(location, speed);
  if (alert) {
    useSkyway.setState({ activeAlert: alert });
    emit('onAlert', alert);
  } else {
    const current = useSkyway.getState().activeAlert;
    if (current && alertEngine.hasExpired(current)) {
      useSkyway.setState({ activeAlert: null });
    }
  }

  if (progress.isOffRoute) void reroute();
}

function arrive(): void {
  const { destination } = useSkyway.getState();
  useSkyway.setState({ tripState: 'arrived', progress: ZERO_PROGRESS, activeAlert: null });
  alertEngine.endTrip();
  tracker = null;
  if (destination) emit('onArrived', destination);
}

/**
 * Rate-limited: a driver stuck on a service road shouldn't trigger a reroute
 * on every fix, and one bad urban-canyon fix shouldn't trigger one at all.
 */
async function reroute(): Promise<void> {
  const now = Date.now();
  if (now - lastRerouteAt < 15_000) return;
  lastRerouteAt = now;

  const { location, destination, incidents } = useSkyway.getState();
  if (!location || !destination) return;

  try {
    const routes = await routingProvider.route(location, destination.coordinate);
    const next = routes[0];
    if (!next) return;

    const decorated: Route = { ...next, incidents: incidentsOnRoute(incidents, next.coordinates) };
    tracker = new RouteTracker(decorated);
    alertEngine.beginTrip(decorated.coordinates);
    alertEngine.setIncidents(decorated.incidents);

    useSkyway.setState({ routes: [decorated], selectedRouteId: decorated.id });
    emit('onRouteChanged', decorated);
    void scanWeather();
  } catch {
    // Keep guiding on the old route; the next fix will try again.
  }
}

// ---------------------------------------------------------------------------
// Ambient refreshes
// ---------------------------------------------------------------------------

async function refreshLocalWeather(location: Coordinate): Promise<void> {
  if (lastWeatherFix && haversineish(lastWeatherFix, location) < 5_000) return;
  lastWeatherFix = location;
  try {
    const snapshot = await weatherProvider.snapshot(location, Date.now());
    useSkyway.setState({ currentWeather: snapshot });
  } catch {
    // Leave the last known conditions on screen rather than blanking them.
  }
}

async function refreshIncidents(location: Coordinate): Promise<void> {
  const now = Date.now();
  const movedFar = !lastIncidentFix || haversineish(lastIncidentFix, location) > 8_000;
  if (!movedFar && now - lastIncidentAt < 45_000) return;

  lastIncidentFix = location;
  lastIncidentAt = now;

  const nearby = await incidentStore.nearby(location, 25_000);
  useSkyway.setState({ incidents: nearby });

  const route = selectedRoute();
  if (route) {
    const onRoute = incidentsOnRoute(nearby, route.coordinates);
    alertEngine.setIncidents(onRoute);
    useSkyway.setState((state) => ({
      routes: state.routes.map((candidate) =>
        candidate.id === route.id ? { ...candidate, incidents: onRoute } : candidate,
      ),
    }));
  }
}

/** Cheap planar distance — only ever used for "has the car moved far?" checks. */
function haversineish(a: Coordinate, b: Coordinate): number {
  const dx = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  const dy = (a.latitude - b.latitude) * 110_540;
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export async function reportIncident(kind: IncidentKind): Promise<Incident | null> {
  const { location, heading } = useSkyway.getState();
  if (!location) return null;

  const incident: Incident = {
    id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    kind,
    coordinate: location,
    reportedAt: Date.now(),
    heading,
    upvotes: 1,
    downvotes: 0,
  };

  await incidentStore.report(incident);
  useSkyway.setState((state) => ({ incidents: [...state.incidents, incident] }));
  return incident;
}

export async function voteOnIncident(id: string, confirms: boolean): Promise<void> {
  await incidentStore.vote(id, confirms);
  useSkyway.setState((state) => ({
    incidents: state.incidents
      .map((incident) =>
        incident.id === id
          ? {
              ...incident,
              upvotes: incident.upvotes + (confirms ? 1 : 0),
              downvotes: incident.downvotes + (confirms ? 0 : 1),
            }
          : incident,
      )
      .filter((incident) => isActive(incident)),
  }));
}

export function dismissAlert(): void {
  useSkyway.setState({ activeAlert: null });
}

export function setMuted(muted: boolean): void {
  useSkyway.setState({ muted });
}
