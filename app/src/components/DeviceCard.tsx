import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text, useTheme } from 'react-native-paper';

import { BarGauge, DialGauge } from '@/components/Gauge';
import { BatteryIndicator, EchoStars, SignalBars } from '@/components/Indicators';
import { TankGraphic } from '@/components/TankGraphic';
import { cardFraction, cardStyles, defaultCardWidth, deviceIcon } from '@/deviceClasses';
import { formatAge, formatValue, primaryValue, wholeDegrees } from '@/format';
import { useDeviceAction } from '@/hooks/useDeviceAction';
import type { Device, Value } from '@/protocol/types';
import { useSettings, type CardStyle, type CardWidth, type TemperatureUnit } from '@/store/settings';
import { useLayout } from '@/store/layouts';
import { severityColor } from '@/theme';

export function useCardStyle(device: Device): CardStyle {
  const saved = useLayout().styles[device.id];
  const offered = cardStyles(device);
  return saved && offered.includes(saved) ? saved : offered[0];
}

export function useCardWidth(device: Device): CardWidth {
  const style = useCardStyle(device);
  const saved = useLayout().widths[device.id];
  return saved ?? defaultCardWidth(device, style);
}

interface Props {
  device: Device;
  onPress: () => void;
  /** Buttons over the card's top right corner (the dashboard's edit mode). */
  actions?: ReactNode;
  /**
   * The width of the whole row, in pixels: a full-width card takes it, a half-width one half.
   * Without it, percentages of the parent, which only work where the parent is the row.
   */
  rowWidth?: number;
}

/** One line under a card's main value: a reading, or a small graphic with its value. */
type Detail = { kind: 'text'; text: string } | { kind: 'echo'; quality: string };

interface Zone {
  label: string;
  current: string;
  target?: string;
  fraction: number | undefined;
}

/** Both zones of a dual-zone fridge (current and target each), or undefined for a single zone. */
function fridgeZones(device: Device, unit: TemperatureUnit): Zone[] | undefined {
  const value = (key: string) => device.values.find((v) => v.key === key);
  const left = value('left.current');
  const right = value('right.current');
  const controls = (key: string) => device.controls.find((c) => c.key === key);
  // Separate zones only when both report a temperature and both targets can be set.
  if (!left || !right || !controls('left.target') || !controls('right.target')) return undefined;
  const zone = (label: string, v: Value, targetKey: string): Zone => {
    const t = controls(targetKey);
    const scale = (n: unknown) =>
      typeof n === 'number' && v.min !== undefined && v.max !== undefined && v.max > v.min
        ? Math.min(1, Math.max(0, (n - v.min) / (v.max - v.min)))
        : undefined;
    return {
      label,
      current: formatValue(v, unit),
      target: t && t.kind === 'number' ? `Target ${formatValue({ ...v, value: t.value }, unit)}` : undefined,
      fraction: scale(v.value),
    };
  };
  return [zone('Left', left, 'left.target'), zone('Right', right, 'right.target')];
}

/** What a card shows, worked out once for every layout. */
interface CardModel {
  device: Device;
  style: CardStyle;
  wide: boolean;
  primary: string;
  details: Detail[];
  age: string;
  /** A fridge with separately controlled left and right zones: both shown as equals. */
  zones?: Zone[];
  /** Battery charge, when the device reports one (null = reported, but no reading yet). */
  battery?: number | null;
  /** Signal strength the gateway hears the device at. */
  rssi?: number;
  fraction: number | undefined;
  /** Graphic and value color: the theme's, an alarm's, or grey when offline. */
  tint: string;
  chip?: { text: string; color: string };
  offline: boolean;
  alarmed: boolean;
}

/**
 * A dashboard card, after the MAUI app's tiles: a header with the device's icon, name and status
 * chip; one large value; the other readings and the age in smaller muted text. A gauge or tank sits
 * beside the value, and on a two-column card it takes the left side with everything else on the right.
 */
