import * as Haptics from 'expo-haptics';
import React, {useCallback, useMemo, useState} from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';

import {bytesToHex, hexToBytes} from '../../src/lib/codec.ts';
import {
  encodeMessage,
  externalRecord,
  textRecord,
  uriRecord,
  type NdefRecord,
} from '../../src/lib/ndef.ts';
import {describeError, isCancellation, writeRecords} from '../../src/lib/nfc.ts';
import {
  Banner,
  Button,
  Card,
  CopyRow,
  Field,
  Muted,
  Screen,
  Segmented,
} from '../../src/ui/components.tsx';
import {colors, spacing} from '../../src/ui/theme.ts';
import {useNfcStatus} from '../../src/ui/useNfcStatus.ts';

type RecordKind = 'text' | 'url' | 'raw';

const KINDS: {value: RecordKind; label: string}[] = [
  {value: 'text', label: 'Text'},
  {value: 'url', label: 'URL'},
  {value: 'raw', label: 'Raw hex'},
];

export default function WriteScreen() {
  const {status} = useNfcStatus();
  const [kind, setKind] = useState<RecordKind>('text');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('en');
  const [url, setUrl] = useState('https://');
  const [raw, setRaw] = useState('');
  const [externalType, setExternalType] = useState('com.rfidtool:payload');
  const [lockAfterWrite, setLockAfterWrite] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Rebuild the message on every keystroke so the byte count stays honest.
  const built = useMemo((): {records: NdefRecord[]; hex: string; size: number} | {error: string} => {
    try {
      let records: NdefRecord[];
      switch (kind) {
        case 'text':
          if (!text) return {error: 'Enter some text to write.'};
          records = [textRecord(text, language.trim() || 'en')];
          break;
        case 'url':
          if (!url || url === 'https://') return {error: 'Enter a URL to write.'};
          records = [uriRecord(url.trim())];
          break;
        case 'raw':
          if (!raw.trim()) return {error: 'Enter the payload bytes as hex.'};
          records = [externalRecord(externalType.trim() || 'com.rfidtool:payload', hexToBytes(raw))];
          break;
      }
      const bytes = encodeMessage(records);
      return {records, hex: bytesToHex(bytes, {separator: 'space'}), size: bytes.length};
    } catch (caught) {
      return {error: describeError(caught)};
    }
  }, [kind, text, language, url, raw, externalType]);

  const buildError = 'error' in built ? built.error : null;

  const write = useCallback(async () => {
    if ('error' in built) return;
    setWriting(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await writeRecords(built.records, {makeReadOnly: lockAfterWrite});
      setResult(
        `${outcome.bytesWritten} bytes written${outcome.uid ? ` to ${outcome.uid}` : ''}${
          outcome.simulated ? ' (simulated — no tag was touched)' : ''
        }${lockAfterWrite && !outcome.simulated ? ' and locked read-only' : ''}.`,
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      if (!isCancellation(caught)) {
        setError(describeError(caught));
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setWriting(false);
    }
  }, [built, lockAfterWrite]);

  return (
    <Screen>
      {status ? (
        <Banner tone={status.availability === 'ready' ? 'info' : 'warning'}>
          {status.message}
        </Banner>
      ) : null}

      <Card title="Record type">
        <Segmented options={KINDS} value={kind} onChange={setKind} />

        {kind === 'text' ? (
          <>
            <Field
              label="TEXT"
              value={text}
              onChangeText={setText}
              placeholder="What the tag should say"
              multiline
              autoCapitalize="none"
            />
            <Field
              label="LANGUAGE CODE"
              value={language}
              onChangeText={setLanguage}
              placeholder="en"
            />
          </>
        ) : null}

        {kind === 'url' ? (
          <Field
            label="URL"
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com"
            keyboardType="url"
          />
        ) : null}

        {kind === 'raw' ? (
          <>
            <Field
              label="EXTERNAL TYPE"
              value={externalType}
              onChangeText={setExternalType}
              placeholder="com.example:payload"
            />
            <Field
              label="PAYLOAD (HEX)"
              value={raw}
              onChangeText={setRaw}
              placeholder="04 A2 24 1B"
              multiline
              monospace
              autoCapitalize="characters"
            />
            <Muted>
              Core NFC writes NDEF messages, so arbitrary bytes travel inside an external-type
              record rather than straight into a tag block.
            </Muted>
          </>
        ) : null}
      </Card>

      <Card title="Message preview">
        {'error' in built ? (
          <Muted>{buildError}</Muted>
        ) : (
          <CopyRow label="NDEF MESSAGE" value={built.hex} hint={`${built.size} bytes on the tag`} />
        )}
      </Card>

      <Card title="Options">
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Lock tag after writing</Text>
            <Muted>Makes the tag permanently read-only. This cannot be undone.</Muted>
          </View>
          <Switch
            value={lockAfterWrite}
            onValueChange={setLockAfterWrite}
            trackColor={{true: colors.accentDim, false: colors.border}}
            thumbColor={lockAfterWrite ? colors.accent : colors.textMuted}
          />
        </View>
        {lockAfterWrite ? (
          <Banner tone="warning">
            Locking is irreversible — the tag can never be rewritten afterwards.
          </Banner>
        ) : null}
      </Card>

      <Button
        label={writing ? 'Hold near tag…' : 'Write to tag'}
        icon="create"
        onPress={write}
        busy={writing}
        disabled={'error' in built}
      />

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {result ? <Banner tone="success">{result}</Banner> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  switchText: {flex: 1, gap: 2},
  switchLabel: {color: colors.text, fontSize: 15, fontWeight: '500'},
});
