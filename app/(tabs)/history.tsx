import {Ionicons} from '@expo/vector-icons';
import {useFocusEffect, useRouter} from 'expo-router';
import React, {useCallback, useState} from 'react';
import {Alert, Pressable, StyleSheet, Text, View} from 'react-native';

import {hexToBytes, bytesToHex} from '../../src/lib/codec.ts';
import {
  clearHistory,
  loadHistory,
  removeFromHistory,
  type HistoryEntry,
} from '../../src/lib/history.ts';
import {Button, Card, EmptyState, Muted, Screen} from '../../src/ui/components.tsx';
import {colors, mono, radius, spacing} from '../../src/ui/theme.ts';

export default function HistoryScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  // Refresh on focus so a scan taken on the Read tab shows up immediately.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadHistory().then((loaded) => {
        if (!cancelled) setEntries(loaded);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const confirmClear = useCallback(() => {
    Alert.alert('Clear history?', 'All saved scans will be deleted from this iPhone.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setEntries([]);
        },
      },
    ]);
  }, []);

  if (entries.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="time-outline"
          title="Nothing scanned yet"
          body="Tags you read are saved here automatically, on this device only."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {entries.map((entry) => (
        <Card key={entry.id}>
          <View style={styles.header}>
            <Text style={styles.uid} selectable>
              {entry.uid || 'Unknown UID'}
            </Text>
            {entry.simulated ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>DEMO</Text>
              </View>
            ) : null}
          </View>

          <Muted>
            {new Date(entry.scannedAt).toLocaleString()} · {entry.techTypes.join(', ') || 'unknown tech'}
            {entry.maxSize != null ? ` · ${entry.maxSize} B capacity` : ''}
          </Muted>

          {entry.records.length > 0 ? (
            <View style={styles.records}>
              {entry.records.map((record, index) => (
                <Text key={index} style={styles.record} numberOfLines={2}>
                  <Text style={styles.recordType}>{record.typeLabel} </Text>
                  {record.value}
                </Text>
              ))}
            </View>
          ) : (
            <Muted>No NDEF content.</Muted>
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              style={styles.action}
              onPress={() =>
                router.push({
                  pathname: '/convert',
                  params: {value: bytesToHex(hexToBytes(entry.uid)), format: 'hex'},
                })
              }>
              <Ionicons name="swap-horizontal-outline" size={16} color={colors.accent} />
              <Text style={styles.actionLabel}>Convert UID</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.action}
              onPress={async () => setEntries(await removeFromHistory(entry.id))}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={[styles.actionLabel, {color: colors.danger}]}>Delete</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      <Button label="Clear all history" icon="trash-outline" variant="danger" onPress={confirmClear} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  uid: {flex: 1, color: colors.text, fontSize: 16, fontFamily: mono},
  badge: {
    backgroundColor: colors.warningDim,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: {color: colors.warning, fontSize: 10, fontWeight: '700', letterSpacing: 0.8},
  records: {gap: spacing.xs},
  record: {color: colors.text, fontSize: 13, lineHeight: 18},
  recordType: {color: colors.accent, fontWeight: '700'},
  actions: {flexDirection: 'row', gap: spacing.lg},
  action: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs},
  actionLabel: {color: colors.accent, fontSize: 14, fontWeight: '600'},
});
