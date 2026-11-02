// The web preview has no Bluetooth; it runs against the demo gateway only.
import type { Transport } from '@/protocol/client';

export interface FoundGateway {
  id: string;
  name: string;
  rssi: number | null;
}

export async function requestBlePermissions(): Promise<boolean> {
  return true; // so the screen reports that Bluetooth is missing, not a permission
}

export function scanForGateways(_onFound: (g: FoundGateway) => void, onError: (e: Error) => void): () => void {
  onError(new Error('Bluetooth is not available in the web preview.'));
  return () => undefined;
}

export const GatewayTransport = {
  connect(_id: string): Promise<Transport> {
    return Promise.reject(new Error('Bluetooth is not available in the web preview.'));
  },
};
