// App-only preferences that apply to every gateway: theme, units, alert monitoring and firmware
// updates. Each gateway's dashboard layout is in store/layouts.ts; the devices themselves, their
// names, settings and alert rules live on the gateway.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark' | 'night';
export type TemperatureUnit = 'C' | 'F';
/**
 * How the app watches for alerts when it isn't open: live (a foreground service keeps the gateway
 * connected), periodic (a background check about every 15 minutes), or off (only while it's open).
 */
export type Monitoring = 'live' | 'periodic' | 'off';
export type CardStyle = 'standard' | 'compact' | 'dial' | 'bar' | 'propane_tank' | 'liquid_tank' | 'lock_switch';
/** Dashboard columns a card spans. */
export type CardWidth = 1 | 2;

interface SettingsState {
  theme: ThemePreference;
  temperatureUnit: TemperatureUnit;
  lastGatewayId?: string;
  autoDownloadFirmware: boolean;
  monitoring: Monitoring;
  /** Warn when leaving the app with monitoring off; cleared by "Don't warn me again". */
  warnOnExit: boolean;
  ignoredFirmware?: string;
  lastFirmwareCheck?: number;

  set(changes: Partial<Omit<SettingsState, 'set'>>): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      temperatureUnit: 'F',
      autoDownloadFirmware: true,
      monitoring: 'periodic',
      warnOnExit: true,
      set: (changes) => set(changes),
    }),
    {
      name: 'openrv-settings',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
    },
  ),
);
