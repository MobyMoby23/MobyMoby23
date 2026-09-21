import {Ionicons} from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {useRouter} from 'expo-router';
import React, {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {bytesToDecimal, bytesToHex, hexToBytes, reverseBytes} from '../../src/lib/codec.ts';
import {addToHistory} from '../../src/lib/history.ts';
import {describeError, isCancellation, readTag, type TagData} from '../../src/lib/nfc.ts';
import {
  Banner,
  Button,
  Card,
  CopyRow,
  EmptyState,
  Muted,
  Screen,
} from '../../src/ui/components.tsx';
import {colors, mono, radius, spacing} from '../../src/ui/theme.ts';
import {useNfcStatus} from '../../src/ui/useNfcStatus.ts';

export default function ReadScreen() {
  const router = useRouter();
  const {status} = useNfcStatus();
  const [tag, setTag] = useState<TagData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await readTag();
      setTag(result);
      await addToHistory(result);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      if (!isCancellation(caught)) {
        setError(describeError(caught));
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setScanning(false);
    }
  }, []);

  const uidBytes = tag ? hexToBytes(tag.uid) : null;

  return (
    <Screen>
      {status ? (
        <Banner tone={status.availability === 'ready' ? 'info' : 'warning'}>
          {status.message}
        </Banner>
      ) : null}

      <Button
        label={scanning ? 'Hold near tag…' : 'Scan a tag'}
        icon="scan"
        onPress={scan}
        busy={scanning}
      />

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {!tag && !scanning ? (
        <EmptyState
          icon="radio-outline"
          title="No tag read yet"
          body="Tap Scan, then hold the top edge of your iPhone against the tag until it beeps."
        />
      ) : null}

      {tag && uidBytes ? (
        <>
          <Card title="Identifier" subtitle={tag.simulated ? 'Simulated tag (demo mode)' : undefined}>
            <CopyRow label="UID" value={tag.uid} hint={`${uidBytes.length} bytes`} />
            <CopyRow label="UID (no spacing)" value={bytesToHex(uidBytes)} />
            <CopyRow
              label="UID reversed (LSB)"
              value={bytesToHex(reverseBytes(uidBytes), {separator: 'space'})}
              hint="Some readers report the byte order flipped"
            />
            <CopyRow label="UID as decimal" value={bytesToDecimal(uidBytes)} />
          </Card>

          <Card title="Tag">
            <CopyRow label="Technologies" value={tag.techTypes.join(', ') || 'Unknown'} />
            <CopyRow
              label="NDEF capacity"
              value={tag.maxSize != null ? `${tag.maxSize} bytes` : 'Not reported'}
            />
            <CopyRow
              label="Writable"
              value={tag.isWritable == null ? 'Not reported' : tag.isWritable ? 'Yes' : 'No — locked'}
            />
          </Card>

          <Card
            title="NDEF content"
            subtitle={
              tag.records.length === 0
                ? 'This tag holds no NDEF message — it is blank or formatted only.'
                : `${tag.records.length} record${tag.records.length === 1 ? '' : 's'}`
            }>
            {tag.records.map((record, index) => (
              <View key={index} style={styles.record}>
                <View style={styles.recordHeader}>
                  <Ionicons
                    name={
                      record.kind === 'uri'
                        ? 'link-outline'
                        : record.kind === 'text'
                          ? 'text-outline'
                          : 'document-outline'
                    }
                    size={15}
                    color={colors.accent}
                  />
                  <Text style={styles.recordType}>{record.typeLabel}</Text>
                  {record.language ? <Muted>{record.language}</Muted> : null}
                  <View style={styles.spacer} />
                  <Muted>{record.byteLength} B</Muted>
                </View>
                <Text style={styles.recordValue} selectable>
                  {record.value}
                </Text>
              </View>
            ))}
            {tag.ndefHex ? (
              <CopyRow label="Raw message" value={tag.ndefHex} hint="Full NDEF message in hex" />
            ) : null}
          </Card>

          <Button
            label="Open UID in Convert"
            icon="swap-horizontal-outline"
            variant="secondary"
            onPress={() =>
              router.push({pathname: '/convert', params: {value: bytesToHex(uidBytes), format: 'hex'}})
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  record: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  recordHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  recordType: {color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.4},
  recordValue: {color: colors.text, fontSize: 14, fontFamily: mono, lineHeight: 20},
  spacer: {flex: 1},
});
