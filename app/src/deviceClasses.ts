// What the app knows about each device class: its icon and the dashboard cards it offers. The app
// knows nothing about makers or protocols; every device of a class looks the same, and everything
// else (values, controls, settings) comes from the gateway. See docs/device-classes.md.
import type { Device, DeviceClass } from '@/protocol/types';
import type { CardStyle, CardWidth } from '@/store/settings';

export const CLASS_NAMES: Record<DeviceClass, string> = {
  temperature_sensor: 'Temperature sensor',
  liquid_level_sensor: 'Liquid level sensor',
  battery_monitor: 'Battery monitor',
  solar_controller: 'Solar controller',
  refrigerator: 'Refrigerator',
  lock: 'Lock',
  surge_protector: 'Surge protector',
};

const CLASS_ICONS: Record<DeviceClass, string> = {
  temperature_sensor: 'thermometer',
  liquid_level_sensor: 'water-percent',
  battery_monitor: 'car-battery',
  solar_controller: 'solar-power-variant',
  refrigerator: 'fridge',
  lock: 'lock',
  surge_protector: 'flash',
};

/** Shown when a device's class is newer than this app. */
const UNKNOWN_ICON = 'devices';

const isPropane = (d: Pick<Device, 'traits'>) => d.traits?.fluid === 'propane';

export function deviceIcon(d: Pick<Device, 'class' | 'traits'>): string {
  if (d.class === 'liquid_level_sensor' && isPropane(d)) return 'propane-tank';
  return CLASS_ICONS[d.class] ?? UNKNOWN_ICON;
}

/** Card styles a device offers (as in the MAUI app); the first is the default. */
export function cardStyles(d: Device): CardStyle[] {
  switch (d.class) {
    case 'liquid_level_sensor':
      return isPropane(d)
        ? ['propane_tank', 'liquid_tank', 'standard', 'dial', 'bar', 'compact']
        : ['liquid_tank', 'propane_tank', 'standard', 'dial', 'bar', 'compact'];
    case 'refrigerator':
      return ['standard', 'dial', 'compact'];
    case 'lock':
      return ['lock_switch', 'standard', 'compact'];
    case 'temperature_sensor':
    case 'battery_monitor':
    case 'solar_controller':
    case 'surge_protector':
      return ['standard', 'dial', 'bar', 'compact'];
    default:
      return ['standard', 'compact'];
  }
}

const hasHumidity = (d: Device) => d.values.some((v) => v.key === 'humidity');

/** What a style's gauge shows for a device, for the picker. */
function gaugeOf(d: Device, style: CardStyle): string | undefined {
  switch (d.class) {
    case 'temperature_sensor':
      return style === 'bar' && hasHumidity(d) ? 'humidity' : 'temperature';
    case 'liquid_level_sensor':
      return 'level';
    case 'battery_monitor':
      return 'charge';
    case 'solar_controller':
      return 'battery voltage';
    case 'refrigerator':
      return 'temperature';
    case 'surge_protector':
      return 'voltage';
    default:
      return undefined;
  }
}

export function cardStyleLabel(style: CardStyle, d: Device): string {
  const gauge = gaugeOf(d, style);
  switch (style) {
    case 'standard':
      return 'Text';
    case 'compact':
      return 'Compact (one line)';
    case 'propane_tank':
      return 'Propane tank';
    case 'liquid_tank':
      return 'Liquid tank';
    case 'lock_switch':
      return 'Lock switch';
    case 'dial':
      return gauge ? `Dial (${gauge})` : 'Dial';
    case 'bar':
      return gauge ? `Bar (${gauge})` : 'Bar';
  }
}

/** Default width: wide for the classes with a lot to show, and for one-line or switch cards. */
export function defaultCardWidth(d: Device, style: CardStyle): CardWidth {
  const wide: DeviceClass[] = ['refrigerator', 'solar_controller', 'battery_monitor', 'surge_protector'];
  return wide.includes(d.class) || style === 'compact' || style === 'lock_switch' ? 2 : 1;
}

// The range a temperature gauge spans when the device doesn't give one (from the MAUI app).
const TEMP_MIN_C = -10;
const TEMP_MAX_C = 45;

const scale = (v: unknown, min: number, max: number) =>
  typeof v !== 'number' || max <= min ? undefined : Math.min(1, Math.max(0, (v - min) / (max - min)));

/**
 * The 0..1 value a style's graphic shows, or undefined when there's no reading yet (the graphic is
 * then drawn empty). It is the primary value against the range the gateway gives for it; a
 * temperature sensor's bar shows humidity instead.
 */
export function cardFraction(d: Device, style: CardStyle): number | undefined {
  if (d.class === 'temperature_sensor' && style === 'bar' && hasHumidity(d))
    return scale(d.values.find((v) => v.key === 'humidity')?.value, 0, 100);
  const v = d.values.find((x) => x.primary) ?? d.values[0];
  if (!v) return undefined;
  if (v.min !== undefined && v.max !== undefined) return scale(v.value, v.min, v.max);
  if (v.unit === '%') return scale(v.value, 0, 100);
  if (v.unit === 'C') return scale(v.value, TEMP_MIN_C, TEMP_MAX_C);
  return undefined;
}
