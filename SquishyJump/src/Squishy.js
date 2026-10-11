import { View } from 'react-native';

// Each squishy is drawn from plain Views so it runs in Expo Go with no images.
export const SQUISHIES = [
  { id: 'kitty', name: 'Kiki the Cat', body: '#FFB8D2', belly: '#FFE3EE', accent: '#FF8FB8', ears: 'cat' },
  { id: 'frog', name: 'Fern the Frog', body: '#9BE08A', belly: '#E4F9C8', accent: '#6CC45A', ears: 'frog' },
  { id: 'cow', name: 'Moomoo the Cow', body: '#FFFFFF', belly: '#FFD6E0', accent: '#4A3B3B', ears: 'cow' },
  { id: 'bunny', name: 'Lulu the Bunny', body: '#D7C4FF', belly: '#F1EAFF', accent: '#FFB3D1', ears: 'bunny' },
  { id: 'axolotl', name: 'Axel the Axolotl', body: '#FFC6E4', belly: '#FFE8F4', accent: '#FF7EB6', ears: 'axolotl' },
  { id: 'bear', name: 'Honey the Bear', body: '#E8B17A', belly: '#F9E2C6', accent: '#C98A50', ears: 'bear' },
];

export const squishyById = (id) => SQUISHIES.find((s) => s.id === id) ?? SQUISHIES[0];

const abs = { position: 'absolute' };

function Ears({ type, W, H, c }) {
  switch (type) {
    case 'cat': {
      const e = H * 0.34;
      const ear = (side) => (
        <View
          key={side}
          style={[abs, {
            width: e, height: e, top: -e * 0.22, [side]: W * 0.12,
            backgroundColor: c.body, borderRadius: e * 0.22,
            transform: [{ rotate: side === 'left' ? '35deg' : '-35deg' }],
            alignItems: 'center', justifyContent: 'center',
          }]}
        >
          <View style={{ width: e * 0.5, height: e * 0.5, borderRadius: e * 0.15, backgroundColor: c.accent }} />
        </View>
      );
      return [ear('left'), ear('right')];
    }
    case 'bunny': {
      const ew = H * 0.22;
      const eh = H * 0.62;
      const ear = (side) => (
        <View
          key={side}
          style={[abs, {
            width: ew, height: eh, top: -eh * 0.68, [side]: W * 0.22,
            backgroundColor: c.body, borderRadius: ew / 2,
            transform: [{ rotate: side === 'left' ? '-12deg' : '12deg' }],
            alignItems: 'center', justifyContent: 'center',
          }]}
        >
          <View style={{ width: ew * 0.5, height: eh * 0.7, borderRadius: ew / 4, backgroundColor: c.accent }} />
        </View>
      );
      return [ear('left'), ear('right')];
    }
    case 'frog': {
      const d = H * 0.4;
      return ['left', 'right'].map((side) => (
        <View
          key={side}
          style={[abs, {
            width: d, height: d, top: -d * 0.38, [side]: W * 0.1,
            backgroundColor: c.body, borderRadius: d / 2,
          }]}
        />
      ));
    }
    case 'cow': {
      const hw = H * 0.12;
      const ew = H * 0.3;
      return [
        ...['left', 'right'].map((side) => (
          <View
            key={`horn-${side}`}
            style={[abs, {
              width: hw, height: hw * 1.5, top: -hw * 0.9, [side]: W * 0.3,
              backgroundColor: '#FFE7A8', borderRadius: hw / 2,
            }]}
          />
        )),
        ...['left', 'right'].map((side) => (
          <View
            key={`ear-${side}`}
            style={[abs, {
              width: ew, height: ew * 0.5, top: H * 0.1, [side]: -ew * 0.38,
              backgroundColor: c.accent, borderRadius: ew / 2,
              transform: [{ rotate: side === 'left' ? '20deg' : '-20deg' }],
            }]}
          />
        )),
      ];
    }
    case 'axolotl': {
      const gw = H * 0.28;
      const gh = H * 0.11;
      const angles = [-35, 0, 35];
      return ['left', 'right'].flatMap((side) =>
        angles.map((a, i) => (
          <View
            key={`${side}-${i}`}
            style={[abs, {
              width: gw, height: gh, borderRadius: gh / 2, backgroundColor: c.accent,
              top: H * 0.22 + i * gh * 1.1 - gh, [side]: -gw * 0.62,
              transform: [{ rotate: `${side === 'left' ? a : -a}deg` }],
            }]}
          />
        )),
      );
    }
    case 'bear': {
      const d = H * 0.3;
      return ['left', 'right'].map((side) => (
        <View
          key={side}
          style={[abs, {
            width: d, height: d, top: -d * 0.3, [side]: W * 0.1,
            backgroundColor: c.body, borderRadius: d / 2,
            alignItems: 'center', justifyContent: 'center',
          }]}
        >
          <View style={{ width: d * 0.5, height: d * 0.5, borderRadius: d / 4, backgroundColor: c.accent }} />
        </View>
      ));
    }
    default:
      return null;
  }
}

