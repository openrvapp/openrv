// Watches the gateway for alerts, the way the person chose in Settings:
//   live:     a foreground service keeps the app and its gateway connection running, reconnecting
//             when the gateway restarts or drops out of range; alerts notify within seconds.
//   periodic: Android runs a background check about every 15 minutes (also a fallback for live),
//             retrying for up to a minute if the gateway doesn't answer at first.
// Reconnecting follows one policy everywhere (features/reconnect.ts).
//   off:      nothing in the background; alerts notify only while the app is running.
// In every mode, alarm changes notify while the app is connected.
import * as BackgroundTask from 'expo-background-task';
import * as Linking from 'expo-linking';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { GatewayMonitor } from '../../../modules/gateway-monitor';
import { ensureNotificationPermission, notifyAlarms, setUpNotifications } from '@/features/monitoring/notify';
import { connectWithRetry, keepConnectedInBackground, watchedGateway } from '@/features/reconnect';
import { signalOf } from '@/format';
import { DEMO_GATEWAY_ID, useGateway } from '@/store/gateway';
import { useSettings, type Monitoring } from '@/store/settings';

const CHECK_TASK = 'openrv-alert-check';
const CHECK_MINUTES = 15;
/** How long a periodic check keeps trying to reach the gateway (Android gives it a few minutes at most). */
const CHECK_CONNECT_MS = 60_000;

/** Whether this phone can do live monitoring (Android, with the service in the build). */
export const LIVE_AVAILABLE = GatewayMonitor !== null;

/** Whether there is a real gateway to watch: monitoring has nothing to do for the demo or no gateway. */
export function watchingRealGateway(): boolean {
  return watchedGateway() !== undefined;
}

async function settingsLoaded(): Promise<void> {
  if (!useSettings.persist.hasHydrated()) await useSettings.persist.rehydrate();
}

// ---- Periodic check (runs without the app's screens, so it is defined at startup: index.ts) ----

/** One check: connect if needed, notify about alarms, and let go again unless something else needs the link. */
async function checkOnce(): Promise<void> {
  await settingsLoaded();
  const gatewayId = watchedGateway();
  if (useSettings.getState().monitoring === 'off' || !gatewayId) return;
  const gateway = useGateway.getState();
  if (gateway.connection === 'connecting') return;
  if (gateway.connection === 'connected') {
    await notifyAlarms(gateway.devices);
    return;
  }
  await connectWithRetry(gatewayId, CHECK_CONNECT_MS);
  await notifyAlarms(useGateway.getState().devices);
  if (AppState.currentState !== 'active' && useSettings.getState().monitoring !== 'live')
    await useGateway.getState().disconnect();
}

export function defineBackgroundCheck(): void {
  if (TaskManager.isTaskDefined(CHECK_TASK)) return;
  TaskManager.defineTask(CHECK_TASK, async () => {
    try {
      await checkOnce();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed; // out of range, most likely; try next time
    }
  });
}

async function setPeriodic(on: boolean): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(CHECK_TASK);
  if (on && !registered) await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: CHECK_MINUTES });
  if (!on && registered) await BackgroundTask.unregisterTaskAsync(CHECK_TASK);
}

// ---- Notifications while the app runs ----

let watching = false;
let pending: ReturnType<typeof setTimeout> | undefined;

function watchAlarms(): void {
  if (watching) return;
  watching = true;
  useGateway.subscribe((s, prev) => {
    if (s.devices === prev.devices || s.connection !== 'connected' || !s.devices.length) return;
    if (s.gatewayId === DEMO_GATEWAY_ID) return; // the demo's alarms aren't real
    clearTimeout(pending);
    pending = setTimeout(() => notifyAlarms(useGateway.getState().devices), 1000);
  });
}

// ---- Live monitoring ----

let unsubscribeLive: (() => void) | undefined;

function liveText(): string {
  const s = useGateway.getState();
  if (s.connection === 'connected') {
    const name = s.status?.name ?? s.hello?.name ?? 'the gateway';
    return s.rssi === undefined
      ? `Connected to ${name}`
      : `Connected to ${name} · signal ${signalOf(s.rssi).label} (${s.rssi} dBm)`;
  }
  if (s.connection === 'connecting') return 'Connecting to the gateway…';
  return 'Looking for the gateway: it may be out of range';
}

/** Where the ongoing notification's "Turn off" button goes: Settings, with "No monitoring" picked out. */
const turnOffUrl = () => Linking.createURL('/settings', { queryParams: { highlight: 'off' } });

function updateLiveNotification(): void {
  GatewayMonitor?.start('Watching your RV for alerts', liveText(), turnOffUrl()).catch(() => undefined);
}

async function startLive(): Promise<void> {
  if (!GatewayMonitor) return;
  await GatewayMonitor.start('Watching your RV for alerts', liveText(), turnOffUrl());
  if (unsubscribeLive) return;
  let shown: number | undefined;
  unsubscribeLive = useGateway.subscribe((s, prev) => {
    // The signal moves all the time: update for a new level, or a change of 3 dBm or more.
    const signalMoved =
      s.rssi !== shown &&
      (s.rssi === undefined ||
        shown === undefined ||
        Math.abs(s.rssi - shown) >= 3 ||
        signalOf(s.rssi).label !== signalOf(shown).label);
    if (s.connection === prev.connection && !signalMoved) return;
    shown = s.rssi;
    updateLiveNotification();
  });
  // Reconnects like the open app does, in the background too (features/reconnect.ts).
  keepConnectedInBackground(true);
}

async function stopLive(): Promise<void> {
  unsubscribeLive?.();
  unsubscribeLive = undefined;
  keepConnectedInBackground(false);
  await GatewayMonitor?.stop();
}

// ---- Choosing a mode ----

/**
 * Puts the chosen monitoring into effect. Call it while the app is in the foreground (Android
 * only lets a foreground service start from there): at launch, and when the setting changes.
 * Resolves to false when notifications aren't allowed.
 */
export async function applyMonitoring(mode: Monitoring): Promise<boolean> {
  if (Platform.OS === 'web') return false; // the web preview has no background work or notifications
  await setUpNotifications();
  watchAlarms();
  const allowed = await ensureNotificationPermission();
  const watched = watchedGateway() !== undefined;
  await setPeriodic(mode !== 'off' && allowed).catch(() => undefined);
  if (mode === 'live' && allowed && watched) await startLive();
  else await stopLive();
  return allowed;
}
