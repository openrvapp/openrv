import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

interface GatewayWifiModule {
  /** Joins the gateway's update Wi-Fi (Android or iOS asks the user once); resolves when it's up. */
  join(ssid: string, password: string, timeoutMs: number): Promise<void>;
  /** POSTs a file over that Wi-Fi only; resolves with the HTTP status. */
  upload(url: string, token: string, fileUri: string): Promise<number>;
  /** Lets go of the network; the phone's normal Wi-Fi is never affected. */
  release(): Promise<void>;
}

const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<GatewayWifiModule>('GatewayWifi');

/** Null where the app can't join Wi-Fi itself (web, older builds): it installs over Bluetooth instead. */
export const GatewayWifi: GatewayWifiModule | null = native;
