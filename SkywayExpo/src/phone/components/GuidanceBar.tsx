import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDistance, formatDuration } from '../../core/alerts';
import { cancelTrip, useSkyway } from '../../state/store';
import { theme } from './theme';

/** ETA plus the two things a driver actually reaches for: report, and end. */
export function GuidanceBar({ onReport }: { onReport: () => void }) {
  const progress = useSkyway((state) => state.progress);
  const arrival = new Date(Date.now() + progress.timeRemaining * 1000);

  return (
    <View style={styles.bar}>
      <View style={styles.text}>
        <Text style={styles.arrival}>
          {arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Text style={styles.detail}>
          {formatDuration(progress.timeRemaining)} · {formatDistance(progress.distanceRemaining)}
        </Text>
      </View>

      <Pressable onPress={onReport} style={[styles.button, styles.report]}>
        <Text style={styles.reportGlyph}>!</Text>
      </Pressable>

      <Pressable onPress={cancelTrip} style={[styles.button, styles.end]}>
        <Text style={styles.endGlyph}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
    ...theme.shadow,
  },
  text: { flex: 1 },
  arrival: { fontSize: 20, fontWeight: '700', color: theme.text },
  detail: { fontSize: 13, color: theme.subtle, marginTop: 1 },
  button: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  report: { backgroundColor: 'rgba(255,159,10,0.18)' },
  reportGlyph: { fontSize: 22, fontWeight: '800', color: theme.warning },
  end: { backgroundColor: 'rgba(255,59,48,0.14)' },
  endGlyph: { fontSize: 18, fontWeight: '700', color: theme.danger },
});
