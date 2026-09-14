import AsyncStorage from '@react-native-async-storage/async-storage';
import { Coordinate, distance } from '../geo';
import { Incident, IncidentStore, isActive } from './types';

const STORAGE_KEY = 'skyway.incidents.v1';

/**
 * On-device store backed by AsyncStorage.
 *
 * Reports made here are visible only to this driver. That is a real
 * limitation — crowd-sourcing needs a crowd — but it keeps the report flow,
 * the alert engine and the CarPlay buttons fully exercisable without standing
 * up a backend first.
 */
export class LocalIncidentStore implements IncidentStore {
  private cache: Map<string, Incident> | null = null;

  private async load(): Promise<Map<string, Incident>> {
    if (this.cache) return this.cache;
    const map = new Map<string, Incident>();
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        for (const incident of JSON.parse(raw) as Incident[]) {
          map.set(incident.id, incident);
        }
      }
    } catch {
      // A corrupt or unreadable store is not worth failing a drive over;
      // start empty and let new reports repopulate it.
    }
    this.cache = map;
    return map;
  }

  private async persist(map: Map<string, Incident>): Promise<void> {
    const live = [...map.values()].filter((incident) => isActive(incident));
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(live));
    } catch {
      // Out of disk, or storage disabled. The in-memory copy still serves
      // this drive.
    }
  }

  async nearby(coordinate: Coordinate, radius: number): Promise<Incident[]> {
    const map = await this.load();
    return [...map.values()]
      .filter((incident) => isActive(incident) && distance(incident.coordinate, coordinate) <= radius)
      .sort((a, b) => b.reportedAt - a.reportedAt);
  }

  async report(incident: Incident): Promise<void> {
    const map = await this.load();
    map.set(incident.id, incident);
    await this.persist(map);
  }

  async vote(id: string, confirms: boolean): Promise<void> {
    const map = await this.load();
    const incident = map.get(id);
    if (!incident) return;
    if (confirms) incident.upvotes += 1;
    else incident.downvotes += 1;
    await this.persist(map);
  }
}

/**
 * HTTP-backed store. The endpoints are the obvious three; swap in whatever
 * your server speaks by editing this one class.
 */
export class RemoteIncidentStore implements IncidentStore {
  private local = new LocalIncidentStore();

  constructor(private baseUrl: string) {}

  async nearby(coordinate: Coordinate, radius: number): Promise<Incident[]> {
    const params = new URLSearchParams({
      lat: String(coordinate.latitude),
      lon: String(coordinate.longitude),
      radius: String(Math.round(radius)),
    });

    try {
      const response = await fetch(`${this.baseUrl}/incidents?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const fetched = (await response.json()) as Incident[];
      return fetched.filter((incident) => isActive(incident));
    } catch {
      // Tunnels, dead spots, a server having a bad day: fall back to what this
      // device already knows rather than showing the driver nothing.
      return this.local.nearby(coordinate, radius);
    }
  }

  async report(incident: Incident): Promise<void> {
    // Written locally first so the driver's own report shows immediately;
    // a failed push leaves the local copy in place.
    await this.local.report(incident);
    try {
      await fetch(`${this.baseUrl}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(incident),
      });
    } catch {
      // Queued locally; nothing more to do from here.
    }
  }

  async vote(id: string, confirms: boolean): Promise<void> {
    await this.local.vote(id, confirms);
    try {
      await fetch(`${this.baseUrl}/incidents/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirms }),
      });
    } catch {
      // As above.
    }
  }
}
