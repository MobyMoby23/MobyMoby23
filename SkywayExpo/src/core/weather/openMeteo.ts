import type { Coordinate } from '../geo';
import type { HourlyForecast, SkyCondition, WeatherProvider, WeatherSnapshot } from './types';

/**
 * Caches provider results by rounded coordinate and hour.
 *
 * A 400 km route sampled every 12 km is ~35 lookups, and consecutive samples
 * on a motorway often land in the same forecast cell — without this the scan
 * would hammer the provider for answers it already has.
 */
class WeatherCache {
  private store = new Map<string, { value: WeatherSnapshot; storedAt: number }>();

  constructor(
    private lifetimeMs = 20 * 60 * 1000,
    /** Grid resolution in degrees; 0.05° is roughly 5 km. */
    private gridSize = 0.05,
  ) {}

  private key(coordinate: Coordinate, date: number): string {
    const lat = Math.round(coordinate.latitude / this.gridSize);
    const lon = Math.round(coordinate.longitude / this.gridSize);
    const hour = Math.floor(date / 3_600_000);
    return `${lat}:${lon}:${hour}`;
  }

  get(coordinate: Coordinate, date: number): WeatherSnapshot | null {
    const entry = this.store.get(this.key(coordinate, date));
    if (!entry) return null;
    if (Date.now() - entry.storedAt > this.lifetimeMs) return null;
    return entry.value;
  }

  set(coordinate: Coordinate, date: number, value: WeatherSnapshot): void {
    this.store.set(this.key(coordinate, date), { value, storedAt: Date.now() });
  }
}

type OpenMeteoResponse = {
  hourly: {
    time: number[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    precipitation: (number | null)[];
    precipitation_probability?: (number | null)[];
    weather_code: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    visibility?: (number | null)[];
    is_day?: (number | null)[];
  };
};

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'visibility',
  'is_day',
].join(',');

/**
 * Free, keyless weather from open-meteo.com.
 *
 * No account, no API key, no billing — which is why it is the default. The
 * one thing it lacks is an official severe-weather warning feed.
 */
export class OpenMeteoProvider implements WeatherProvider {
  private cache = new WeatherCache();

  async snapshot(coordinate: Coordinate, date: number): Promise<WeatherSnapshot> {
    const cached = this.cache.get(coordinate, date);
    if (cached) return cached;

    const response = await this.fetchForecast(coordinate, this.forecastDays(date));
    const snapshot = this.snapshotAt(response, coordinate, date);
    this.cache.set(coordinate, date, snapshot);
    return snapshot;
  }

  async hourly(coordinate: Coordinate, hours: number): Promise<HourlyForecast[]> {
    const days = Math.min(Math.max(Math.ceil(hours / 24) + 1, 2), 7);
    const response = await this.fetchForecast(coordinate, days);
    const cutoff = Date.now() - 3_600_000;

    const result: HourlyForecast[] = [];
    for (let index = 0; index < response.hourly.time.length && result.length < hours; index += 1) {
      const date = response.hourly.time[index] * 1000;
      if (date < cutoff) continue;
      result.push({
        date,
        condition: conditionFromWmo(response.hourly.weather_code[index] ?? -1),
        temperature: response.hourly.temperature_2m[index] ?? 0,
        precipitationChance: (response.hourly.precipitation_probability?.[index] ?? 0) / 100,
      });
    }
    return result;
  }

  /** Open-Meteo bills forecast length in whole days; ask for just enough. */
  private forecastDays(date: number): number {
    const days = Math.ceil((date - Date.now()) / 86_400_000);
    return Math.min(Math.max(days + 2, 2), 7);
  }

  private async fetchForecast(coordinate: Coordinate, forecastDays: number): Promise<OpenMeteoResponse> {
    const params = new URLSearchParams({
      latitude: coordinate.latitude.toFixed(4),
      longitude: coordinate.longitude.toFixed(4),
      hourly: HOURLY_FIELDS,
      wind_speed_unit: 'ms',
      timeformat: 'unixtime',
      timezone: 'UTC',
      forecast_days: String(forecastDays),
    });

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}`);
    }
    return (await response.json()) as OpenMeteoResponse;
  }

  private snapshotAt(
    response: OpenMeteoResponse,
    coordinate: Coordinate,
    date: number,
  ): WeatherSnapshot {
    const { hourly } = response;
    if (hourly.time.length === 0) {
      throw new Error('Open-Meteo returned an empty forecast');
    }

    // Times are ascending and hourly; take the last one at or before `date`.
    const target = Math.floor(date / 1000);
    let index = 0;
    for (let candidate = 0; candidate < hourly.time.length; candidate += 1) {
      if (hourly.time[candidate] > target) break;
      index = candidate;
    }

    const temperature = hourly.temperature_2m[index] ?? 0;
    return {
      coordinate,
      date: hourly.time[index] * 1000,
      condition: conditionFromWmo(hourly.weather_code[index] ?? -1),
      temperature,
      apparentTemperature: hourly.apparent_temperature[index] ?? temperature,
      precipitationAmount: hourly.precipitation[index] ?? 0,
      precipitationChance: (hourly.precipitation_probability?.[index] ?? 0) / 100,
      windSpeed: hourly.wind_speed_10m[index] ?? 0,
      windGust: hourly.wind_gusts_10m?.[index] ?? null,
      visibility: hourly.visibility?.[index] ?? null,
      isDaylight: (hourly.is_day?.[index] ?? 1) === 1,
    };
  }
}

/**
 * WMO 4677 weather codes, which is what Open-Meteo speaks.
 *
 * Anything unrecognised maps to `unknown`, never to `clear` — defaulting an
 * unknown code to clear would silently suppress a warning.
 */
export function conditionFromWmo(code: number): SkyCondition {
  switch (code) {
    case 0:
      return 'clear';
    case 1:
    case 2:
      return 'partlyCloudy';
    case 3:
      return 'cloudy';
    case 45:
    case 48:
      return 'fog';
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return 'drizzle';
    case 61:
    case 63:
    case 80:
    case 81:
      return 'rain';
    case 65:
    case 82:
      return 'heavyRain';
    case 66:
    case 67:
      return 'freezingRain';
    case 71:
    case 73:
    case 77:
    case 85:
      return 'snow';
    case 75:
    case 86:
      return 'heavySnow';
    case 95:
    case 96:
    case 99:
      return 'thunderstorms';
    default:
      return 'unknown';
  }
}
