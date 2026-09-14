import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDistance } from '../core/alerts';
import {
  CONDITION_LABEL,
  SEVERITY_COLOR,
  Severity,
  snapshotSeverity,
} from '../core/weather/types';
import { useSkyway } from '../state/store';
import { theme } from './components/theme';

/** The full picture: here, along the route, and on arrival. */
export function WeatherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const current = useSkyway((state) => state.currentWeather);
  const forecast = useSkyway((state) => state.destinationForecast);
  const destination = useSkyway((state) => state.destination);
  const routes = useSkyway((state) => state.routes);
  const selectedRouteId = useSkyway((state) => state.selectedRouteId);

  const route = routes.find((candidate) => candidate.id === selectedRouteId) ?? routes[0];
  const notable = (route?.weather ?? []).filter(
    (segment) => snapshotSeverity(segment.snapshot) >= Severity.moderate,
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Weather</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {current && (
            <Section title="Here now">
              <View style={styles.currentRow}>
                <Text style={styles.temperature}>{Math.round(current.temperature)}°</Text>
                <View style={styles.currentDetail}>
                  <Text style={styles.condition}>{CONDITION_LABEL[current.condition]}</Text>
                  <Text style={styles.meta}>
                    Wind {Math.round(current.windSpeed * 3.6)} km/h
                    {current.visibility !== null && current.visibility < 5_000
                      ? ` · visibility ${Math.round(current.visibility)} m`
                      : ''}
                  </Text>
                </View>
              </View>
            </Section>
          )}

          {route && (
            <Section title="On your route">
              {notable.length === 0 ? (
                <Text style={styles.clear}>
                  {route.weather.length > 0 ? 'Clear all the way.' : 'Checking…'}
                </Text>
              ) : (
                notable.map((segment) => (
                  <View key={segment.id} style={styles.routeRow}>
                    <View
                      style={[
                        styles.severityDot,
                        { backgroundColor: SEVERITY_COLOR[snapshotSeverity(segment.snapshot)] },
                      ]}
                    />
                    <View style={styles.routeText}>
                      <Text style={styles.condition}>
                        {CONDITION_LABEL[segment.snapshot.condition]}
                      </Text>
                      <Text style={styles.meta}>
                        {segment.placeName ? `${segment.placeName} · ` : ''}
                        {formatDistance(segment.distanceAlongRoute)} in · around{' '}
                        {new Date(segment.arrivalTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <Text style={styles.meta}>{Math.round(segment.snapshot.temperature)}°</Text>
                  </View>
                ))
              )}
            </Section>
          )}

          {forecast.length > 0 && (
            <Section title={`At ${destination?.name ?? 'your destination'}`}>
              {forecast.slice(0, 8).map((hour) => (
                <View key={hour.date} style={styles.hourRow}>
                  <Text style={styles.hour}>
                    {new Date(hour.date).toLocaleTimeString([], { hour: '2-digit' })}
                  </Text>
                  <Text style={[styles.meta, styles.hourCondition]}>
                    {CONDITION_LABEL[hour.condition]}
                  </Text>
                  {hour.precipitationChance > 0.1 && (
                    <Text style={styles.chance}>{Math.round(hour.precipitationChance * 100)}%</Text>
                  )}
                  <Text style={styles.hourTemp}>{Math.round(hour.temperature)}°</Text>
                </View>
              ))}
            </Section>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 20, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700', color: theme.text },
  done: { fontSize: 16, color: theme.accent },
  body: { paddingVertical: 16, gap: 22 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: theme.subtle, letterSpacing: 0.6 },
  sectionBody: { backgroundColor: 'rgba(107,114,128,0.08)', borderRadius: 16, padding: 14, gap: 12 },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  temperature: { fontSize: 40, fontWeight: '700', color: theme.text },
  currentDetail: { flex: 1 },
  condition: { fontSize: 16, fontWeight: '600', color: theme.text },
  meta: { fontSize: 13, color: theme.subtle },
  clear: { fontSize: 14, color: theme.subtle },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  severityDot: { width: 12, height: 12, borderRadius: 6 },
  routeText: { flex: 1 },
  hourRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hour: { fontSize: 14, fontWeight: '600', color: theme.text, width: 64 },
  hourCondition: { flex: 1 },
  chance: { fontSize: 12, color: theme.accent, fontWeight: '600' },
  hourTemp: { fontSize: 14, fontWeight: '600', color: theme.text, width: 40, textAlign: 'right' },
});
