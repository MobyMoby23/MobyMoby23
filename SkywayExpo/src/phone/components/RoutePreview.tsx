import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDistance, formatDuration } from '../../core/alerts';
import { INCIDENT_LABEL } from '../../core/incidents/types';
import {
  CONDITION_LABEL,
  RouteWeatherSegment,
  SEVERITY_COLOR,
  Severity,
  snapshotSeverity,
} from '../../core/weather/types';
import type { Route } from '../../core/routing/types';
import { cancelTrip, selectRoute, startTrip, useSkyway } from '../../state/store';
import { theme } from './theme';

/**
 * Route choices, each showing what the weather will do to it.
 *
 * The weather line is the reason this screen exists: it is what lets a driver
 * knowingly take the four-minutes-slower route to miss a hail band.
 */
export function RoutePreview() {
  const routes = useSkyway((state) => state.routes);
  const selectedRouteId = useSkyway((state) => state.selectedRouteId);
  const chosen = routes.find((route) => route.id === selectedRouteId) ?? routes[0];

  if (!chosen) return null;

  return (
    <View style={styles.card}>
      <ScrollView style={styles.list} bounces={false}>
        {routes.map((route) => (
          <Pressable key={route.id} onPress={() => selectRoute(route.id)}>
            <RouteRow route={route} selected={route.id === chosen.id} />
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable onPress={cancelTrip} style={[styles.action, styles.cancel]}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => startTrip(chosen)} style={[styles.action, styles.go]}>
          <Text style={styles.goText}>Go</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RouteRow({ route, selected }: { route: Route; selected: boolean }) {
  const worst = worstWeather(route.weather);

  return (
    <View style={[styles.row, selected && styles.rowSelected]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>
          {formatDuration(route.duration)} · {formatDistance(route.distance)}
        </Text>

        {worst ? (
          <Text style={[styles.rowWeather, { color: SEVERITY_COLOR[snapshotSeverity(worst.snapshot)] }]}>
            {CONDITION_LABEL[worst.snapshot.condition]}
            {worst.placeName ? ` near ${worst.placeName}` : ''} ·{' '}
            {formatDistance(worst.distanceAlongRoute)} in
          </Text>
        ) : (
          <Text style={styles.rowClear}>
            {route.weather.length > 0 ? 'Clear conditions' : 'Checking weather…'}
          </Text>
        )}

        {route.incidents.length > 0 && (
          <Text style={styles.rowIncidents}>
            {[...new Set(route.incidents.map((incident) => INCIDENT_LABEL[incident.kind]))]
              .sort()
              .join(', ')}
          </Text>
        )}
      </View>

      <Text style={[styles.tick, selected && styles.tickOn]}>{selected ? '●' : '○'}</Text>
    </View>
  );
}

function worstWeather(segments: RouteWeatherSegment[]): RouteWeatherSegment | null {
  return segments.reduce<RouteWeatherSegment | null>((found, segment) => {
    if (snapshotSeverity(segment.snapshot) < Severity.moderate) return found;
    if (!found || snapshotSeverity(segment.snapshot) > snapshotSeverity(found.snapshot)) {
      return segment;
    }
    return found;
  }, null);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: 24,
    padding: 14,
    gap: 12,
    ...theme.shadow,
  },
  list: { maxHeight: 240 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(107,114,128,0.08)',
    marginBottom: 8,
  },
  rowSelected: { backgroundColor: 'rgba(10,132,255,0.12)' },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: theme.text },
  rowWeather: { fontSize: 13, fontWeight: '600' },
  rowClear: { fontSize: 13, color: theme.subtle },
  rowIncidents: { fontSize: 12, color: theme.warning, fontWeight: '600' },
  tick: { fontSize: 18, color: 'rgba(107,114,128,0.5)' },
  tickOn: { color: theme.accent },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  cancel: { backgroundColor: 'rgba(107,114,128,0.15)' },
  cancelText: { fontSize: 16, fontWeight: '600', color: theme.text },
  go: { backgroundColor: theme.accent },
  goText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
