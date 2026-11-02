// Turns the gateway's alarms into phone notifications: one when an alarm starts or changes, one
// when it clears. What has been shown is kept in storage, so a background check that sees the same
// alarm again stays quiet, and so does the next app launch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { formatValue } from '@/format';
import { askInTurn } from '@/permissions';
import type { Alarm, Device, Severity } from '@/protocol/types';
import { useSettings } from '@/store/settings';

const SHOWN_KEY = 'openrv-alert-notifications';

/** Android channels, so people can tune each severity in the system settings. */
const CHANNELS: Record<
  Severity | 'cleared' | 'reminders',
  { name: string; importance: Notifications.AndroidImportance }
> = {
  critical: { name: 'Critical alerts', importance: Notifications.AndroidImportance.MAX },
  warning: { name: 'Warnings', importance: Notifications.AndroidImportance.HIGH },
  info: { name: 'Information', importance: Notifications.AndroidImportance.DEFAULT },
  cleared: { name: 'Alerts cleared', importance: Notifications.AndroidImportance.LOW },
  reminders: { name: 'Monitoring reminders', importance: Notifications.AndroidImportance.DEFAULT },
};

/** Alarm state last notified, by "device/rule". */
type Shown = Record<string, { state: Alarm['state']; severity: Severity }>;

let ready: Promise<void> | undefined;

/** Sets up the channels and how notifications show while the app is open. Safe to call often. */
export function setUpNotifications(): Promise<void> {
  ready ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      for (const [id, { name, importance }] of Object.entries(CHANNELS)) {
        await Notifications.setNotificationChannelAsync(id, {
          name,
          importance,
          lightColor: '#006A6A',
          vibrationPattern: id === 'critical' ? [0, 400, 200, 400] : undefined,
        });
      }
    }
  })();
  return ready;
}

/** Whether the app may notify; asks once when it hasn't been asked. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await askInTurn(() => Notifications.requestPermissionsAsync())).granted;
}

export async function notificationsAllowed(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/** "Level 14%": the watched reading, in the user's units, when the device still reports it. */
function reading(device: Device | undefined, alarm: Alarm): string | undefined {
  const value = device?.values.find((v) => v.key === alarm.key);
  if (!value) return undefined;
  const v = alarm.value !== undefined && alarm.value !== null ? { ...value, value: alarm.value } : value;
  return `${value.label} ${formatValue(v, useSettings.getState().temperatureUnit)}`;
}

let running = Promise.resolve();

/**
 * Notifies about alarms that are new or changed since last time, and about alarms that cleared.
 * Calls are queued, so overlapping updates can't notify twice.
 */
export function notifyAlarms(devices: Device[]): Promise<void> {
  running = running.then(() => update(devices)).catch(() => undefined);
  return running;
}

async function update(devices: Device[]): Promise<void> {
  if (!(await notificationsAllowed())) return;
  await setUpNotifications();
  const shown: Shown = JSON.parse((await AsyncStorage.getItem(SHOWN_KEY)) ?? '{}');
  const active = new Map<string, { alarm: Alarm; device: Device }>();
  for (const device of devices)
    for (const alarm of device.alarms ?? [])
      if (alarm.state !== 'normal') active.set(`${device.id}/${alarm.rule}`, { alarm, device });

  for (const [id, { alarm, device }] of active) {
    const before = shown[id];
    if (before && before.state === alarm.state && before.severity === alarm.severity) continue;
    const detail = reading(device, alarm);
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: `${device.name}: ${alarm.label}`,
        body: detail ?? `${alarm.severity === 'critical' ? 'Critical alert' : 'Alert'} from ${device.name}`,
        data: { deviceId: device.id },
        sound: alarm.severity === 'info' ? undefined : 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: alarm.severity } : null,
    });
    shown[id] = { state: alarm.state, severity: alarm.severity };
  }

  for (const id of Object.keys(shown)) {
    if (active.has(id)) continue;
    delete shown[id];
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
    const deviceId = id.slice(0, id.indexOf('/'));
    const device = devices.find((d) => d.id === deviceId);
    if (!device) continue; // removed from the gateway, not cleared
    await Notifications.scheduleNotificationAsync({
      identifier: `${id}/cleared`,
      content: {
        title: `${device.name}: back to normal`,
        body: 'The alert has cleared.',
        data: { deviceId },
      },
      trigger: Platform.OS === 'android' ? { channelId: 'cleared' } : null,
    });
  }
  await AsyncStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
}

/** A reminder, when leaving the app, that it won't notify about alerts until it's opened again. */
export async function notifyMonitoringOff(): Promise<void> {
  if (!(await notificationsAllowed())) return;
  await setUpNotifications();
  await Notifications.scheduleNotificationAsync({
    identifier: 'monitoring-off',
    content: {
      title: 'OpenRV is not watching for alerts',
      body: "Monitoring is off, so you won't hear about alerts until you open the app. Tap to turn it on.",
      data: { open: 'monitoring' },
    },
    trigger: Platform.OS === 'android' ? { channelId: 'reminders' } : null,
  });
}

/** Where a tapped notification should open: a device, or the monitoring setting. */
export function destinationOf(
  response: Notifications.NotificationResponse | null,
): { deviceId: string } | { settings: 'monitoring' } | undefined {
  const data = response?.notification.request.content.data;
  if (data?.open === 'monitoring') return { settings: 'monitoring' };
  return typeof data?.deviceId === 'string' ? { deviceId: data.deviceId } : undefined;
}
