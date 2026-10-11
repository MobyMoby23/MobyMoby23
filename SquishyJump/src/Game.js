import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Squishy, { squishyById } from './Squishy';
import { Bee, Cactus, Candy, Cloud, Puff } from './Sprites';
import { saveBest } from './storage';

// Tuning, in "design pixels" (a 400px-tall screen). Multiplied by the scale `s`.
const GRAVITY = 2600;
const JUMP_V = 950;
const DOUBLE_JUMP_V = 820;
const SPEED_START = 300;
const SPEED_MAX = 660;
const SPEED_GAIN = 7; // per second
const PLAYER = 58;
const CANDY_R = 13;
const CANDY_POINTS = 10;

const rand = (a, b) => a + Math.random() * (b - a);
const buzz = (fn) => {
  try {
    fn()?.catch?.(() => {});
  } catch {
    // haptics are a nicety; ignore platforms without them
  }
};

function newWorld(W, s) {
  return {
    state: 'ready',
    time: 0,
    distance: 0,
    speed: SPEED_START * s,
    y: 0, // height of the player's feet above the ground
    vy: 0,
    jumps: 2,
    holding: false,
    sx: 1,
    sy: 1,
    spin: 0,
    blinkAt: 2,
    blinkUntil: 0,
    gap: W * 0.6,
    obstacles: [],
    candies: [],
    puffs: [],
    candyCount: 0,
    nextId: 1,
    clouds: Array.from({ length: 4 }, (_, i) => ({
      x: (i / 4) * W * 1.2 + rand(0, 80) * s,
      y: rand(20, 120) * s,
      size: rand(30, 52) * s,
    })),
  };
}

function spawn(g, W, s) {
  const x = W + 30 * s;
  const level = g.distance / (2500 * s); // ~1 per 8 seconds early on
  const r = Math.random();
  let width;
  const add = (o) => g.obstacles.push({ id: g.nextId++, ...o });

  if (level < 1 || r < 0.38) {
    width = 38 * s;
    add({ type: 'cactus', x, w: width, h: 52 * s, yb: 0 });
  } else if (r < 0.56) {
    width = 42 * s;
    add({ type: 'cactus', x, w: width, h: 80 * s, yb: 0 });
  } else if (r < 0.7) {
    add({ type: 'cactus', x, w: 34 * s, h: 48 * s, yb: 0 });
    add({ type: 'cactus', x: x + 46 * s, w: 38 * s, h: 58 * s, yb: 0 });
    width = 84 * s;
  } else if (r < 0.86) {
    width = 52 * s;
    add({ type: 'bee', x, w: width, h: 34 * s, yb: 16 * s, base: 16 * s, phase: rand(0, 6) });
  } else {
    // a high bee: stay on the ground and let it buzz over you
    width = 52 * s;
    add({ type: 'bee', x, w: width, h: 34 * s, yb: 96 * s, base: 96 * s, phase: rand(0, 6) });
  }

  const addCandy = (cx, yb) => g.candies.push({ id: g.nextId++, x: cx, yb, color: g.nextId });
  if (Math.random() < 0.55) {
    const top = g.obstacles[g.obstacles.length - 1];
    if (top.type === 'bee' && top.base > 50 * s) {
      // reward staying low under a high bee
      for (let i = 0; i < 3; i++) addCandy(x + i * 34 * s, 14 * s);
    } else {
      const mid = x + width / 2 - CANDY_R * s;
      addCandy(mid - 52 * s, 112 * s);
      addCandy(mid, 152 * s);
      addCandy(mid + 52 * s, 112 * s);
    }
  }

  g.gap = width + rand(260, 540) * s + g.speed * 0.35;
}

