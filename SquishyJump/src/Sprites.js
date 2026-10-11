import { View } from 'react-native';

const abs = { position: 'absolute' };

export function Cactus({ w, h }) {
  const green = '#6CCB77';
  const trunk = w * 0.46;
  const tx = (w - trunk) / 2;
  const a = w * 0.2; // arm thickness
  return (
    <View style={{ width: w, height: h }}>
      {/* left arm: elbow out from the trunk, then up */}
      <View style={[abs, { left: a / 2, top: h * 0.55, width: tx, height: a, backgroundColor: green }]} />
      <View style={[abs, { left: 0, top: h * 0.32, width: a, height: h * 0.23 + a, borderRadius: a / 2, backgroundColor: green }]} />
      {/* right arm, a bit higher */}
      <View style={[abs, { right: a / 2, top: h * 0.42, width: tx, height: a, backgroundColor: green }]} />
      <View style={[abs, { right: 0, top: h * 0.2, width: a, height: h * 0.22 + a, borderRadius: a / 2, backgroundColor: green }]} />
      <View
        style={[abs, {
          left: tx, top: 0, width: trunk, height: h,
          borderTopLeftRadius: trunk / 2, borderTopRightRadius: trunk / 2,
          backgroundColor: green,
        }]}
      />
      <View style={[abs, { left: tx + trunk * 0.18, top: trunk * 0.3, width: trunk * 0.18, height: h * 0.6, borderRadius: trunk, backgroundColor: 'rgba(255,255,255,0.3)' }]} />
      {[0.22, 0.42, 0.62, 0.82].map((p, i) => (
        <View
          key={i}
          style={[abs, {
            left: w / 2 + (i % 2 ? 2 : -5), top: h * p, width: 3, height: 3,
            borderRadius: 2, backgroundColor: '#E9FFE6',
          }]}
        />
      ))}
      {/* a little flower on top */}
      <View style={[abs, { left: w / 2 - 5, top: -6, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF8FB8' }]} />
    </View>
  );
}

export function Bee({ w, h, flap }) {
  return (
    <View style={{ width: w, height: h }}>
      <View
        style={[abs, {
          left: w * 0.3, top: -h * (flap ? 0.45 : 0.3), width: w * 0.36, height: h * 0.6,
          borderRadius: w, backgroundColor: 'rgba(220,240,255,0.9)', borderWidth: 1, borderColor: '#BBD7EE',
        }]}
      />
      <View style={[abs, { left: 0, top: 0, width: w, height: h, borderRadius: h / 2, backgroundColor: '#FFD84D', overflow: 'hidden' }]}>
        <View style={[abs, { left: w * 0.38, top: 0, width: w * 0.12, height: h, backgroundColor: '#3A2E2E' }]} />
        <View style={[abs, { left: w * 0.62, top: 0, width: w * 0.12, height: h, backgroundColor: '#3A2E2E' }]} />
      </View>
      {/* bees fly left, toward the player */}
      <View style={[abs, { left: w * 0.14, top: h * 0.28, width: h * 0.2, height: h * 0.2, borderRadius: h, backgroundColor: '#2B2230' }]} />
      <View style={[abs, { left: w * 0.08, top: h * 0.55, width: h * 0.18, height: h * 0.1, borderRadius: h, backgroundColor: 'rgba(255,110,150,0.6)' }]} />
      <View style={[abs, { right: -h * 0.12, top: h * 0.42, width: h * 0.2, height: h * 0.14, borderRadius: 2, backgroundColor: '#3A2E2E' }]} />
    </View>
  );
}

const CANDY_COLORS = ['#FF7EB6', '#7EC8FF', '#FFD84D', '#B98BFF', '#7EE0A1'];

export function Candy({ r, colorIndex = 0 }) {
  const color = CANDY_COLORS[colorIndex % CANDY_COLORS.length];
  return (
    <View style={{ width: r * 2, height: r * 2, alignItems: 'center', justifyContent: 'center' }}>
      {/* wrapper twists */}
      <View style={[abs, { left: -r * 0.55, width: r * 0.8, height: r * 0.9, borderRadius: r * 0.2, backgroundColor: color, opacity: 0.75, transform: [{ rotate: '45deg' }] }]} />
      <View style={[abs, { right: -r * 0.55, width: r * 0.8, height: r * 0.9, borderRadius: r * 0.2, backgroundColor: color, opacity: 0.75, transform: [{ rotate: '45deg' }] }]} />
      <View style={{ width: r * 2, height: r * 2, borderRadius: r, backgroundColor: color, borderWidth: 2, borderColor: '#fff' }} />
      <View style={[abs, { left: r * 0.5, top: r * 0.4, width: r * 0.55, height: r * 0.35, borderRadius: r, backgroundColor: 'rgba(255,255,255,0.75)' }]} />
    </View>
  );
}

export function Cloud({ size }) {
  return (
    <View style={{ width: size * 2, height: size }}>
      <View style={[abs, { left: 0, bottom: 0, width: size * 2, height: size * 0.55, borderRadius: size, backgroundColor: '#fff' }]} />
      <View style={[abs, { left: size * 0.3, bottom: size * 0.2, width: size * 0.7, height: size * 0.7, borderRadius: size, backgroundColor: '#fff' }]} />
      <View style={[abs, { left: size * 0.8, bottom: size * 0.15, width: size * 0.85, height: size * 0.85, borderRadius: size, backgroundColor: '#fff' }]} />
    </View>
  );
}

export function Puff({ size, opacity }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#fff', opacity }} />;
}
