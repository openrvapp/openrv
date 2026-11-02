import { PermissionsAndroid, Platform } from 'react-native';

import { askInTurn } from '@/permissions';
import { BleNitro, type AsyncSubscription } from 'react-native-ble-nitro';

import type { Transport } from '@/protocol/client';

export const SERVICE_UUID = '6f70656e-7276-4000-8000-000000000001';
const RX_UUID = '6f70656e-7276-4000-8000-000000000002';
const TX_UUID = '6f70656e-7276-4000-8000-000000000003';
const REQUESTED_MTU = 517;

const ble = () => BleNitro.instance();

export interface FoundGateway {
  id: string;
  name: string;
  rssi: number | null;
}

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];
  const held = await Promise.all(wanted.map((p) => PermissionsAndroid.check(p)));
  if (held.every(Boolean)) return true;
  const result = await askInTurn(() => PermissionsAndroid.requestMultiple(wanted));
  return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
}

/** Scans for OpenRV gateways until the returned stop function is called. */
export function scanForGateways(onFound: (g: FoundGateway) => void, onError: (e: Error) => void): () => void {
  ble().startScan(
    { serviceUUIDs: [SERVICE_UUID], allowDuplicates: false },
    (device) => onFound({ id: device.id, name: device.name || 'OpenRV gateway', rssi: device.rssi ?? null }),
    (error) => onError(new Error(error.message)),
  );
  return () => ble().stopScan();
}

export class BleTransport implements Transport {
  private readonly packetHandlers = new Set<(p: Uint8Array) => void>();
  private readonly closeHandlers = new Set<(e?: Error) => void>();
  private subscription?: AsyncSubscription;

  private constructor(
    private readonly id: string,
    readonly packetSize: number,
  ) {}

  static async connect(id: string): Promise<BleTransport> {
    let transport: BleTransport | undefined;
    await ble().connect(id, (_id, interrupted, error) => {
      transport?.closeHandlers.forEach((h) =>
        h(interrupted ? new Error(error?.message ?? 'Connection lost') : undefined),
      );
    });
    const mtu = await ble().requestMTU(id, REQUESTED_MTU);
    await ble().discoverServices(id);
    // 512 is the longest attribute value BLE allows, even when the MTU would fit more.
    transport = new BleTransport(id, Math.min(512, Math.max(20, mtu - 3)));
    const t = transport;
    t.subscription = await ble().subscribeToCharacteristic(id, SERVICE_UUID, TX_UUID, (_char, data) => {
      const packet = new Uint8Array(data);
      t.packetHandlers.forEach((h) => h(packet));
    });
    return t;
  }

  async write(packet: Uint8Array): Promise<void> {
    await ble().writeCharacteristic(this.id, SERVICE_UUID, RX_UUID, Array.from(packet), true);
  }

  onPacket(handler: (p: Uint8Array) => void): () => void {
    this.packetHandlers.add(handler);
    return () => this.packetHandlers.delete(handler);
  }

  onClose(handler: (e?: Error) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  readRssi(): Promise<number> {
    return ble().readRSSI(this.id);
  }

  async close(): Promise<void> {
    await this.subscription?.remove().catch(() => undefined);
    await ble()
      .disconnect(this.id)
      .catch(() => undefined);
  }
}