function step(g, dt, W, s) {
  g.time += dt;
  const ease = Math.min(1, dt * 12);
  g.sx += (1 - g.sx) * ease;
  g.sy += (1 - g.sy) * ease;
  if (g.time > g.blinkAt) {
    g.blinkUntil = g.time + 0.13;
    g.blinkAt = g.time + rand(1.8, 4);
  }
  g.puffs = g.puffs.filter((p) => (p.life -= dt) > 0);
  for (const p of g.puffs) {
    p.x -= (g.state === 'playing' ? g.speed : 0) * dt * 0.6;
    p.size += 40 * s * dt;
  }

  if (g.state === 'ready') {
    g.y = Math.abs(Math.sin(g.time * 3)) * 10 * s; // idle hop
    return;
  }
  if (g.state === 'over') {
    if (g.y > 0) {
      g.vy -= GRAVITY * s * dt;
      g.y = Math.max(0, g.y + g.vy * dt);
    }
    g.sx = 1.45;
    g.sy = 0.55;
    return;
  }

  // physics
  g.speed = Math.min(SPEED_MAX * s, g.speed + SPEED_GAIN * s * dt);
  const dx = g.speed * dt;
  g.distance += dx;

  // releasing early cuts the jump short for finer control
  const grav = !g.holding && g.vy > 0 ? GRAVITY * 1.9 : GRAVITY;
  g.vy -= grav * s * dt;
  g.y += g.vy * dt;
  if (g.y <= 0) {
    if (g.vy < -300 * s) {
      g.sx = 1.35;
      g.sy = 0.68;
      g.puffs.push({ id: g.nextId++, x: W * 0.18, size: 10 * s, life: 0.35 });
      g.puffs.push({ id: g.nextId++, x: W * 0.18 + PLAYER * s, size: 10 * s, life: 0.35 });
    }
    g.y = 0;
    g.vy = 0;
    g.jumps = 2;
  } else if (g.vy !== 0) {
    // stretch tall while rising, squish a bit while falling
    const t = Math.max(-1, Math.min(1, g.vy / (JUMP_V * s)));
    g.sy = Math.max(g.sy, 1 + t * 0.12);
  }
  if (g.spin > 0) g.spin = Math.max(0, g.spin - dt * 900);

  // scenery
  for (const c of g.clouds) {
    c.x -= dx * 0.15;
    if (c.x < -c.size * 2.2) {
      c.x = W + rand(10, 160) * s;
      c.y = rand(20, 120) * s;
      c.size = rand(30, 52) * s;
    }
  }

  // world objects
  g.gap -= dx;
  if (g.gap <= 0) spawn(g, W, s);
  for (const o of g.obstacles) {
    o.x -= dx;
    if (o.type === 'bee') {
      o.x -= 40 * s * dt; // bees fly toward you
      o.yb = o.base + Math.sin(g.time * 5 + o.phase) * 8 * s;
    }
  }
  for (const c of g.candies) c.x -= dx;
  g.obstacles = g.obstacles.filter((o) => o.x + o.w > -20 * s);
  g.candies = g.candies.filter((c) => c.x > -40 * s && !c.got);

  // collisions (hitbox a little smaller than the art — it's squishy!)
  const pw = PLAYER * 1.1 * s;
  const ph = PLAYER * s;
  const px = W * 0.18;
  const box = { l: px + pw * 0.16, r: px + pw * 0.84, b: g.y + ph * 0.04, t: g.y + ph * 0.82 };
  for (const o of g.obstacles) {
    const inset = o.type === 'cactus' ? o.w * 0.22 : o.w * 0.1;
    if (box.r > o.x + inset && box.l < o.x + o.w - inset && box.t > o.yb + o.h * 0.1 && box.b < o.yb + o.h * 0.85) {
      g.state = 'over';
      g.vy = Math.max(g.vy, 0);
      buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
      return;
    }
  }
  const pcx = px + pw / 2;
  const pcy = g.y + ph / 2;
  for (const c of g.candies) {
    const r = CANDY_R * s;
    if (Math.hypot(c.x + r - pcx, c.yb + r - pcy) < r + ph * 0.55) {
      c.got = true;
      g.candyCount += 1;
      buzz(() => Haptics.selectionAsync());
    }
  }
}

export const scoreOf = (g, s) => Math.floor(g.distance / (40 * s)) + g.candyCount * CANDY_POINTS;

