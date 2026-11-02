// The dashboard as one phone arranges it for one gateway: which cards show, in what order, and how
// each looks. The gateway keeps the devices themselves; this is only how this phone shows them.
import type { Device, DiscoveredDevice, Hello } from '@/protocol/types';
import type { CardStyle, CardWidth } from '@/store/settings';

export interface Layout {
  /** Shown at the top of the dashboard; unset = the default. */
  title?: string;
  /** Device ids in dashboard order; devices not listed follow in the gateway's order. */
  order: string[];
  /** Device ids left off the dashboard. */
  hidden: string[];
  styles: Record<string, CardStyle>;
  widths: Record<string, CardWidth>;
}

export const EMPTY_LAYOUT: Layout = { order: [], hidden: [], styles: {}, widths: {} };

/** Which gateway a layout belongs to: its Bluetooth address, or the connection's id before it says. */
export function layoutKey(hello: Pick<Hello, 'mac'> | undefined, gatewayId: string | undefined): string | undefined {
  return hello?.mac?.toUpperCase() ?? gatewayId;
}

/**
 * Devices in the order arranged on this phone. Devices the order doesn't mention (newly added)
 * follow in the gateway's order.
 */
export function applyOrder(devices: Device[], order: string[]): Device[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return devices
    .map((d, i) => ({ d, r: rank.get(d.id) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.d);
}

/** The cards on the dashboard, in order. New devices show until someone hides them. */
export function shownDevices(devices: Device[], layout: Layout): Device[] {
  const hidden = new Set(layout.hidden);
  return applyOrder(devices, layout.order).filter((d) => !hidden.has(d.id));
}

/** Devices on the gateway without a card on this phone's dashboard. */
export function hiddenDevices(devices: Device[], layout: Layout): Device[] {
  const hidden = new Set(layout.hidden);
  return applyOrder(devices, layout.order).filter((d) => hidden.has(d.id));
}

/** The order to save after cards were dragged into `shown` order; hidden cards keep their places after. */
export function orderAfterDrag(shown: Device[], layout: Layout): string[] {
  return [...shown.map((d) => d.id), ...layout.hidden];
}

export interface DiscoverySections {
  /** Devices a driver on the gateway recognized: ready to add. */
  recognized: DiscoveredDevice[];
  /** Everything else with a name, in case the person picks the model by hand. */
  other: DiscoveredDevice[];
}

/**
 * Nearby devices for the Add device list, without those already on the gateway: recognized ones
 * first, each group strongest signal (nearest) first.
 */
export function discoverySections(found: DiscoveredDevice[], devices: Device[]): DiscoverySections {
  const added = new Set(devices.map((d) => d.mac.toUpperCase()));
  const fresh = found.filter((d) => !d.added && !added.has(d.mac.toUpperCase())).sort((a, b) => b.rssi - a.rssi);
  return { recognized: fresh.filter((d) => d.type), other: fresh.filter((d) => !d.type) };
}
