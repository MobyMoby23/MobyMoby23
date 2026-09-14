import * as Location from 'expo-location';
import { onLocationUpdate } from './state/store';

let subscription: Location.LocationSubscription | null = null;
let backgroundRequested = false;

export type LocationPermission = 'granted' | 'foreground' | 'denied';

/**
 * Asks for location permission.
 *
 * Foreground is requested first and always; background is a separate,
 * second prompt that iOS only allows once foreground is granted. Guidance
 * works either way — background is what keeps it alive when the phone locks
 * in a cradle while CarPlay drives the display.
 */
export async function requestPermissions(): Promise<LocationPermission> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';

  if (!backgroundRequested) {
    backgroundRequested = true;
    try {
      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.granted) return 'granted';
    } catch {
      // Not fatal — the app degrades to foreground-only guidance.
    }
  }
  return 'foreground';
}

/**
 * Starts the location stream that drives everything else: the map camera,
 * route progress, the alert engine and the CarPlay follow camera.
 */
export async function startTracking(): Promise<void> {
  if (subscription) return;

  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      // Time-based rather than distance-based: progress and alerts need
      // updates while stationary in traffic too.
      timeInterval: 1_000,
      distanceInterval: 0,
    },
    (position) => {
      onLocationUpdate(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        // `heading` is compass bearing and is noisy when stationary; `course`
        // is direction of travel and is what the map camera wants.
        position.coords.heading ?? null,
        position.coords.speed ?? 0,
      );
    },
  );
}

export async function stopTracking(): Promise<void> {
  subscription?.remove();
  subscription = null;
}
