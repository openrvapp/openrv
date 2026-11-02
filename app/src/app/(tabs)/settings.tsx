import Constants from 'expo-constants';
import { router, Tabs, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Divider, List, SegmentedButtons, Switch, useTheme } from 'react-native-paper';

import { LogoMark } from '@/components/Logo';
import { SignalBadge } from '@/components/SignalBadge';
import { MonitoringSettings } from '@/components/MonitoringSettings';
import { signalOf } from '@/format';
import { askPin, toast } from '@/store/dialogs';
import { useGateway, useIsOwner } from '@/store/gateway';
import { useSettings, type TemperatureUnit, type ThemePreference } from '@/store/settings';

export default function SettingsScreen() {
  const theme = useTheme();
  const settings = useSettings();
  const connection = useGateway((s) => s.connection);
  const hello = useGateway((s) => s.hello);
  const status = useGateway((s) => s.status);
  const owner = useIsOwner();
  const rssi = useGateway((s) => s.rssi);
  const signal = rssi === undefined ? undefined : `${signalOf(rssi).label} (${rssi} dBm)`;
  const disconnect = useGateway((s) => s.disconnect);
  const authenticate = useGateway((s) => s.authenticate);
  // Opened from a notification: "off" picks out No monitoring, "monitoring" the whole choice.
  const { highlight } = useLocalSearchParams<{ highlight?: 'off' | 'monitoring' }>();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const monitoringY = useRef(0);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => scroll.current?.scrollTo({ y: monitoringY.current, animated: true }), 300);
    return () => clearTimeout(timer);
  }, [highlight]);

  const signIn = async () => {
    const pin = await askPin('Unlock gateway settings');
    if (pin)
      await authenticate(pin).then(
        () => toast('PIN accepted'),
        () => toast('Wrong PIN'),
      );
  };

  return (
    <ScrollView ref={scroll}>
      <Tabs.Screen options={{ headerRight: () => <SignalBadge /> }} />
      <List.Section title="Gateway">
        {connection === 'connected' && hello ? (
          <>
            <List.Item
              title={status?.name ?? hello.name}
              description={`Firmware ${hello.fw}${owner ? '' : ' · you are a guest'}${signal ? ` · signal ${signal}` : ''}`}
              left={(p) => <List.Icon {...p} icon="router-wireless" color={theme.colors.primary} />}
            />
            {hello.auth.pin_set && !hello.auth.ok && (
              <List.Item
                title="Enter PIN"
                description="Needed for actions such as unlocking"
                left={(p) => <List.Icon {...p} icon="key" />}
                onPress={signIn}
              />
            )}
            <List.Item
              title="Phones"
              description={owner ? 'Who can use this gateway' : 'Only owners can manage phones'}
              left={(p) => <List.Icon {...p} icon="cellphone-key" />}
              onPress={owner ? () => router.push('/gateway/phones') : undefined}
              disabled={!owner}
            />
            {owner && (
              <List.Item
                title="Firmware update"
                left={(p) => <List.Icon {...p} icon="update" />}
                onPress={() => router.push('/gateway/firmware')}
              />
            )}
            <List.Item
              title="Disconnect"
              left={(p) => <List.Icon {...p} icon="link-off" />}
              onPress={() => {
                settings.set({ lastGatewayId: undefined });
                disconnect();
              }}
            />
          </>
        ) : (
          <List.Item
            title="Connect to a gateway"
            left={(p) => <List.Icon {...p} icon="bluetooth-connect" />}
            onPress={() => router.push('/gateway/connect')}
          />
        )}
        <List.Item
          title="Status light and button"
          description="What the gateway's light and BOOT button mean"
          left={(p) => <List.Icon {...p} icon="led-on" />}
          onPress={() => router.push('/gateway/light')}
        />
      </List.Section>
      <Divider />

      <List.Section title="Appearance">
        <View style={styles.block}>
          <List.Subheader style={styles.sub}>Theme</List.Subheader>
          <SegmentedButtons
            value={settings.theme}
            onValueChange={(v) => settings.set({ theme: v as ThemePreference })}
            buttons={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'night', label: 'Night' },
            ]}
          />
          <List.Subheader style={styles.sub}>Temperature</List.Subheader>
          <SegmentedButtons
            value={settings.temperatureUnit}
            onValueChange={(v) => settings.set({ temperatureUnit: v as TemperatureUnit })}
            buttons={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
          />
        </View>
      </List.Section>
      <Divider />

      <View onLayout={(e) => (monitoringY.current = e.nativeEvent.layout.y)}>
        <MonitoringSettings highlight={highlight} />
      </View>
      <Divider />

      <List.Section title="Firmware">
        <List.Item
          title="Download new firmware automatically"
          description="Checks GitHub every 12 hours, so the update is on the phone when you're at the RV"
          descriptionNumberOfLines={3}
          right={() => (
            <Switch
              value={settings.autoDownloadFirmware}
              onValueChange={(v) => settings.set({ autoDownloadFirmware: v })}
            />
          )}
        />
      </List.Section>
      <Divider />

      <List.Section title="About">
        <List.Item
          title="OpenRV"
          description={`App ${Constants.expoConfig?.version ?? ''}`}
          left={(p) => (
            <View style={[p.style, styles.aboutLogo]}>
              <LogoMark size={36} />
            </View>
          )}
        />
      </List.Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 16, gap: 4, paddingBottom: 8 },
  sub: { paddingHorizontal: 0 },
  aboutLogo: { justifyContent: 'center' },
});
