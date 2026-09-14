import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DriverAlert } from '../../core/alerts';
import { dismissAlert, voteOnIncident } from '../../state/store';
import { theme } from './theme';

/**
 * The phone's version of the hazard/weather warning. A hazard gets the
 * "Still there?" vote; weather does not — the crowd does not get to vote on
 * the sky.
 */
export function AlertBanner({ alert }: { alert: DriverAlert }) {
  return (
    <View style={styles.banner}>
      <View style={[styles.dot, { backgroundColor: alert.color }]} />
      <View style={styles.text}>
        <Text style={styles.title}>{alert.title}</Text>
        <Text style={styles.subtitle}>{alert.subtitle}</Text>
      </View>

      {alert.incident ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              void voteOnIncident(alert.incident!.id, true);
              dismissAlert();
            }}
            style={[styles.action, { backgroundColor: 'rgba(10,132,255,0.14)' }]}
          >
            <Text style={[styles.actionText, { color: theme.accent }]}>Still there</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void voteOnIncident(alert.incident!.id, false);
              dismissAlert();
            }}
            style={[styles.action, { backgroundColor: 'rgba(255,59,48,0.12)' }]}
          >
            <Text style={[styles.actionText, { color: theme.danger }]}>Gone</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={dismissAlert} style={styles.action}>
          <Text style={[styles.actionText, { color: theme.subtle }]}>Dismiss</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    padding: 14,
    ...theme.shadow,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  text: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: theme.text },
  subtitle: { fontSize: 13, color: theme.subtle, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  actionText: { fontSize: 13, fontWeight: '600' },
});
