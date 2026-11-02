import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

interface GatewayMonitorModule {
  /**
   * Starts (or updates) the foreground service that keeps the app running while it watches the
   * gateway, with its ongoing notification. Call while the app is in the foreground.
   */
  start(title: string, text: string, offUrl?: string): Promise<void>;
  /** Stops the service and removes its notification. */
  stop(): Promise<void>;
  isRunning(): boolean;
  /** Resolves after `ms`, even in the background, where React Native pauses setTimeout. */
  wait(ms: number): Promise<void>;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<GatewayMonitorModule>('GatewayMonitor') : null;

/** Null where there are no foreground services (iOS, web, older builds): live monitoring isn't offered. */
export const GatewayMonitor: GatewayMonitorModule | null = native;