function Eye({ size, blink, style }) {
  return (
    <View style={[abs, style, { width: size, height: size, alignItems: 'center', justifyContent: 'center' }]}>
      <View
        style={{
          width: size,
          height: blink ? size * 0.18 : size,
          borderRadius: size / 2,
          backgroundColor: '#2B2230',
        }}
      >
        {!blink && (
          <View
            style={[abs, {
              width: size * 0.38, height: size * 0.38, borderRadius: size,
              backgroundColor: '#fff', top: size * 0.14, left: size * 0.16,
            }]}
          />
        )}
      </View>
    </View>
  );
}

/**
 * A squishy plush character. `size` is the body height in px; the footprint is
 * size*1.1 wide. scaleX/scaleY squash it from the bottom so it stays on the ground.
 */
export default function Squishy({ kind = 'kitty', size = 60, scaleX = 1, scaleY = 1, rotate = 0, blink = false, dizzy = false }) {
  const c = typeof kind === 'string' ? squishyById(kind) : kind;
  const H = size;
  const W = size * 1.1;
  const eye = H * 0.12;
  const frog = c.ears === 'frog';

  return (
    <View
      style={{
        width: W,
        height: H,
        transformOrigin: 'bottom',
        transform: [{ rotate: `${rotate}deg` }, { scaleX }, { scaleY }],
      }}
    >
      <Ears type={c.ears} W={W} H={H} c={c} />

      {/* body */}
      <View
        style={[abs, {
          left: 0, top: 0, width: W, height: H,
          backgroundColor: c.body,
          borderTopLeftRadius: W * 0.5, borderTopRightRadius: W * 0.5,
          borderBottomLeftRadius: W * 0.4, borderBottomRightRadius: W * 0.4,
          overflow: 'hidden',
          borderWidth: c.id === 'cow' ? 1.5 : 0, borderColor: '#EADDE0',
        }]}
      >
        {c.id === 'cow' && (
          <>
            <View style={[abs, { width: H * 0.38, height: H * 0.3, borderRadius: H, backgroundColor: c.accent, left: -H * 0.08, top: H * 0.45 }]} />
            <View style={[abs, { width: H * 0.26, height: H * 0.22, borderRadius: H, backgroundColor: c.accent, right: H * 0.1, top: H * 0.08 }]} />
          </>
        )}
        {/* belly */}
        <View
          style={[abs, {
            width: W * 0.52, height: H * 0.42, left: W * 0.24, bottom: -H * 0.06,
            backgroundColor: c.belly, borderRadius: W,
          }]}
        />
        {/* soft top sheen */}
        <View
          style={[abs, {
            width: W * 0.3, height: H * 0.12, left: W * 0.2, top: H * 0.08,
            backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: H,
            transform: [{ rotate: '-18deg' }],
          }]}
        />
      </View>

      {/* eyes: frogs keep theirs up in the bumps */}
      {dizzy ? (
        ['left', 'right'].map((side) => (
          <View
            key={side}
            style={[abs, {
              [side]: W * 0.27, top: frog ? -H * 0.02 : H * 0.36,
              width: eye * 1.2, height: eye * 1.2, alignItems: 'center', justifyContent: 'center',
            }]}
          >
            <View style={[abs, { width: eye * 1.2, height: 2.5, backgroundColor: '#2B2230', transform: [{ rotate: '45deg' }] }]} />
            <View style={[abs, { width: eye * 1.2, height: 2.5, backgroundColor: '#2B2230', transform: [{ rotate: '-45deg' }] }]} />
          </View>
        ))
      ) : (
        <>
          <Eye size={eye} blink={blink} style={{ left: frog ? W * 0.2 : W * 0.28, top: frog ? -H * 0.02 : H * 0.36 }} />
          <Eye size={eye} blink={blink} style={{ right: frog ? W * 0.2 : W * 0.28, top: frog ? -H * 0.02 : H * 0.36 }} />
        </>
      )}

      {/* blush */}
      {['left', 'right'].map((side) => (
        <View
          key={side}
          style={[abs, {
            [side]: W * 0.14, top: H * 0.5, width: H * 0.16, height: H * 0.09,
            borderRadius: H, backgroundColor: 'rgba(255,110,150,0.45)',
          }]}
        />
      ))}

      {/* little smile */}
      <View
        style={[abs, {
          left: W / 2 - H * 0.07, top: H * 0.47, width: H * 0.14, height: H * 0.08,
          borderBottomWidth: 2, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: '#2B2230', borderBottomLeftRadius: H * 0.1, borderBottomRightRadius: H * 0.1,
          borderTopWidth: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent',
        }]}
      />
    </View>
  );
}