export function DeviceCard({ device: reported, onPress, actions, rowWidth }: Props) {
  const theme = useTheme();
  const unit = useSettings((s) => s.temperatureUnit);
  const device = wholeDegrees(reported, unit);
  const style = useCardStyle(device);
  const width = useCardWidth(device);

  const primaryV = primaryValue(device);
  const worst = device.alarms?.find((a) => a.severity === 'critical') ?? device.alarms?.[0];
  const offline = !device.status.online;
  const alarmColor = worst ? severityColor(theme, worst.severity) : undefined;
  const zones = device.class === 'refrigerator' ? fridgeZones(device, unit) : undefined;
  const fault = device.class === 'surge_protector' ? device.values.find((v) => v.key === 'fault')?.value : undefined;
  const model: CardModel = {
    device,
    style,
    wide: width === 2,
    primary: zones ? zones.map((z) => z.current).join(' · ') : primaryV ? formatValue(primaryV, unit) : '—',
    details: cardDetails(device, primaryV, width === 2, unit),
    zones,
    age: offline
      ? device.status.age_s == null
        ? 'Offline · no data received'
        : `Offline · last data ${formatAge(device.status.age_s)}`
      : device.status.age_s == null
        ? 'Waiting for data'
        : formatAge(device.status.age_s),
    fraction: cardFraction(device, style),
    battery: batteryOf(device),
    rssi: device.status.rssi || undefined,
    tint: offline ? theme.colors.outline : (alarmColor ?? theme.colors.primary),
    chip: offline
      ? { text: 'OFFLINE', color: theme.colors.error }
      : worst && alarmColor
        ? { text: worst.label.toUpperCase(), color: alarmColor }
        : typeof fault === 'string'
          ? { text: 'FAULT', color: theme.colors.error }
          : undefined,
    offline,
    alarmed: !!worst && !offline,
  };

  return (
    <View
      style={[
        styles.cell,
        { width: rowWidth ? Math.floor(model.wide ? rowWidth : rowWidth / 2) : model.wide ? '100%' : '50%' },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${device.name}, ${model.primary}${model.chip ? `, ${model.chip.text}` : ''}`}
        accessibilityHint="Opens the device. Press and hold, then drag, to move the card."
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: offline ? theme.colors.background : theme.colors.elevation.level2 },
          offline && { borderColor: theme.colors.outline, borderWidth: 1, borderStyle: 'dashed' },
          model.alarmed && { borderColor: model.tint, borderWidth: 2 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <CardBody m={model} />
      </Pressable>
      {actions && <View style={styles.actions}>{actions}</View>}
    </View>
  );
}

function CardBody({ m }: { m: CardModel }) {
  const graphic = m.style === 'propane_tank' || m.style === 'liquid_tank' || m.style === 'dial';

  if (m.zones && m.style !== 'compact') {
    return (
      <>
        <Header m={m} />
        <View style={styles.zones}>
          {m.zones.map((z) => (
            <ZoneView key={z.label} z={z} m={m} />
          ))}
        </View>
        <Details m={m} />
      </>
    );
  }

  if (m.style === 'compact') {
    return (
      <View style={styles.row}>
        <View style={styles.flex}>
          <Header m={m} />
          <StatusRow m={m} />
        </View>
        <Value m={m} size="medium" />
      </View>
    );
  }

  if (m.style === 'lock_switch') {
    return (
      <>
        <Header m={m} />
        <LockSwitch device={m.device} />
        <Muted text={m.age} small />
      </>
    );
  }

  // Two columns with a graphic: the graphic fills the left, the text the right, its details in two columns.
  if (m.wide && graphic) {
    return (
      <View style={styles.row}>
        <Graphic m={m} large />
        <View style={styles.flex}>
          <Header m={m} />
          <Value m={m} size="large" />
          <Details m={m} columns={2} />
        </View>
      </View>
    );
  }

  // Two columns, text or bar: the value on the left, the other readings beside it.
  if (m.wide) {
    return (
      <>
        <Header m={m} />
        <View style={styles.row}>
          <Value m={m} size="large" />
          <View style={[styles.flex, styles.sideDetails]}>
            <Details m={m} />
          </View>
        </View>
        {m.style === 'bar' && <Bar m={m} />}
      </>
    );
  }

  // One column: stacked, with any graphic beside the value.
  return (
    <>
      <Header m={m} />
      {graphic ? (
        <View style={styles.row}>
          <Graphic m={m} />
          <Value m={m} size="medium" />
        </View>
      ) : (
        <Value m={m} size="large" />
      )}
      {m.style === 'bar' && <Bar m={m} />}
      <Details m={m} />
    </>
  );
}

/** One cooler zone: its name, current temperature (with a dial on the dial style) and target. */
function ZoneView({ z, m }: { z: Zone; m: CardModel }) {
  const theme = useTheme();
  const color = m.offline ? theme.colors.outline : m.alarmed ? m.tint : theme.colors.onSurface;
  return (
    <View style={[styles.zone, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.zoneLabel, { color: theme.colors.onSurfaceVariant }]}>{z.label.toUpperCase()}</Text>
      <View style={styles.zoneValue}>
        {m.style === 'dial' && <DialGauge fraction={z.fraction} color={m.tint} size={44} />}
        <Text style={[styles.valueMedium, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {z.current}
        </Text>
      </View>
      {z.target && <Muted text={z.target} small />}
    </View>
  );
}

function Header({ m }: { m: CardModel }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Icon
        source={deviceIcon(m.device)}
        size={18}
        color={m.offline ? theme.colors.outline : theme.colors.onSurfaceVariant}
      />
      <Text variant="labelLarge" numberOfLines={1} style={[styles.name, { color: theme.colors.onSurfaceVariant }]}>
        {m.device.name}
      </Text>
      {m.chip && (
        <View style={[styles.chip, { backgroundColor: `${m.chip.color}26` }]}>
          <Text style={[styles.chipText, { color: m.chip.color }]}>{m.chip.text}</Text>
        </View>
      )}
    </View>
  );
}

function Value({ m, size }: { m: CardModel; size: 'medium' | 'large' }) {
  const theme = useTheme();
  const color = m.offline ? theme.colors.outline : m.alarmed ? m.tint : theme.colors.onSurface;
  return (
    <Text
      style={[size === 'large' ? styles.valueLarge : styles.valueMedium, { color }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
    >
      {m.primary}
    </Text>
  );
}

function Details({ m, columns = 1 }: { m: CardModel; columns?: 1 | 2 }) {
  return (
    <View style={styles.details}>
      <View style={columns === 2 ? styles.grid : undefined}>
        {m.details.map((d, i) => (
          <View key={i} style={columns === 2 ? styles.gridCell : undefined}>
            <DetailLine d={d} tint={m.offline ? undefined : m.tint} />
          </View>
        ))}
      </View>
      <StatusRow m={m} />
    </View>
  );
}

/** The same on every card: battery and signal when the device reports them, then the age. */
function StatusRow({ m }: { m: CardModel }) {
  const indicators = (m.battery !== undefined || m.rssi !== undefined) && (
    <>
      {m.battery !== undefined && <BatteryIndicator percent={m.battery} />}
      {m.rssi !== undefined && <SignalBars rssi={m.rssi} showDbm={m.wide} />}
    </>
  );
  // A wide card has room for the age on the same line; a narrow one puts it underneath.
  if (!m.wide)
    return (
      <View style={styles.statusNarrow}>
        {indicators && <View style={styles.status}>{indicators}</View>}
        <Muted text={m.age} small />
      </View>
    );
  return (
    <View style={styles.status}>
      {indicators}
      <View style={styles.flex} />
      <Muted text={m.age} small />
    </View>
  );
}

function DetailLine({ d, tint }: { d: Detail; tint?: string }) {
  switch (d.kind) {
    case 'echo':
      return <EchoStars quality={d.quality} color={tint} />;
    default:
      return <Muted text={d.text} />;
  }
}

function Muted({ text, small }: { text: string; small?: boolean }) {
  const theme = useTheme();
  return (
    <Text numberOfLines={1} style={[small ? styles.small : styles.muted, { color: theme.colors.onSurfaceVariant }]}>
      {text}
    </Text>
  );
}

function Graphic({ m, large }: { m: CardModel; large?: boolean }) {
  const w = large ? 72 : 46;
  const h = large ? 96 : 64;
  if (m.style === 'dial') return <DialGauge fraction={m.fraction} color={m.tint} size={large ? 88 : 50} />;
  return (
    <TankGraphic
      shape={m.style === 'liquid_tank' ? 'liquid' : 'propane'}
      fraction={m.fraction}
      color={m.tint}
      width={w}
      height={h}
    />
  );
}

function Bar({ m }: { m: CardModel }) {
  return (
    <View style={styles.bar}>
      <BarGauge fraction={m.fraction} color={m.tint} />
    </View>
  );
}

const isBattery = (v: Value) => v.unit === '%' && (v.key === 'battery' || v.key === 'battery_pct');

/** The device's battery charge in percent; undefined when it reports none. */
function batteryOf(device: Device): number | null | undefined {
  const v = device.values.find(isBattery);
  if (!v) return undefined;
  return typeof v.value === 'number' ? v.value : null;
}

/**
 * The lines under the main value. One-column cards show two readings, as on the MAUI tiles, and
 * two-column cards four; a two-column level sensor card shows everything the sensor reports,
 * including its echo. Battery and signal are not here: every card shows them in its status row.
 */
function cardDetails(device: Device, primary: Value | undefined, wide: boolean, unit: TemperatureUnit): Detail[] {
  const toDetail = (v: Value): Detail => ({ kind: 'text', text: `${v.label} ${formatValue(v, unit)}` });
  // Battery shows in the status row on every card.
  const zoned = new Set(['left.current', 'right.current']);
  const others = device.values.filter(
    (v) =>
      v !== primary &&
      v.enum === undefined &&
      !isBattery(v) &&
      // Text values (such as a fault) only when there is something to say; numbers always.
      !(v.value === null && v.decimals === undefined) &&
      !(device.class === 'refrigerator' && primary?.key === 'left.current' && zoned.has(v.key)),
  );
  if (!(wide && device.class === 'liquid_level_sensor')) return others.slice(0, wide ? 4 : 2).map(toDetail);

  const details = others.map(toDetail);
  const echo = device.values.find((v) => v.key === 'quality')?.value;
  if (typeof echo === 'string') details.push({ kind: 'echo', quality: echo });
  return details;
}

/** The MAUI lock switch: a pill with a sliding knob, showing the last command; tap to lock or unlock. */
function LockSwitch({ device }: { device: Device }) {
  const theme = useTheme();
  const { run, pending } = useDeviceAction(device);
  const control = device.controls.find((c) => c.kind === 'action');
  const locked = device.values.find((v) => v.key === 'last_action')?.value !== 'unlock';
  const next = locked ? 'unlock' : 'lock';
  const busy = pending !== undefined || !!device.status.busy;
  const label = busy ? (pending === 'unlock' ? 'Unlocking…' : 'Locking…') : locked ? 'Locked' : 'Unlocked';

  return (
    <Pressable
      onPress={() => run(next, undefined, control)}
      disabled={busy || !control}
      style={[
        styles.switchTrack,
        { backgroundColor: locked ? theme.colors.primary : theme.colors.surfaceVariant, opacity: busy ? 0.6 : 1 },
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: locked, busy }}
      accessibilityLabel={`${device.name} ${label}. Tap to ${next}.`}
    >
      <Text
        variant="titleMedium"
        style={[styles.switchText, { color: locked ? theme.colors.onPrimary : theme.colors.onSurface }]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.knob,
          locked ? styles.knobRight : styles.knobLeft,
          { backgroundColor: locked ? theme.colors.onPrimary : theme.colors.elevation.level2 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size={20} />
        ) : (
          <Icon
            source={locked ? 'lock' : 'lock-open-variant'}
            size={22}
            color={locked ? theme.colors.primary : theme.colors.onSurfaceVariant}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: { padding: 5 },
  actions: { position: 'absolute', top: 0, right: 0, flexDirection: 'row' },
  card: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  sideDetails: { alignItems: 'flex-end' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  name: { flex: 1, fontWeight: '700' },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  valueLarge: { fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  valueMedium: { flexShrink: 1, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  details: { marginTop: 2, gap: 2 },
  zones: { flexDirection: 'row', gap: 8, marginTop: 4 },
  zone: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' },
  zoneLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  zoneValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  statusNarrow: { gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 2 },
  gridCell: { width: '50%', paddingRight: 6 },
  muted: { fontSize: 13 },
  small: { fontSize: 12 },
  bar: { marginTop: 8, marginBottom: 4 },
  switchTrack: { height: 56, borderRadius: 28, marginVertical: 8, justifyContent: 'center' },
  switchText: { textAlign: 'center', fontWeight: '700', marginHorizontal: 56 },
  knob: {
    position: 'absolute',
    top: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobLeft: { left: 6 },
  knobRight: { right: 6 },
});
