import type { Alarm, Device } from '../../../protocol/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  dismissNotificationAsync: jest.fn(async () => undefined),
}));

const Notifications = jest.requireMock('expo-notifications');
const { notifyAlarms } = require('../notify') as typeof import('../notify');

const lowLevel = (state: Alarm['state'] = 'low', severity: Alarm['severity'] = 'warning'): Alarm => ({
  rule: 'lp-low',
  device: 'lp',
  key: 'level',
  state,
  severity,
  label: 'Low',
  value: 14,
});

const tank = (alarms: Alarm[] = []): Device =>
  ({
    id: 'lp',
    type: 'mopeka_pro',
    class: 'liquid_level_sensor',
    model: 'Mopeka Pro Check',
    name: 'Rear LP',
    mac: '',
    status: { online: true },
    values: [{ key: 'level', label: 'Level', unit: '%', value: 14, decimals: 0, primary: true }],
    controls: [],
    alarms,
  }) as Device;

const shown = () => Notifications.scheduleNotificationAsync.mock.calls.map(([n]: [any]) => n);

beforeEach(() => Notifications.scheduleNotificationAsync.mockClear());

describe('alert notifications', () => {
  it('notifies once about a new alarm, with the reading', async () => {
    await notifyAlarms([tank([lowLevel()])]);
    await notifyAlarms([tank([lowLevel()])]);
    expect(shown()).toHaveLength(1);
    expect(shown()[0].content.title).toBe('Rear LP: Low');
    expect(shown()[0].content.body).toBe('Level 14%');
    expect(shown()[0].content.data).toEqual({ deviceId: 'lp' });
  });

  it('notifies again when the alarm gets more severe', async () => {
    await notifyAlarms([tank([lowLevel('low', 'critical')])]);
    expect(shown()).toHaveLength(1);
    expect(shown()[0].trigger).toBeNull(); // channels are Android's; tests run as iOS
  });

  it('says when the alarm clears, and removes its notification', async () => {
    await notifyAlarms([tank([])]);
    expect(shown()).toHaveLength(1);
    expect(shown()[0].content.title).toBe('Rear LP: back to normal');
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('lp/lp-low');
    await notifyAlarms([tank([])]);
    expect(shown()).toHaveLength(1);
  });

  it('stays quiet when notifications are blocked', async () => {
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    await notifyAlarms([tank([lowLevel()])]);
    expect(shown()).toHaveLength(0);
  });
});