export default function Game({ kind, best, onBest, onHome }) {
  const { width: W, height: H } = useWindowDimensions();
  const s = Math.min(W, H) / 400;
  const groundH = Math.max(H * 0.18, 56 * s);
  const groundY = H - groundH;
  const g = useRef(null);
  if (!g.current) g.current = newWorld(W, s);
  const [, setFrame] = useState(0);
  const [finalScore, setFinalScore] = useState(null);

  useEffect(() => {
    let raf;
    let last = null;
    const loop = (t) => {
      const dt = last == null ? 0 : Math.min(0.034, (t - last) / 1000);
      last = t;
      const wasPlaying = g.current.state === 'playing';
      step(g.current, dt, W, s);
      if (wasPlaying && g.current.state === 'over') {
        const sc = scoreOf(g.current, s);
        setFinalScore(sc);
        if (sc > best) {
          onBest(sc);
          saveBest(sc);
        }
      }
      setFrame((f) => (f + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [W, s, best, onBest]);

  const press = () => {
    const w = g.current;
    if (w.state === 'over') return;
    if (w.state === 'ready') {
      w.state = 'playing';
      w.y = 0;
    }
    w.holding = true;
    if (w.jumps > 0) {
      const first = w.jumps === 2 && w.y <= 0.5;
      w.vy = (first ? JUMP_V : DOUBLE_JUMP_V) * s;
      w.jumps = first ? 1 : 0;
      w.sx = 0.72;
      w.sy = 1.32;
      if (!first) w.spin = 360;
      buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    }
  };
  const release = () => {
    g.current.holding = false;
  };
  const restart = () => {
    g.current = newWorld(W, s);
    setFinalScore(null);
  };

  const w = g.current;
  const score = scoreOf(w, s);
  const playerSize = PLAYER * s;
  const px = W * 0.18;

  // parallax hills
  const hills = (factor, spacing, radius, color, yOff) => {
    const off = (w.distance * factor) % spacing;
    const first = Math.floor((w.distance * factor) / spacing);
    const n = Math.ceil(W / spacing) + 2;
    return Array.from({ length: n }, (_, i) => {
      const k = first + i;
      const rr = radius * (0.75 + ((k * 7919) % 10) / 20);
      return (
        <View
          key={`${factor}-${k}`}
          style={{
            position: 'absolute',
            left: i * spacing - off - rr + spacing / 2,
            top: groundY - rr * 0.55 + yOff,
            width: rr * 2,
            height: rr * 2,
            borderRadius: rr,
            backgroundColor: color,
          }}
        />
      );
    });
  };
  const tuftSpacing = 46 * s;
  const tuftOff = w.distance % tuftSpacing;

  return (
    <View style={styles.root} onTouchStart={press} onTouchEnd={release} onTouchCancel={release}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#BFE6FF' }]} />
      <View style={[styles.band, { top: 0, height: H * 0.35, backgroundColor: '#A9DCFF' }]} />
      <View style={[styles.sun, { right: W * 0.28, top: 30 * s, width: 64 * s, height: 64 * s, borderRadius: 32 * s }]} />

      {w.clouds.map((c, i) => (
        <View key={i} style={{ position: 'absolute', left: c.x, top: c.y }}>
          <Cloud size={c.size} />
        </View>
      ))}
      {hills(0.2, 230 * s, 150 * s, '#C9EBC4', 6 * s)}
      {hills(0.45, 170 * s, 100 * s, '#A6DDA0', 18 * s)}

      {/* ground */}
      <View style={[styles.ground, { top: groundY, height: groundH }]}>
        <View style={{ height: 14 * s, backgroundColor: '#8FD27F' }} />
        <View style={{ flex: 1, backgroundColor: '#F2C9A0' }} />
      </View>
      {Array.from({ length: Math.ceil(W / tuftSpacing) + 2 }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: i * tuftSpacing - tuftOff,
            top: groundY + 26 * s + (i % 2) * 14 * s,
            width: 12 * s,
            height: 6 * s,
            borderRadius: 4 * s,
            backgroundColor: '#E5B48A',
          }}
        />
      ))}

      {w.candies.map((c) => (
        <View key={c.id} style={{ position: 'absolute', left: c.x, top: groundY - c.yb - CANDY_R * 2 * s }}>
          <Candy r={CANDY_R * s} colorIndex={c.color} />
        </View>
      ))}
      {w.obstacles.map((o) => (
        <View key={o.id} style={{ position: 'absolute', left: o.x, top: groundY - o.yb - o.h }}>
          {o.type === 'cactus' ? <Cactus w={o.w} h={o.h} /> : <Bee w={o.w} h={o.h} flap={Math.sin(w.time * 40) > 0} />}
        </View>
      ))}

      {w.puffs.map((p) => (
        <View key={p.id} style={{ position: 'absolute', left: p.x - p.size / 2, top: groundY - p.size * 0.7 }}>
          <Puff size={p.size} opacity={p.life / 0.35} />
        </View>
      ))}

      {/* shadow + player */}
      <View
        style={{
          position: 'absolute',
          left: px + playerSize * 0.1,
          top: groundY - 5 * s,
          width: playerSize * 0.9,
          height: 10 * s,
          borderRadius: 10 * s,
          backgroundColor: 'rgba(60,90,40,0.22)',
          transform: [{ scale: Math.max(0.4, 1 - w.y / (300 * s)) }],
        }}
      />
      <View style={{ position: 'absolute', left: px, top: groundY - w.y - playerSize }}>
        <Squishy
          kind={kind}
          size={playerSize}
          scaleX={w.sx}
          scaleY={w.sy}
          rotate={-w.spin}
          blink={w.time < w.blinkUntil}
          dizzy={w.state === 'over'}
        />
      </View>

      {/* HUD */}
      <View style={[styles.hud, { paddingHorizontal: Math.max(20, W * 0.06), top: 14 * s }]} pointerEvents="none">
        <View style={styles.pill}>
          <Text style={[styles.hudText, { fontSize: 20 * s }]}>{score}</Text>
        </View>
        <View style={styles.pill}>
          <Text style={[styles.hudSmall, { fontSize: 14 * s }]}>BEST {Math.max(best, score)}</Text>
        </View>
      </View>

      {w.state === 'ready' && (
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.card, { padding: 18 * s }]} pointerEvents="none">
            <Text style={[styles.title, { fontSize: 26 * s }]}>{squishyById(kind).name}</Text>
            <Text style={[styles.body, { fontSize: 15 * s }]}>Tap to jump · tap again in the air to double-jump</Text>
            <Text style={[styles.body, { fontSize: 15 * s }]}>Hold for a bigger jump · grab the candy!</Text>
          </View>
          <Pressable onPress={onHome} style={[styles.homeBtn, { bottom: 16 * s, left: Math.max(20, W * 0.06) }]} hitSlop={10}>
            <Text style={[styles.btnText, { fontSize: 14 * s }]}>‹ Squishies</Text>
          </Pressable>
        </View>
      )}

      {w.state === 'over' && finalScore != null && (
        <View style={[styles.overlay, { backgroundColor: 'rgba(80,50,90,0.25)' }]}>
          <View style={[styles.card, { padding: 22 * s }]}>
            <Text style={[styles.title, { fontSize: 32 * s }]}>Squished!</Text>
            <Text style={[styles.body, { fontSize: 18 * s }]}>Score {finalScore} · 🍬 {w.candyCount}</Text>
            {finalScore >= best && finalScore > 0 && (
              <Text style={[styles.newBest, { fontSize: 16 * s }]}>New best!</Text>
            )}
            <View style={styles.row}>
              <Pressable onPress={restart} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}>
                <Text style={[styles.btnText, { color: '#fff', fontSize: 17 * s }]}>Play again</Text>
              </Pressable>
              <Pressable onPress={onHome} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
                <Text style={[styles.btnText, { fontSize: 17 * s }]}>Pick a squishy</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  band: { position: 'absolute', left: 0, right: 0 },
  sun: { position: 'absolute', backgroundColor: '#FFF1A8', borderWidth: 6, borderColor: '#FFF8D6' },
  ground: { position: 'absolute', left: 0, right: 0 },
  hud: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  hudText: { fontWeight: '800', color: '#5B3A6B' },
  hudSmall: { fontWeight: '700', color: '#8A6A9A' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 24, alignItems: 'center', maxWidth: '86%' },
  title: { fontWeight: '900', color: '#5B3A6B', marginBottom: 6 },
  body: { color: '#7A5A8A', fontWeight: '600', textAlign: 'center', marginTop: 4 },
  newBest: { color: '#FF5E9E', fontWeight: '900', marginTop: 6 },
  row: { flexDirection: 'row', gap: 12, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  btn: { backgroundColor: '#F3E8FF', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  btnPrimary: { backgroundColor: '#FF7EB6' },
  btnText: { fontWeight: '800', color: '#5B3A6B' },
  pressed: { transform: [{ scale: 0.95 }] },
  homeBtn: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
