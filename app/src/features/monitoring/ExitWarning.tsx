// With monitoring off, alerts only reach the person while the app is open, so leaving it gets a
// warning: a dialog when they press Back to exit, or a reminder notification when they leave
// another way (Home, switching apps), which Android doesn't let an app stop.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Dialog, Portal, Switch, Text } from 'react-native-paper';

import { applyMonitoring, LIVE_AVAILABLE, watchingRealGateway } from '@/features/monitoring/monitor';
import { notifyMonitoringOff } from '@/features/monitoring/notify';
import { useSettings, type Monitoring } from '@/store/settings';

const shouldWarn = () => {
  const s = useSettings.getState();
  return s.monitoring === 'off' && s.warnOnExit && watchingRealGateway();
};

export function ExitWarning() {
  const [open, setOpen] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const set = useSettings((s) => s.set);
  /** The reminder notification goes out once per run of the app, and not right after the dialog. */
  const reminded = useRef(false);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack() || !shouldWarn()) return false;
      setOpen(true);
      return true;
    });
    const state = AppState.addEventListener('change', (s) => {
      if (s !== 'background' || reminded.current || !shouldWarn()) return;
      reminded.current = true;
      notifyMonitoringOff().catch(() => undefined);
    });
    return () => {
      back.remove();
      state.remove();
    };
  }, []);

  const leave = () => {
    if (dontAsk) set({ warnOnExit: false });
    reminded.current = true; // they've just been told
    setOpen(false);
    BackHandler.exitApp();
  };

  const turnOn = async (monitoring: Monitoring) => {
    set({ monitoring });
    setOpen(false);
    await applyMonitoring(monitoring).catch(() => undefined);
    BackHandler.exitApp();
  };

  return (
    <Portal>
      <Dialog visible={open} onDismiss={() => setOpen(false)}>
        <Dialog.Title>Alerts won't reach you</Dialog.Title>
        <Dialog.Content style={styles.content}>
          <Text variant="bodyMedium">
            Monitoring is off, so once you leave, OpenRV can't tell you about alerts such as low propane or a warm
            fridge until you open it again.
          </Text>
          <View style={styles.check}>
            {Platform.OS === 'ios' ? (
              <>
                <Text variant="bodyMedium" style={styles.flex} onPress={() => setDontAsk(!dontAsk)}>
                  Don't warn me again
                </Text>
                <Switch value={dontAsk} onValueChange={setDontAsk} />
              </>
            ) : (
              <>
                <Checkbox.Android status={dontAsk ? 'checked' : 'unchecked'} onPress={() => setDontAsk(!dontAsk)} />
                <Text variant="bodyMedium" onPress={() => setDontAsk(!dontAsk)}>
                  Don't warn me again
                </Text>
              </>
            )}
          </View>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          {LIVE_AVAILABLE && (
            <Button mode="contained" onPress={() => turnOn('live')}>
              Turn on live monitoring
            </Button>
          )}
          <Button mode={LIVE_AVAILABLE ? 'contained-tonal' : 'contained'} onPress={() => turnOn('periodic')}>
            Turn on periodic monitoring
          </Button>
          <Button onPress={leave}>Leave anyway</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  check: { flexDirection: 'row', alignItems: 'center', marginLeft: Platform.OS === 'ios' ? 0 : -8 },
  flex: { flex: 1 },
  actions: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
});
