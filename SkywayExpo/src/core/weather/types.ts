import type { Coordinate } from '../geo';

/**
 * A normalised weather condition. Providers map onto this so nothing above
 * this layer branches on where the forecast came from.
 */
export type SkyCondition =
  | 'clear'
  | 'partlyCloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavyRain'
  | 'freezingRain'
  | 'snow'
  | 'heavySnow'
  | 'sleet'
  | 'hail'
  | 'thunderstorms'
  | 'windy'
  | 'unknown';

/** How much a condition should worry a driver. */
export type DrivingSeverity = 0 | 1 | 2 | 3;

export const Severity = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
} as const;

/** Conditions at one point in space and time. */
export type WeatherSnapshot = {
  coordinate: Coordinate;
  date: number;
  condition: SkyCondition;
  /** Celsius. */
  temperature: number;
  /** Celsius, accounting for wind chill and humidity. */
  apparentTemperature: number;
  /** Millimetres in the hour containing `date`. */
  precipitationAmount: number;
  /** 0...1. */
  precipitationChance: number;
  /** Metres per second. */
  windSpeed: number;
  /** Metres per second. */
  windGust: number | null;
  /** Metres. */
  visibility: number | null;
  isDaylight: boolean;
};

export type HourlyForecast = {
  date: number;
  condition: SkyCondition;
  temperature: number;
  precipitationChance: number;
};

/** A stretch of route where the weather is worth mentioning. */
export type RouteWeatherSegment = {
  id: string;
  /** Metres from the start of the route. */
  distanceAlongRoute: number;
  /** When the driver is expected to be here. */
  arrivalTime: number;
  snapshot: WeatherSnapshot;
  /** Best-effort place name for the spoken warning ("rain near Reading"). */
  placeName?: string;
};

export interface WeatherProvider {
  /**
   * Conditions at a place, at a time. `date` may be in the future — the route
   * scanner asks for the weather at the moment the car will arrive.
   */
  snapshot(coordinate: Coordinate, date: number): Promise<WeatherSnapshot>;
  hourly(coordinate: Coordinate, hours: number): Promise<HourlyForecast[]>;
}

export const CONDITION_LABEL: Record<SkyCondition, string> = {
  clear: 'Clear',
  partlyCloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  heavyRain: 'Heavy rain',
  freezingRain: 'Freezing rain',
  snow: 'Snow',
  heavySnow: 'Heavy snow',
  sleet: 'Sleet',
  hail: 'Hail',
  thunderstorms: 'Thunderstorms',
  windy: 'Windy',
  unknown: 'Unknown',
};

/** SF Symbol names — used on the phone and for CarPlay maneuver/button icons. */
export const CONDITION_SYMBOL: Record<SkyCondition, string> = {
  clear: 'sun.max.fill',
  partlyCloudy: 'cloud.sun.fill',
  cloudy: 'cloud.fill',
  fog: 'cloud.fog.fill',
  drizzle: 'cloud.drizzle.fill',
  rain: 'cloud.rain.fill',
  heavyRain: 'cloud.heavyrain.fill',
  freezingRain: 'thermometer.snowflake',
  snow: 'cloud.snow.fill',
  heavySnow: 'wind.snow',
  sleet: 'cloud.sleet.fill',
  hail: 'cloud.hail.fill',
  thunderstorms: 'cloud.bolt.rain.fill',
  windy: 'wind',
  unknown: 'questionmark.circle',
};

const CONDITION_SEVERITY: Record<SkyCondition, DrivingSeverity> = {
  clear: Severity.none,
  partlyCloudy: Severity.none,
  cloudy: Severity.none,
  drizzle: Severity.low,
  windy: Severity.low,
  rain: Severity.moderate,
  fog: Severity.moderate,
  snow: Severity.moderate,
  sleet: Severity.moderate,
  heavyRain: Severity.high,
  heavySnow: Severity.high,
  freezingRain: Severity.high,
  hail: Severity.high,
  thunderstorms: Severity.high,
  unknown: Severity.none,
};

export function conditionSeverity(condition: SkyCondition): DrivingSeverity {
  return CONDITION_SEVERITY[condition];
}

/**
 * Severity that reads the numbers, not just the label.
 *
 * A clear sky with 25 m/s gusts, 150 m visibility, or drizzle at 0 °C are all
 * more dangerous than their condition name suggests, and the last of those is
 * the classic black-ice setup.
 */
export function snapshotSeverity(snapshot: WeatherSnapshot): DrivingSeverity {
  let severity: DrivingSeverity = conditionSeverity(snapshot.condition);

  const gust = snapshot.windGust ?? snapshot.windSpeed;
  if (gust >= 25) severity = Math.max(severity, Severity.high) as DrivingSeverity;
  else if (gust >= 17) severity = Math.max(severity, Severity.moderate) as DrivingSeverity;

  if (snapshot.visibility !== null) {
    if (snapshot.visibility < 200) severity = Math.max(severity, Severity.high) as DrivingSeverity;
    else if (snapshot.visibility < 1_000) severity = Math.max(severity, Severity.moderate) as DrivingSeverity;
  }

  if (snapshot.temperature <= 1 && snapshot.precipitationAmount > 0) {
    severity = Severity.high;
  }

  return severity;
}

/** Colours used for the route weather bands, on both the phone and the car. */
export const SEVERITY_COLOR: Record<DrivingSeverity, string> = {
  0: '#0A84FF',
  1: '#30B0C7',
  2: '#FF9F0A',
  3: '#FF3B30',
};
