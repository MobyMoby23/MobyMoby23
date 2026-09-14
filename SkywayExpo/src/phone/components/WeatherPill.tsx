import { Pressable, StyleSheet, Text } from 'react-native';

import { CONDITION_LABEL } from '../../core/weather/types';
import { useSkyway } from '../../state/store';
import { theme } from './theme';

export function WeatherPill({ onPress }: { onPress: () => void }) {
  const weather = useSkyway((state) => state.currentWeather);
  const carPlayConnected = useSkyway((state) => state.carPlayConnected);

  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text style={styles.pill}>
        {weather
          ? `${Math.round(weather.temperature)}° · ${CONDITION_LABEL[weather.condition]}`
          : 'Weather…'}
      </Text>
      {carPlayConnected && <Text style={[styles.pill, styles.car]}>In car</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignSelf: 'flex-start' },
  pill: {
    backgroundColor: theme.card,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    fontWeight: '600',
    color: theme.text,
    overflow: 'hidden',
    ...theme.shadow,
  },
  car: { color: theme.accent },
});
