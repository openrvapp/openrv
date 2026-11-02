import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from 'react-native-paper';

interface Props {
  /** 0-1; undefined draws an empty gauge. */
  fraction: number | undefined;
  color?: string;
}

const SWEEP = 270; // degrees: a three-quarter ring, open at the bottom

function polar(c: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
}

function arc(c: number, r: number, from: number, to: number): string {
  const a = polar(c, r, from);
  const b = polar(c, r, to);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

const clamp = (f: number | undefined) => Math.max(0, Math.min(1, f ?? 0));

/** A dial: a three-quarter ring filled clockwise from the lower left. */
export function DialGauge({ fraction, color, size = 64 }: Props & { size?: number }) {
  const theme = useTheme();
  const f = clamp(fraction);
  const stroke = size * 0.14;
  const c = size / 2;
  const r = c - stroke / 2;
  const start = -SWEEP / 2;
  return (
    <Svg
      width={size}
      height={size}
      accessibilityRole="image"
      accessibilityLabel={fraction === undefined ? 'No reading' : `${Math.round(f * 100)} percent`}
    >
      <Path
        d={arc(c, r, start, start + SWEEP)}
        stroke={theme.colors.surfaceVariant}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
      />
      {f > 0.005 && (
        <Path
          d={arc(c, r, start, start + SWEEP * f)}
          stroke={color ?? theme.colors.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
      )}
    </Svg>
  );
}

/** A rounded bar across the whole width of its container, filled from the left. */
export function BarGauge({ fraction, color }: Props) {
  const theme = useTheme();
  const f = clamp(fraction);
  return (
    <View
      style={[styles.track, { backgroundColor: theme.colors.surfaceVariant }]}
      accessibilityRole="progressbar"
      accessibilityValue={fraction === undefined ? undefined : { min: 0, max: 100, now: Math.round(f * 100) }}
    >
      {/* Never narrower than the rounded ends, so a low value still shows. */}
      {f > 0 && (
        <View style={[styles.fill, { width: `${f * 100}%`, backgroundColor: color ?? theme.colors.primary }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: 5, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', minWidth: 10, borderRadius: 5 },
});
