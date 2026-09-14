import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cumulativeDistances, sliceRoute } from '../core/geo';
import { INCIDENT_LABEL, isActive } from '../core/incidents/types';
import { SEVERITY_COLOR, Severity, snapshotSeverity } from '../core/weather/types';
import { selectedRoute, useSkyway } from '../state/store';
import { AlertBanner } from './components/AlertBanner';
import { GuidanceBar } from './components/GuidanceBar';
import { ManeuverCard } from './components/ManeuverCard';
import { MapControls } from './components/MapControls';
import { RoutePreview } from './components/RoutePreview';
import { SearchButton } from './components/SearchButton';
import { WeatherPill } from './components/WeatherPill';
import { ReportSheet } from './ReportSheet';
import { SearchSheet } from './SearchSheet';
import { WeatherSheet } from './WeatherSheet';

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);

  const location = useSkyway((state) => state.location);
  const heading = useSkyway((state) => state.heading);
  const tripState = useSkyway((state) => state.tripState);
  const incidents = useSkyway((state) => state.incidents);
  const activeAlert = useSkyway((state) => state.activeAlert);
  const routes = useSkyway((state) => state.routes);
  const selectedRouteId = useSkyway((state) => state.selectedRouteId);

  const [following, setFollowing] = useState(true);
  const [sheet, setSheet] = useState<'none' | 'search' | 'report' | 'weather'>('none');

  const route = useMemo(
    () => routes.find((candidate) => candidate.id === selectedRouteId) ?? routes[0] ?? null,
    [routes, selectedRouteId],
  );

  const navigating = tripState === 'navigating';

  // Camera follows the car while `following` is on. Throttled by the location
  // stream itself (1 Hz), which is as often as the camera needs to move.
  useEffect(() => {
    if (!following || !location || !mapRef.current) return;

    mapRef.current.animateCamera(
      {
        center: location,
        heading: heading ?? 0,
        pitch: navigating ? 55 : 0,
        altitude: navigating ? 600 : 3_000,
        zoom: navigating ? 17 : 14,
      },
      { duration: 800 },
    );
  }, [following, location, heading, navigating]);

  /**
   * The weather bands, as coloured overlays on top of the base route line.
   * Same 6 km window and same colours as the car screen, so the two views
   * agree at a glance.
   */
  const weatherBands = useMemo(() => {
    if (!route) return [];
    const cumulative = cumulativeDistances(route.coordinates);

    return route.weather
      .filter((segment) => snapshotSeverity(segment.snapshot) >= Severity.moderate)
      .map((segment) => ({
        id: segment.id,
        color: SEVERITY_COLOR[snapshotSeverity(segment.snapshot)],
        coordinates: sliceRoute(
          segment.distanceAlongRoute - 3_000,
          segment.distanceAlongRoute + 3_000,
          route.coordinates,
          cumulative,
        ),
      }))
      .filter((band) => band.coordinates.length >= 2);
  }, [route]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        onPanDrag={() => setFollowing(false)}
      >
        {route && (
          <Polyline
            coordinates={route.coordinates}
            strokeColor={SEVERITY_COLOR[Severity.none]}
            strokeWidth={7}
            lineCap="round"
          />
        )}

        {weatherBands.map((band) => (
          <Polyline
            key={band.id}
            coordinates={band.coordinates}
            strokeColor={band.color}
            strokeWidth={9}
            lineCap="round"
          />
        ))}

        {incidents.filter((incident) => isActive(incident)).map((incident) => (
          <Marker
            key={incident.id}
            coordinate={incident.coordinate}
            title={INCIDENT_LABEL[incident.kind]}
            pinColor="red"
          />
        ))}
      </MapView>

      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        {navigating ? <ManeuverCard /> : <WeatherPill onPress={() => setSheet('weather')} />}

        {activeAlert && <AlertBanner alert={activeAlert} />}

        <View style={styles.spacer} pointerEvents="none" />

        <MapControls
          following={following}
          navigating={navigating}
          onRecentre={() => setFollowing(true)}
          onWeather={() => setSheet('weather')}
        />

        {tripState === 'previewing' && <RoutePreview />}
        {navigating && <GuidanceBar onReport={() => setSheet('report')} />}
        {(tripState === 'idle' || tripState === 'arrived') && (
          <SearchButton onPress={() => setSheet('search')} />
        )}
      </View>

      <SearchSheet visible={sheet === 'search'} onClose={() => setSheet('none')} />
      <ReportSheet visible={sheet === 'report'} onClose={() => setSheet('none')} />
      <WeatherSheet visible={sheet === 'weather'} onClose={() => setSheet('none')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    gap: 12,
  },
  spacer: { flex: 1 },
});
