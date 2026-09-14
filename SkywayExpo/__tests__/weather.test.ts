import { conditionFromWmo } from '../src/core/weather/openMeteo';
import { RouteWeatherService } from '../src/core/weather/routeWeather';
import {
  SkyCondition,
  Severity,
  WeatherSnapshot,
  conditionSeverity,
  snapshotSeverity,
} from '../src/core/weather/types';
import type { Coordinate } from '../src/core/geo';
import type { WeatherProvider } from '../src/core/weather/types';

function snapshot(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    coordinate: { latitude: 51.5, longitude: -0.12 },
    date: Date.now(),
    condition: 'clear',
    temperature: 15,
    apparentTemperature: 15,
    precipitationAmount: 0,
    precipitationChance: 0,
    windSpeed: 2,
    windGust: null,
    visibility: 20_000,
    isDaylight: true,
    ...overrides,
  };
}

describe('WMO code mapping', () => {
  it('maps the codes Open-Meteo actually returns', () => {
    expect(conditionFromWmo(0)).toBe('clear');
    expect(conditionFromWmo(3)).toBe('cloudy');
    expect(conditionFromWmo(45)).toBe('fog');
    expect(conditionFromWmo(65)).toBe('heavyRain');
    expect(conditionFromWmo(67)).toBe('freezingRain');
    expect(conditionFromWmo(75)).toBe('heavySnow');
    expect(conditionFromWmo(95)).toBe('thunderstorms');
  });

  it('maps an unrecognised code to unknown, never to clear', () => {
    // Defaulting an unknown code to "clear" would silently suppress a warning.
    expect(conditionFromWmo(4242)).toBe('unknown');
    expect(conditionFromWmo(-1)).toBe('unknown');
  });
});

describe('condition severity', () => {
  it('ranks conditions', () => {
    expect(conditionSeverity('clear')).toBe(Severity.none);
    expect(conditionSeverity('drizzle')).toBe(Severity.low);
    expect(conditionSeverity('rain')).toBe(Severity.moderate);
    expect(conditionSeverity('heavySnow')).toBe(Severity.high);
  });
});

describe('snapshot severity reads the numbers, not just the label', () => {
  it('leaves calm clear weather alone', () => {
    expect(snapshotSeverity(snapshot())).toBe(Severity.none);
  });

  it('escalates on strong gusts under a clear sky', () => {
    expect(snapshotSeverity(snapshot({ windGust: 18 }))).toBe(Severity.moderate);
    expect(snapshotSeverity(snapshot({ windGust: 27 }))).toBe(Severity.high);
  });

  it('escalates on poor visibility', () => {
    expect(snapshotSeverity(snapshot({ visibility: 800 }))).toBe(Severity.moderate);
    expect(snapshotSeverity(snapshot({ visibility: 150 }))).toBe(Severity.high);
  });

  it('treats a freezing wet road as high severity whatever the label says', () => {
    // Light drizzle at 0 °C is black ice — far more dangerous than "drizzle".
    expect(conditionSeverity('drizzle')).toBe(Severity.low);
    expect(
      snapshotSeverity(snapshot({ condition: 'drizzle', temperature: 0, precipitationAmount: 0.2 })),
    ).toBe(Severity.high);
  });

  it('does not escalate sub-zero but dry', () => {
    expect(snapshotSeverity(snapshot({ temperature: -5 }))).toBe(Severity.none);
  });

  it('never drops below the conditionrating', () => {
    expect(snapshotSeverity(snapshot({ condition: 'heavySnow', windSpeed: 0, windGust: 0 }))).toBe(
      Severity.high,
    );
  });

  it('falls back to wind speed when no gust is reported', () => {
    expect(snapshotSeverity(snapshot({ windSpeed: 26, windGust: null }))).toBe(Severity.high);
  });
});

