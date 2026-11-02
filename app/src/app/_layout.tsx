import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/DialogHost';
import { applyMonitoring } from '@/features/monitoring/monitor';
import { ExitWarning } from '@/features/monitoring/ExitWarning';
import { destinationOf } from '@/features/monitoring/notify';
import { startReconnecting } from '@/features/reconnect';
import { useSettings } from '@/store/settings';
import { resolveTheme } from '@/theme';

export default function RootLayout() {
  const preference = useSettings((s) => s.theme);
  const theme = resolveTheme(preference, useColorScheme());
  const insets = useSafeAreaInsets();
  useAutoConnect();
  useMonitoring();
  useNotificationTaps();

  return (
    <GestureHandlerRootView style={styles.root}>
      <PaperProvider theme={theme}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.onSurface,
            // Android draws the app edge to edge, under its navigation buttons: keep pages clear of
            // them. The tabs' own bar already does.
            contentStyle: {
              backgroundColor: theme.colors.background,
              paddingBottom: route.name === '(tabs)' ? 0 : insets.bottom,
            },
          })}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="gateway/connect" options={{ title: 'Connect to a gateway', presentation: 'modal' }} />
          <Stack.Screen name="gateway/firmware" options={{ title: 'Firmware' }} />
          <Stack.Screen name="gateway/phones" options={{ title: 'Phones' }} />
          <Stack.Screen name="gateway/light" options={{ title: 'Status light and button' }} />
          <Stack.Screen name="claim" options={{ title: 'Set up a gateway', presentation: 'modal' }} />
          <Stack.Screen name="device/add" options={{ title: 'Add device', presentation: 'modal' }} />
          <Stack.Screen name="device/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="device/[id]/settings" options={{ title: 'Device settings' }} />
          <Stack.Screen name="device/[id]/alerts" options={{ title: 'Alerts' }} />
        </Stack>
        <DialogHost />
        <ExitWarning />
      </PaperProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Keeps the app connected to the last gateway: connects at launch, and reconnects whenever the
 * connection drops while the app is open (features/reconnect.ts). Disconnecting in Settings
 * forgets the gateway, which stops it.
 */
function useAutoConnect() {
  useEffect(() => {
    if (useSettings.persist.hasHydrated()) startReconnecting();
    else return useSettings.persist.onFinishHydration(startReconnecting);
  }, []);
}

/** Puts the chosen alert monitoring into effect at launch and whenever it or the gateway changes. */
function useMonitoring() {
  const monitoring = useSettings((s) => s.monitoring);
  const gatewayId = useSettings((s) => s.lastGatewayId);
  const [hydrated, setHydrated] = useState(useSettings.persist.hasHydrated());
  useEffect(() => useSettings.persist.onFinishHydration(() => setHydrated(true)), []);
  useEffect(() => {
    if (hydrated) applyMonitoring(monitoring).catch(() => undefined);
  }, [hydrated, monitoring, gatewayId]);
}

/** A tapped alert opens its device; a tapped monitoring reminder opens the monitoring setting. */
function useNotificationTaps() {
  useEffect(() => {
    if (Platform.OS === 'web') return; // no notifications in the web preview
    const open = (response: Notifications.NotificationResponse | null) => {
      const to = destinationOf(response);
      if (to && 'deviceId' in to) router.push({ pathname: '/device/[id]', params: { id: to.deviceId } });
      else if (to) router.navigate({ pathname: '/settings', params: { highlight: 'monitoring' } });
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}

const styles = StyleSheet.create({ root: { flex: 1 } });
