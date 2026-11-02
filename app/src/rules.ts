import { formatValue } from '@/format';
import type { Device, Rule } from '@/protocol/types';
import type { TemperatureUnit } from '@/store/settings';

/** "Level below 20 %", "Temperature above 44.6 °F", "Level outside 10 % – 90 %". */
export function describeRule(rule: Rule, device: Device, unit: TemperatureUnit): string {
  const value = device.values.find((v) => v.key === rule.value);
  const label = value?.label ?? rule.value;
  const fmt = (n: number) => (value ? formatValue({ ...value, value: n }, unit) : String(n));
  const below = rule.below ?? undefined;
  const above = rule.above ?? undefined;
  if (below !== undefined && above !== undefined) return `${label} outside ${fmt(below)} – ${fmt(above)}`;
  if (below !== undefined) return `${label} below ${fmt(below)}`;
  if (above !== undefined) return `${label} above ${fmt(above)}`;
  return label;
}

/** A rule id unique on this gateway, from the device id and label. */
export function newRuleId(deviceId: string, label: string, taken: string[]): string {
  const base = `${deviceId}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '').slice(0, 20);
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
