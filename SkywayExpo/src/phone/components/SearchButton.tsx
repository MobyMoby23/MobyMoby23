import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from './theme';

export function SearchButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={styles.glyph}>⌕</Text>
      <Text style={styles.label}>Where to?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    paddingHorizontal: 18,
    paddingVertical: 16,
    ...theme.shadow,
  },
  glyph: { fontSize: 20, color: theme.subtle },
  label: { fontSize: 16, fontWeight: '500', color: theme.text },
});
