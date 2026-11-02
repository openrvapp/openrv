import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

interface GatewayPairingModule {
  /** Pairs afresh with a device by its Bluetooth address (forgetting a stale bond first); false if Android wouldn't. */
  createBond(address: string): Promise<boolean>;
  /** Forgets the phone's pairing with a device; true when it has none left. */
  forgetBond(address: string): Promise<boolean>;
  /** Whether the phone has a pairing with a device. */
  isBonded(address: string): boolean;
}

/** Null where the app can't start pairing itself (iOS, web, older builds): the gateway asks instead. */
export const GatewayPairing: GatewayPairingModule | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<GatewayPairingModule>('GatewayPairing') : null;