/** A provider that answers from a fixed map of longitude → condition. */
class StubProvider implements WeatherProvider {
  calls: { coordinate: Coordinate; date: number }[] = [];

  constructor(private conditionFor: (coordinate: Coordinate) => SkyCondition) {}

  async snapshot(coordinate: Coordinate, date: number): Promise<WeatherSnapshot> {
    this.calls.push({ coordinate, date });
    return snapshot({ coordinate, date, condition: this.conditionFor(coordinate) });
  }

  async hourly() {
    return [];
  }
}

describe('RouteWeatherService', () => {
  // ~110 km of route heading east along the equator.
  const coordinates = Array.from({ length: 101 }, (_, index) => ({
    latitude: 0,
    longitude: index * 0.01,
  }));
  const oneHour = 3_600;

  it('drops stretches with nothing worth reporting', async () => {
    const service = new RouteWeatherService(new StubProvider(() => 'clear'));
    const segments = await service.scan(coordinates, oneHour);

    expect(segments).toEqual([]);
  });

  it('merges a contiguous run of the same condition into one warning', async () => {
    // Rain across the middle third of the route.
    const service = new RouteWeatherService(
      new StubProvider((coordinate) =>
        coordinate.longitude > 0.3 && coordinate.longitude < 0.7 ? 'rain' : 'clear',
      ),
    );

    const segments = await service.scan(coordinates, oneHour);

    expect(segments).toHaveLength(1);
    expect(segments[0].snapshot.condition).toBe('rain');
  });

  it('reports separate fronts separately', async () => {
    const service = new RouteWeatherService(
      new StubProvider((coordinate) => {
        if (coordinate.longitude < 0.1) return 'rain';
        if (coordinate.longitude > 0.8) return 'heavySnow';
        return 'clear';
      }),
    );

    const segments = await service.scan(coordinates, oneHour);

    expect(segments.map((segment) => segment.snapshot.condition)).toEqual(['rain', 'heavySnow']);
  });

  it('forecasts each sample for when the car will arrive, not for now', async () => {
    // This is the whole point of the feature: the last sample on a one-hour
    // route must be forecast for roughly an hour from now.
    const provider = new StubProvider(() => 'clear');
    const service = new RouteWeatherService(provider);
    const departure = Date.now();

    await service.scan(coordinates, oneHour, departure);

    const last = provider.calls[provider.calls.length - 1];
    const hoursAhead = (last.date - departure) / 3_600_000;
    expect(hoursAhead).toBeGreaterThan(0.9);
    expect(hoursAhead).toBeLessThanOrEqual(1.01);
  });

  it('caps the number of samples on a very long route', async () => {
    const provider = new StubProvider(() => 'clear');
    const service = new RouteWeatherService(provider, { maxSamples: 10 });
    const long = Array.from({ length: 501 }, (_, index) => ({
      latitude: 0,
      longitude: index * 0.02,
    }));

    await service.scan(long, oneHour * 8);

    expect(provider.calls.length).toBeLessThanOrEqual(11);
  });

  it('survives a provider that fails on some cells', async () => {
    class FlakyProvider implements WeatherProvider {
      async snapshot(coordinate: Coordinate, date: number): Promise<WeatherSnapshot> {
        if (coordinate.longitude > 0.2 && coordinate.longitude < 0.4) {
          throw new Error('cell unavailable');
        }
        return snapshot({ coordinate, date, condition: 'heavyRain' });
      }
      async hourly() {
        return [];
      }
    }

    const service = new RouteWeatherService(new FlakyProvider());
    const segments = await service.scan(coordinates, oneHour);

    // The driver still gets warned about every stretch that did resolve.
    expect(segments.length).toBeGreaterThan(0);
  });

  it('returns nothing for a degenerate route', async () => {
    const service = new RouteWeatherService(new StubProvider(() => 'rain'));
    expect(await service.scan([{ latitude: 0, longitude: 0 }], oneHour)).toEqual([]);
  });
});
