// Small status graphics for card details: battery, Bluetooth signal and Mopeka echo quality.
import { StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';
import Svg, { Rect } from 'react-native-svg';

const LOW_BATTERY = 20;

/** A battery outline filled to its charge, with the percentage beside it. Red when low. */
export function BatteryIndicator({ percent, color }: { percent: number | null; color?: string }) {
  const theme = useTheme();
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const fill = percent !== null && p <= LOW_BATTERY ? theme.colors.error : (color ?? theme.colors.onSurfaceVariant);
  const W = 22;
  const H = 11;
  const inner = (W - 5) * (p / 100);
  return (
    <View
      style={styles.row}
      accessibilityLabel={percent === null ? 'Battery unknown' : `Battery ${Math.round(p)} percent`}
    >
      <Svg width={W + 3} height={H + 2}>
        <Rect x={0.75} y={0.75} width={W} height={H} rx={2.5} fill="none" stroke={fill} strokeWidth={1.5} />
        <Rect x={W + 0.75} y={H / 2 - 2.25} width={2} height={5} rx={1} fill={fill} />
        {inner > 0 && <Rect x={2.75} y={2.75} width={inner} height={H - 4} rx={1} fill={fill} />}
      </Svg>
      <Text style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>
        {percent === null ? '—' : `${Math.round(p)}%`}
      </Text>
    </View>
  );
}

/** Bars for the strength the gateway hears the device at (0-4 bars). */
export function SignalBars({ rssi, color, showDbm = true }: { rssi: number; color?: string; showDbm?: boolean }) {
  const theme = useTheme();
  const bars = rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : rssi >= -90 ? 1 : 0;
  const on = color ?? theme.colors.onSurfaceVariant;
  const off = theme.colors.surfaceVariant;
  return (
    <View style={styles.row} accessibilityLabel={`Signal ${bars} of 4 bars, ${rssi} dBm`}>
      <Svg width={18} height={13}>
        {[0, 1, 2, 3].map((i) => {
          const h = 4 + i * 3;
          return <Rect key={i} x={i * 4.5} y={13 - h} width={3.2} height={h} rx={1} fill={i < bars ? on : off} />;
        })}
      </Svg>
      {showDbm && <Text style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>{rssi} dBm</Text>}
    </View>
  );
}

const ECHO_STARS: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
const ECHO_WORDS: Record<string, string> = { none: 'No reading', low: 'Poor', medium: 'Fair', high: 'Good' };

/** The Mopeka's echo (reading) quality as 0-3 stars. */
export function EchoStars({ quality, color }: { quality: string; color?: string }) {
  const theme = useTheme();
  const stars = ECHO_STARS[quality] ?? 0;
  const tint = color ?? theme.colors.onSurfaceVariant;
  return (
    <View style={styles.row} accessibilityLabel={`Echo ${ECHO_WORDS[quality] ?? quality}, ${stars} of 3 stars`}>
      <Text style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>Echo</Text>
      <View style={styles.stars}>
        {[0, 1, 2].map((i) => (
          <Icon key={i} source={i < stars ? 'star' : 'star-outline'} size={14} color={tint} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 18 },
  text: { fontSize: 13 },
  stars: { flexDirection: 'row' },
});
