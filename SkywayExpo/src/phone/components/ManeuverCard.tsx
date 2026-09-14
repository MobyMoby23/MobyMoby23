import { StyleSheet, Text, View } from 'react-native';

import { formatDistance } from '../../core/alerts';
import { useSkyway } from '../../state/store';
import { theme } from './theme';

/** Arrow glyphs, so the phone HUD needs no icon assets. */
const ARROW: Record<string, string> = {
  left: '↰',
  right: '↱',
  slightLeft: '↖',
  slightRight: '↗',
  sharpLeft: '↺',
  sharpRight: '↻',
  uTurn: '⤾',
  straight: '↑',
  none: '↑',
};

export function ManeuverCard() {
  const progress = useSkyway((state) => state.progress);
  const routes = useSkyway((state) => state.routes);
  const selectedRouteId = useSkyway((state) => state.selectedRouteId);

  const route = routes.find((candidate) => candidate.id === selectedRouteId) ?? routes[0];
  const step = route?.steps[progress.stepIndex];

  if (!step) return null;

  const glyph = step.type === 'arrive' ? '⚑' : step.type === 'roundabout' ? '↻' : ARROW[step.modifier];

  return (
    <View style={styles.card}>
      <Text style={styles.arrow}>{glyph}</Text>
      <View style={styles.text}>
        <Text style={styles.distance}>{formatDistance(progress.distanceToNextManeuver)}</Text>
        <Text style={styles.instruction} numberOfLines={2}>
          {step.instruction}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: theme.dark,
    borderRadius: 22,
    padding: 16,
    ...theme.shadow,
  },
  arrow: { fontSize: 40, color: '#fff', width: 52, textAlign: 'center' },
  text: { flex: 1 },
  distance: { fontSize: 30, fontWeight: '700', color: '#fff' },
  instruction: { fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
});
