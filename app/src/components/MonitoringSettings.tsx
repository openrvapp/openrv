import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { Icon, List, RadioButton, Text, useTheme } from 'react-native-paper';

import { LIVE_AVAILABLE } from '@/features/monitoring/monitor';
import { notificationsAllowed } from '@/features/monitoring/notify';
import { DEMO_GATEWAY_ID } from '@/store/gateway';
import { useSettings, type Monitoring } from '@/store/settings';

const OPTIONS: { value: Monitoring; title: string; description: string }[] = [
  {
    value: 'live',
    title: 'Live',
    description:
      'Stays connected while the phone is near the RV and notifies within seconds. Shows an ongoing notification and uses more battery.',
  },
  {
    value: 'periodic',
    title: 'Periodic',
    description:
      'Checks the gateway about every 15 minutes in the background. Light on battery, but alerts can arrive late.',
  },
  {
    value: 'off',
    title: 'No monitoring',
    description: 'Only notifies while the app is open.',
  },
];

/**
 * Settings → Alert notifications: how the app watches for alerts when it isn't open. `highlight`
 * picks out No monitoring ("off", from the ongoing notification's Turn off) or the monitoring
 * choices ("monitoring", from the reminder when leaving), until the person picks one.
 */
export function MonitoringSettings({ highlight }: { highlight?: 'off' | 'monitoring' }) {
  const theme = useTheme();
  const monitoring = useSettings((s) => s.monitoring);
  const set = useSettings((s) => s.set);
  const [picked, setPicked] = useState(false);
  useEffect(() => setPicked(false), [highlight]);
  const choose = (value: Monitoring) => {
    set({ monitoring: value });
    setPicked(true);
  };
  const highlighted = (value: Monitoring) =>
    !picked && (highlight === 'off' ? value === 'off' : highlight === 'monitoring' && value !== 'off');
  const allowed = useNotificationPermission(monitoring);
  const gatewayId = useSettings((s) => s.lastGatewayId);
  const watchingRealGateway = !!gatewayId && gatewayId !== DEMO_GATEWAY_ID;
  const options = OPTIONS.filter((o) => o.value !== 'live' || LIVE_AVAILABLE);

  return (
    <List.Section title="Alert notifications">
      {options.map((o) => (
        <List.Item
          key={o.value}
          title={o.title}
          description={o.description}
          descriptionNumberOfLines={4}
          onPress={() => choose(o.value)}
          style={
            highlighted(o.value) ? [styles.highlight, { backgroundColor: theme.colors.primaryContainer }] : undefined
          }
          accessibilityRole="radio"
          accessibilityState={{ checked: monitoring === o.value }}
          // A radio button on the left on Android; a check on the right on iOS, as each does it.
          left={
            Platform.OS === 'ios'
              ? undefined
              : (p) => (
                  <View style={[p.style, styles.radio]}>
                    <RadioButton.Android
                      value={o.value}
                      status={monitoring === o.value ? 'checked' : 'unchecked'}
                      onPress={() => choose(o.value)}
                    />
                  </View>
                )
          }
          right={
            Platform.OS === 'ios' && monitoring === o.value
              ? (p) => <List.Icon {...p} icon="check" color={theme.colors.primary} />
              : undefined
          }
        />
      ))}
      {monitoring === 'off' && (
        <Warning color={theme.colors.error}>
          You won't be notified about alerts, such as low propane or a warm fridge, unless the app is open.
        </Warning>
      )}
      {monitoring !== 'off' && !watchingRealGateway && (
        <Warning color={theme.colors.onSurfaceVariant} icon="information-outline">
          {gatewayId === DEMO_GATEWAY_ID
            ? "The demo gateway isn't monitored. Connect to your own gateway to start monitoring."
            : 'Monitoring starts when you connect to your gateway.'}
        </Warning>
      )}
      {monitoring !== 'off' && allowed === false && (
        <List.Item
          title="Notifications are turned off for this app"
          description="Alerts can't reach you until you allow them. Tap to open the app's settings."
          descriptionNumberOfLines={3}
          titleStyle={{ color: theme.colors.error }}
          left={(p) => <List.Icon {...p} icon="bell-off-outline" color={theme.colors.error} />}
          onPress={() => Linking.openSettings()}
        />
      )}
    </List.Section>
  );
}

function Warning({ color, icon = 'alert-outline', children }: { color: string; icon?: string; children: string }) {
  return (
    <View style={styles.warning}>
      <Icon source={icon} size={20} color={color} />
      <Text variant="bodyMedium" style={[styles.warningText, { color }]}>
        {children}
      </Text>
    </View>
  );
}

/** Whether notifications are allowed; checked again whenever the app comes back to the front. */
function useNotificationPermission(monitoring: Monitoring): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean>();
  useEffect(() => {
    const check = () => notificationsAllowed().then(setAllowed, () => setAllowed(undefined));
    check();
    const subscription = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => subscription.remove();
  }, [monitoring]);
  return allowed;
}

const styles = StyleSheet.create({
  radio: { justifyContent: 'center' },
  highlight: { borderRadius: 12, marginHorizontal: 8 },
  warning: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-start' },
  warningText: { flex: 1 },
});
