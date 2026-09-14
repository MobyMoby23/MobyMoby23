import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { INCIDENT_KINDS, INCIDENT_LABEL } from '../core/incidents/types';
import { reportIncident } from '../state/store';
import { voice } from '../voice';
import { theme } from './components/theme';

/** Glyphs rather than icon assets, so nothing needs bundling. */
const GLYPH: Record<string, string> = {
  police: '🛡',
  crash: '💥',
  hazard: '⚠',
  heavyTraffic: '🚗',
  roadClosed: '⛔',
  objectOnRoad: '📦',
  flooding: '🌊',
  ice: '❄',
};

/** One tap per hazard, big targets, no confirmation step. */
export function ReportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const report = async (kind: (typeof INCIDENT_KINDS)[number]) => {
    onClose();
    const incident = await reportIncident(kind);
    if (incident) voice.speak(`${INCIDENT_LABEL[kind]} reported. Thanks.`);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Report</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>

        <View style={styles.grid}>
          {INCIDENT_KINDS.map((kind) => (
            <Pressable key={kind} onPress={() => void report(kind)} style={styles.tile}>
              <Text style={styles.glyph}>{GLYPH[kind]}</Text>
              <Text style={styles.label}>{INCIDENT_LABEL[kind]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 20, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700', color: theme.text },
  cancel: { fontSize: 16, color: theme.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 20 },
  tile: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(107,114,128,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  glyph: { fontSize: 30 },
  label: { fontSize: 12, fontWeight: '600', color: theme.text, textAlign: 'center' },
});
