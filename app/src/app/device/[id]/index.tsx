import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, List, Text, useTheme } from 'react-native-paper';

import { AlarmChips } from '@/components/AlarmChips';
import { ControlView } from '@/components/ControlView';
import { DeviceCard } from '@/components/DeviceCard';
import { BatteryIndicator } from '@/components/Indicators';
import { CLASS_NAMES } from '@/deviceClasses';
import { formatAge, formatValue, wholeDegrees } from '@/format';
import { useDeviceAction } from '@/hooks/useDeviceAction';
import type { Device } from '@/protocol/types';
import { useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';

export default function DeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useGateway((s) => s.devices.find((d) => d.id === id));

  if (!device) {
    return (
      <View style={styles.center}>
        <Text>This device isn't on the gateway any more.</Text>
      </View>
    );
  }
  return <DeviceDetails device={device} />;
}

function DeviceDetails({ device }: { device: Device }) {
  const theme = useTheme();
  const unit = useSettings((s) => s.temperatureUnit);
  const { run, pending } = useDeviceAction(device);
  const busy = pending !== undefined || !!device.status.busy;
  // A lock's action is its card's switch; the other controls are listed here.
  const settable = device.controls.filter((c) => !(device.class === 'lock' && c.kind === 'action'));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: device.name }} />
      <View style={styles.cardRow}>
        <DeviceCard device={device} onPress={() => run('refresh')} />
      </View>
      <AlarmChips alarms={device.alarms} />

      {settable.length > 0 && (
        <List.Section title="Controls">
          {settable.map((c) => (
            <ControlView key={c.key} control={c} busy={busy} onAction={(action, values) => run(action, values, c)} />
          ))}
        </List.Section>
      )}

      <List.Section title="Readings">
        {wholeDegrees(device, unit).values.map((v) => (
          <List.Item
            key={v.key}
            title={v.label}
            right={() =>
              v.unit === '%' && (v.key === 'battery' || v.key === 'battery_pct') ? (
                <BatteryIndicator percent={typeof v.value === 'number' ? v.value : null} />
              ) : (
                <Text variant="bodyLarge">{formatValue(v, unit)}</Text>
              )
            }
          />
        ))}
        <List.Item
          title="Last heard"
          description={`${device.model} · ${CLASS_NAMES[device.class] ?? device.class}`}
          right={() => (
            <Text
              variant="bodyLarge"
              style={{ color: device.status.online ? theme.colors.onSurface : theme.colors.error }}
            >
              {device.status.online ? formatAge(device.status.age_s) : 'Offline'}
            </Text>
          )}
        />
      </List.Section>
      <Divider />

      <View style={styles.buttons}>
        <Button
          mode="contained-tonal"
          icon="bell-outline"
          style={styles.button}
          onPress={() => router.push({ pathname: '/device/[id]/alerts', params: { id: device.id } })}
        >
          Alerts
        </Button>
        <Button
          mode="contained-tonal"
          icon="cog-outline"
          style={styles.button}
          onPress={() => router.push({ pathname: '/device/[id]/settings', params: { id: device.id } })}
        >
          Settings
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 8, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  cardRow: { flexDirection: 'row' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  button: { flex: 1 },
});
