import type { Device, Value } from '@/protocol/types';
import type { TemperatureUnit } from '@/store/settings';

/** A value in the user's preferred units, e.g. "62%", "35°F", "12.9 V", or "—". */
export function formatValue(v: Value, temperatureUnit: TemperatureUnit): string {
  if (v.value === null || v.value === undefined) return '—';
  if (typeof v.value === 'boolean') return v.value ? 'On' : 'Off';
  if (typeof v.value === 'string') return capitalize(v.value.replace(/_/g, ' '));

  if (isTemperature(v.unit)) return formatTemperature(v.value, temperatureUnit, v.decimals ?? 1);
  const text = v.value.toFixed(v.decimals ?? 1);
  const unit = v.unit;
  if (!unit) return text;
  // As the MAUI app wrote them: 38.5°F, 62%, 12.9 V.
  if (unit === '%') return `${text}%`;
  return `${text} ${unit}`;
}

// The gateway sends every temperature in Celsius; only the app shows another unit.

export function isTemperature(unit: string | undefined): boolean {
  return unit === 'C';
}

/** A Celsius temperature in the display unit. */
export function toDisplayTemperature(c: number, unit: TemperatureUnit): number {
  return unit === 'F' ? (c * 9) / 5 + 32 : c;
}

/** A temperature typed in the display unit, back in Celsius for the gateway. */
export function fromDisplayTemperature(t: number, unit: TemperatureUnit): number {
  return unit === 'F' ? ((t - 32) * 5) / 9 : t;
}

/** "38.5°F" from a Celsius value. */
export function formatTemperature(c: number, unit: TemperatureUnit, decimals = 1): string {
  return `${toDisplayTemperature(c, unit).toFixed(decimals)}°${unit}`;
}

/** The unit a value shows in: the user's temperature unit for temperatures, otherwise its own. */
export function displayUnit(unit: string | undefined, temperatureUnit: TemperatureUnit): string {
  if (isTemperature(unit)) return `°${temperatureUnit}`;
  return unit ?? '';
}

/**
 * A fridge set to °F works in whole degrees (its setpoint step is 5/9 °C), and the gateway sends
 * them as Celsius with a decimal; shown in °F they go back to whole degrees.
 */
export function wholeDegrees(device: Device, unit: TemperatureUnit): Device {
  const step = device.controls.find((c) => c.kind === 'number' && isTemperature(c.unit));
  const fahrenheitSteps = step?.kind === 'number' && Math.abs((step.step ?? 1) - 5 / 9) < 0.01;
  if (device.class !== 'refrigerator' || unit !== 'F' || !fahrenheitSteps) return device;
  return { ...device, values: device.values.map((v) => (isTemperature(v.unit) ? { ...v, decimals: 0 } : v)) };
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function primaryValue(device: Device): Value | undefined {
  return device.values.find((v) => v.primary) ?? device.values[0];
}

/** "just now", "4 min ago", "2 h ago", or "never". */
export function formatAge(ageS: number | null | undefined): string {
  if (ageS === null || ageS === undefined) return 'never';
  if (ageS < 60) return 'just now';
  if (ageS < 3600) return `${Math.round(ageS / 60)} min ago`;
  if (ageS < 86400) return `${Math.round(ageS / 3600)} h ago`;
  return `${Math.round(ageS / 86400)} d ago`;
}

export interface Signal {
  /** 0 (weak) to 3 (excellent). */
  bars: 0 | 1 | 2 | 3;
  label: 'excellent' | 'good' | 'fair' | 'weak';
  icon: 'signal-cellular-3' | 'signal-cellular-2' | 'signal-cellular-1' | 'signal-cellular-outline';
}

/** How good a Bluetooth signal is, from its strength in dBm. */
export function signalOf(rssi: number): Signal {
  if (rssi >= -60) return { bars: 3, label: 'excellent', icon: 'signal-cellular-3' };
  if (rssi >= -75) return { bars: 2, label: 'good', icon: 'signal-cellular-2' };
  if (rssi >= -88) return { bars: 1, label: 'fair', icon: 'signal-cellular-1' };
  return { bars: 0, label: 'weak', icon: 'signal-cellular-outline' };
}
