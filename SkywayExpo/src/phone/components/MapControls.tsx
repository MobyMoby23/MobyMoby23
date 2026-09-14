import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from './theme';

export function MapControls({
  following,
  navigating,
  onRecentre,
  onWeather,
}: {
  following: boolean;
  navigating: boolean;
  onRecentre: () => void;
  onWeather: () => void;
}) {
  return (
    <View style={styles.column}>
      {navigating && (
        <Pressable onPress={onWeather} style={styles.button}>
          <Text style={styles.glyph}>☁</Text>
        </Pressable>
      )}
      <Pressable onPress={onRecentre} style={styles.button}>
        <Text style={[styles.glyph, following && styles.active]}>◎</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignSelf: 'flex-end', gap: 10 },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadow,
  },
  glyph: { fontSize: 19, color: theme.subtle },
  active: { color: theme.accent },
});
