import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Game from './src/Game';
import Squishy, { SQUISHIES, squishyById } from './src/Squishy';
import { loadSaved, savePick } from './src/storage';

function BouncySquishy({ kind, size, active }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      t.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 420, easing: Easing.bounce, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [active, t]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.35] });
  const scaleY = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 0.8, 1.12] });
  const scaleX = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 1.2, 0.9] });
  return (
    <Animated.View style={{ transformOrigin: 'bottom', transform: [{ translateY }, { scaleX }, { scaleY }] }}>
      <Squishy kind={kind} size={size} />
    </Animated.View>
  );
}

function Menu({ pick, setPick, best, onPlay }) {
  const { width: W, height: H } = useWindowDimensions();
  const s = Math.min(W, H) / 400;
  const size = 50 * s;
  return (
    <View style={[styles.menu, { backgroundColor: '#FFE8F3' }]}>
      <ScrollView contentContainerStyle={[styles.menuInner, { padding: 20 * s }]}>
        <Text style={[styles.logo, { fontSize: 40 * s }]}>Squishy Jump</Text>
        <Text style={[styles.sub, { fontSize: 15 * s }]}>Pick your squishy · Best {best}</Text>
        <View style={[styles.grid, { gap: 14 * s, marginTop: 18 * s }]}>
          {SQUISHIES.map((sq) => {
            const active = sq.id === pick;
            return (
              <Pressable
                key={sq.id}
                onPress={() => setPick(sq.id)}
                style={[
                  styles.tile,
                  { width: 104 * s, paddingTop: 30 * s, paddingBottom: 10 * s },
                  active && styles.tileActive,
                ]}
              >
                <BouncySquishy kind={sq.id} size={size} active={active} />
                <Text style={[styles.tileName, { fontSize: 12 * s }]} numberOfLines={1}>
                  {sq.name.split(' ')[0]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={onPlay}
          style={({ pressed }) => [styles.play, { marginTop: 20 * s, paddingHorizontal: 40 * s, paddingVertical: 14 * s }, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <Text style={[styles.playText, { fontSize: 22 * s }]}>Play as {squishyById(pick).name.split(' ')[0]}!</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState('menu');
  const [pick, setPickState] = useState(SQUISHIES[0].id);
  const [best, setBest] = useState(0);

  useEffect(() => {
    loadSaved().then(({ best: b, pick: p }) => {
      setBest(b);
      if (p && SQUISHIES.some((sq) => sq.id === p)) setPickState(p);
    });
  }, []);

  const setPick = (id) => {
    setPickState(id);
    savePick(id);
  };
  const onBest = useCallback((n) => setBest(n), []);

  return (
    <View style={styles.app}>
      <StatusBar hidden />
      {screen === 'menu' ? (
        <Menu pick={pick} setPick={setPick} best={best} onPlay={() => setScreen('game')} />
      ) : (
        <Game kind={pick} best={best} onBest={onBest} onHome={() => setScreen('menu')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#BFE6FF' },
  menu: { flex: 1 },
  menuInner: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { fontWeight: '900', color: '#FF5E9E', letterSpacing: 1 },
  sub: { color: '#8A6A9A', fontWeight: '700', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  tile: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, borderWidth: 3, borderColor: 'transparent' },
  tileActive: { borderColor: '#FF7EB6', backgroundColor: '#FFF6FA' },
  tileName: { marginTop: 8, fontWeight: '800', color: '#5B3A6B' },
  play: { backgroundColor: '#FF7EB6', borderRadius: 999 },
  playText: { color: '#fff', fontWeight: '900' },
});
