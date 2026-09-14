import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { carPlay } from './src/carplay/controller';
import { requestPermissions, startTracking, stopTracking } from './src/location';
import { MapScreen } from './src/phone/MapScreen';
import { addSkywayListener, selectedRoute, useSkyway } from './src/state/store';
import { voice } from './src/voice';

/**
 * Wires the app's three long-lived concerns together, once, at launch:
 * location, voice, and the car screen.
 *
 * The CarPlay controller is installed here rather than in a screen because the
 * car can connect while no screen is mounted — the phone app may never have
 * been opened.
 */
export default function App() {
  useEffect(() => {
    carPlay.install();

    const unsubscribe = addSkywayListener({
      onAlert: (alert) => voice.announceAlert(alert),
      onArrived: (destination) => voice.announceArrival(destination.name),
      onRouteChanged: () => voice.reset(),
      onStepChanged: (stepIndex) => {
        const route = selectedRoute();
        const step = route?.steps[stepIndex];
        if (!step) return;
        const { progress, speed } = useSkyway.getState();
        voice.announceStep(step, stepIndex, progress.distanceToNextManeuver, speed);
      },
    });

    void (async () => {
      const permission = await requestPermissions();
      if (permission !== 'denied') await startTracking();
    })();

    return () => {
      unsubscribe();
      carPlay.uninstall();
      void stopTracking();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <MapScreen />
    </SafeAreaProvider>
  );
}
