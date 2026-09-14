import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Place } from '../core/routing/types';
import { IS_MAPBOX_CONFIGURED } from '../config';
import { planTrip, skyway, useSkyway } from '../state/store';
import { theme } from './components/theme';

export function SearchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const location = useSkyway((state) => state.location);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced as-you-type search. 300 ms is long enough that a fast typist
  // doesn't spend a geocoding request per keystroke.
  useEffect(() => {
    if (!visible) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        setResults(await skyway.routing.search(trimmed, location ?? undefined, controller.signal));
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') setError((caught as Error).message);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, visible, location]);

  const choose = (place: Place) => {
    onClose();
    setQuery('');
    setResults([]);
    void planTrip(place);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Where to?</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search an address or place"
          autoFocus
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={styles.input}
        />

        {!IS_MAPBOX_CONFIGURED && (
          <Text style={styles.warning}>
            No Mapbox token set. Add EXPO_PUBLIC_MAPBOX_TOKEN to your environment — see the README.
          </Text>
        )}

        {searching && <ActivityIndicator style={styles.spinner} />}
        {error && <Text style={styles.warning}>{error}</Text>}

        <FlatList
          data={results}
          keyExtractor={(place) => place.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable onPress={() => choose(item)} style={styles.result}>
              <Text style={styles.resultName}>{item.name}</Text>
              {item.subtitle && (
                <Text style={styles.resultSubtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              )}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 20, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700', color: theme.text },
  cancel: { fontSize: 16, color: theme.accent },
  input: {
    marginTop: 14,
    backgroundColor: 'rgba(107,114,128,0.12)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  spinner: { marginTop: 16 },
  warning: { marginTop: 14, fontSize: 13, color: theme.warning },
  result: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)' },
  resultName: { fontSize: 16, color: theme.text },
  resultSubtitle: { fontSize: 13, color: theme.subtle, marginTop: 2 },
});
