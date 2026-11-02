import {
  applyOrder,
  discoverySections,
  EMPTY_LAYOUT,
  hiddenDevices,
  layoutKey,
  orderAfterDrag,
  shownDevices,
  type Layout,
} from '../dashboardLayout';
import type { Device, DiscoveredDevice } from '../protocol/types';

const dev = (id: string, mac = `00:00:00:00:00:${id.toUpperCase().padStart(2, '0')}`) => ({ id, mac }) as Device;
const ids = (devices: Device[]) => devices.map((d) => d.id);
const layout = (l: Partial<Layout>): Layout => ({ ...EMPTY_LAYOUT, ...l });

describe('dashboard layout', () => {
  const devices = [dev('a'), dev('b'), dev('c'), dev('d')];

  it('puts arranged devices first and new ones after, in gateway order', () => {
    expect(ids(applyOrder(devices, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(applyOrder([dev('a'), dev('b')], ['gone', 'b']))).toEqual(['b', 'a']);
  });

  it('shows every device until it is hidden', () => {
    const l = layout({ order: ['c', 'a'], hidden: ['a'] });
    expect(ids(shownDevices(devices, l))).toEqual(['c', 'b', 'd']);
    expect(ids(hiddenDevices(devices, l))).toEqual(['a']);
  });

  it('saves the dragged order of the shown cards and keeps hidden ones after', () => {
    const l = layout({ hidden: ['b'] });
    // Shown: a, c, d. Drag d to the top.
    const order = orderAfterDrag([dev('d'), dev('a'), dev('c')], l);
    expect(order).toEqual(['d', 'a', 'c', 'b']);
    expect(ids(shownDevices(devices, layout({ ...l, order })))).toEqual(['d', 'a', 'c']);
  });

  it('keys a layout by the gateway Bluetooth address when it gives one', () => {
    expect(layoutKey({ mac: 'aa:bb:cc:dd:ee:ff' }, 'some-uuid')).toBe('AA:BB:CC:DD:EE:FF');
    expect(layoutKey({}, 'C4:12:34:56:78:9A')).toBe('C4:12:34:56:78:9A');
    expect(layoutKey(undefined, undefined)).toBeUndefined();
  });
});

describe('add device list', () => {
  const found = (mac: string, rssi: number, extra: Partial<DiscoveredDevice> = {}): DiscoveredDevice => ({
    mac,
    rssi,
    ...extra,
  });

  it('puts devices the gateway can read first, each group nearest first, without ones already added', () => {
    const onGateway = [dev('fridge', '49:22:01:AB:CD:01')];
    const { recognized, other } = discoverySections(
      [
        found('CA:6A:10:1C:EC:CD', -83, { name: 'MyQ' }),
        found('49:23:04:08:08:0F', -48, { type: 'inkbird_ibs_th2' }),
        found('7C:11:22:33:44:55', -55, { name: 'Buds' }),
        found('D4:1A:9E:00:00:02', -77, { type: 'mopeka_pro' }),
        found('F6:71:1E:48:0D:10', -63, { type: 'mopeka_pro' }),
        found('49:22:01:ab:cd:01', -60, { type: 'inkbird_ibs_th2' }), // already on the gateway
        found('11:22:33:44:55:66', -40, { type: 'mopeka_pro', added: true }),
      ],
      onGateway,
    );
    expect(recognized.map((d) => d.mac)).toEqual(['49:23:04:08:08:0F', 'F6:71:1E:48:0D:10', 'D4:1A:9E:00:00:02']);
    expect(other.map((d) => d.mac)).toEqual(['7C:11:22:33:44:55', 'CA:6A:10:1C:EC:CD']);
  });
});
