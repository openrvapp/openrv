import { cardFraction, cardStyles, deviceIcon } from '../deviceClasses';
import type { Device, DeviceClass, Value } from '../protocol/types';

const device = (cls: DeviceClass, values: Value[], traits?: Device['traits']) =>
  ({
    id: 'd',
    type: 'any_maker',
    class: cls,
    model: 'Any',
    name: 'D',
    mac: '',
    traits,
    values,
    controls: [],
    status: { online: true },
  }) as Device;

describe('device classes', () => {
  it('draws every device of a class the same, whatever its maker', () => {
    const a = device('temperature_sensor', [{ key: 'temp', label: 'T', unit: 'C', value: 20, primary: true }]);
    const b = { ...a, type: 'another_maker', model: 'Other' };
    expect(cardStyles(b)).toEqual(cardStyles(a));
    expect(deviceIcon(b)).toBe(deviceIcon(a));
  });

  it('picks the tank graphic from the fluid', () => {
    const level: Value[] = [{ key: 'level', label: 'Level', unit: '%', value: 50, min: 0, max: 100, primary: true }];
    expect(cardStyles(device('liquid_level_sensor', level, { fluid: 'propane' }))[0]).toBe('propane_tank');
    expect(cardStyles(device('liquid_level_sensor', level, { fluid: 'fresh_water' }))[0]).toBe('liquid_tank');
  });

  it('fills gauges from the range the gateway gives', () => {
    const surge = device('surge_protector', [
      { key: 'voltage_v', label: 'V', unit: 'V', value: 120, min: 100, max: 140, primary: true },
    ]);
    expect(cardFraction(surge, 'dial')).toBeCloseTo(0.5);
    const empty = device('battery_monitor', [
      { key: 'soc', label: 'Charge', unit: '%', value: null, min: 0, max: 100, primary: true },
    ]);
    expect(cardFraction(empty, 'bar')).toBeUndefined();
  });

  it('shows a temperature sensor bar as humidity when it has it', () => {
    const t = device('temperature_sensor', [
      { key: 'temp', label: 'T', unit: 'C', value: 20, primary: true },
      { key: 'humidity', label: 'H', unit: '%', value: 40 },
    ]);
    expect(cardFraction(t, 'bar')).toBeCloseTo(0.4);
  });

  it('copes with a class newer than the app', () => {
    const future = device('water_heater' as DeviceClass, []);
    expect(cardStyles(future)).toEqual(['standard', 'compact']);
    expect(deviceIcon(future)).toBe('devices');
  });
});
