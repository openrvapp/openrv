// What the gateway's status light and BOOT button do. Matches firmware/components/board/board.cpp.
import { useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, View } from 'react-native';
import { List, Text, useTheme } from 'react-native-paper';

type Pattern = { kind: 'steady' } | { kind: 'breathe'; ms: number } | { kind: 'blink'; ms: number };

interface Light {
  color: string;
  pattern: Pattern;
  title: string;
  meaning: string;
}

// The LED's colours, made a little lighter so they read on screen.
const GREEN = '#2ecc71';
const CYAN = '#22c8ff';
const BLUE = '#3d6bff';
const AMBER = '#ff9f1a';
const RED = '#ff3b30';
const PURPLE = '#b04dff';

const STATUS: Light[] = [
  {
    color: GREEN,
    pattern: { kind: 'breathe', ms: 4000 },
    title: 'Slow green glow',
    meaning: 'All is well, and no phone is connected.',
  },
  {
    color: GREEN,
    pattern: { kind: 'steady' },
    title: 'Steady green',
    meaning: 'All is well, and a phone is connected.',
  },
  {
    color: CYAN,
    pattern: { kind: 'breathe', ms: 3000 },
    title: 'Slow cyan glow',
    meaning: 'Nobody owns the gateway yet. Set it up from the app with its setup code or pairing mode.',
  },
  {
    color: BLUE,
    pattern: { kind: 'blink', ms: 500 },
    title: 'Blinking blue',
    meaning: 'Pairing mode: for 2 minutes, a new phone can join (or become the owner of a new gateway).',
  },
  { color: AMBER, pattern: { kind: 'steady' }, title: 'Steady amber', meaning: 'A warning alert is active.' },
  { color: RED, pattern: { kind: 'blink', ms: 1000 }, title: 'Blinking red', meaning: 'A critical alert is active.' },
  {
    color: PURPLE,
    pattern: { kind: 'breathe', ms: 1500 },
    title: 'Purple glow',
    meaning: 'A firmware update is in progress. Leave the gateway powered.',
  },
];

const BUTTON: Light[] = [
  {
    color: BLUE,
    pattern: { kind: 'steady' },
    title: 'Short press',
    meaning: 'Shows the status brightly for a few seconds, so it’s easy to read.',
  },
  {
    color: BLUE,
    pattern: { kind: 'blink', ms: 1000 },
    title: 'Hold 3 seconds',
    meaning: 'The light blinks blue once a second, then stays blue. Let go to start pairing mode, so a phone can join.',
  },
  {
    color: RED,
    pattern: { kind: 'blink', ms: 250 },
    title: 'Hold 10 seconds',
    meaning:
      'After the blue, the light blinks red faster and faster, then stays red: a factory reset. It erases every device, alert rule, setting and phone on the gateway, and can’t be undone. Letting go sooner starts pairing mode instead.',
  },
];

export default function GatewayLightScreen() {
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text variant="bodyMedium" style={[styles.intro, { color: theme.colors.onSurfaceVariant }]}>
        The gateway board&apos;s light shows what it&apos;s doing. It&apos;s kept dim; press the BOOT button briefly to
        see it brighter. Boards without a colour light skip this.
      </Text>
      <List.Section title="The light">
        {STATUS.map((l) => (
          <Row key={l.title} light={l} />
        ))}
      </List.Section>
      <List.Section title="The BOOT button">
        {BUTTON.map((l) => (
          <Row key={l.title} light={l} />
        ))}
      </List.Section>
      <Text variant="bodySmall" style={[styles.intro, { color: theme.colors.onSurfaceVariant }]}>
        When several apply, the light shows the first in this order: firmware update, pairing mode, critical alert,
        warning, no owner, then green.
      </Text>
    </ScrollView>
  );
}

function Row({ light }: { light: Light }) {
  return (
    <List.Item
      title={light.title}
      description={light.meaning}
      descriptionNumberOfLines={6}
      left={() => (
        <View style={styles.dotCell}>
          <Dot color={light.color} pattern={light.pattern} />
        </View>
      )}
    />
  );
}

/** A dot that glows, blinks or stays lit like the gateway's light. */
function Dot({ color, pattern }: { color: string; pattern: Pattern }) {
  const level = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (pattern.kind === 'steady') return;
    const half = pattern.ms / 2;
    const loop =
      pattern.kind === 'breathe'
        ? Animated.sequence([
            Animated.timing(level, {
              toValue: 0.15,
              duration: half,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(level, {
              toValue: 1,
              duration: half,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        : Animated.sequence([
            Animated.timing(level, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.delay(half),
            Animated.timing(level, { toValue: 0.08, duration: 0, useNativeDriver: true }),
            Animated.delay(half),
          ]);
    const running = Animated.loop(loop);
    running.start();
    return () => running.stop();
  }, [level, pattern]);

  return (
    <View style={styles.dotRing}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: level, shadowColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  intro: { paddingHorizontal: 16, paddingTop: 12 },
  dotCell: { width: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  dotRing: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 20, height: 20, borderRadius: 10, elevation: 4, shadowOpacity: 0.8, shadowRadius: 6 },
});
