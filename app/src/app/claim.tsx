// Opened by the web flasher's QR code: openrv://claim?mac=<gateway Bluetooth address>&code=<setup code>.
// Finds that gateway nearby, pairs with it and becomes its owner.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';

import { LogoMark } from '@/components/Logo';
import { requestBlePermissions, scanForGateways } from '@/ble';
import { formatCode } from '@/protocol/access';
import { useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';

const FIND_MS = 20_000;

type Step = 'finding' | 'pairing' | 'done' | 'failed';

export default function ClaimScreen() {
  const theme = useTheme();
  const { mac = '', code = '' } = useLocalSearchParams<{ mac?: string; code?: string }>();
  const connect = useGateway((s) => s.connect);
  const setSettings = useSettings((s) => s.set);
  const [step, setStep] = useState<Step>('finding');
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const target = mac.toUpperCase();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      setStep('failed');
    };
    setStep('finding');
    setError(undefined);
    (async () => {
      if (!target || !code) return fail("This link is missing the gateway's address or setup code.");
      if (!(await requestBlePermissions())) return fail('OpenRV needs Bluetooth permission to find the gateway.');
      // On Android a device's id is its Bluetooth address, which is what the QR code holds.
      const id = await new Promise<string | undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), FIND_MS);
        stop = scanForGateways(
          (g) => {
            if (g.id.toUpperCase() !== target) return;
            clearTimeout(timer);
            resolve(g.id);
          },
          (e) => {
            clearTimeout(timer);
            fail(e.message);
            resolve(undefined);
          },
        );
      });
      stop?.();
      stop = undefined;
      if (cancelled || !id) {
        if (!id) fail("Couldn't find the gateway. Make sure it's powered on and close by, then try again.");
        return;
      }
      setStep('pairing');
      try {
        await connect(id, undefined, code);
        if (cancelled) return;
        setSettings({ lastGatewayId: id });
        if (useGateway.getState().connection === 'connected') {
          setStep('done');
          setTimeout(() => router.replace('/'), 1200);
        } else {
          // Reached it, but it didn't take the code (it was already set up, or flashed again since).
          router.replace('/');
        }
      } catch (e) {
        fail((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [target, code, connect, setSettings, attempt]);

  return (
    <View style={styles.center}>
      <LogoMark size={64} />
      <Text variant="titleLarge">Set up your gateway</Text>
      <Text variant="bodyMedium" style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>
        Gateway {target || '?'} · setup code {formatCode(code)}
      </Text>
      {step === 'finding' && <Progress text="Looking for the gateway…" />}
      {step === 'pairing' && (
        <Progress text="Pairing. If the phone asks whether to pair with the gateway, tap Pair. This phone then becomes its owner." />
      )}
      {step === 'done' && <Text variant="titleMedium">This phone is now the gateway&apos;s owner.</Text>}
      {(step === 'finding' || step === 'pairing') && <Button onPress={() => router.replace('/')}>Cancel</Button>}
      {step === 'failed' && (
        <>
          <Text style={[styles.text, { color: theme.colors.error }]}>{error}</Text>
          <Button mode="contained" onPress={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
          <Button onPress={() => router.replace('/')}>Cancel</Button>
        </>
      )}
    </View>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <View style={styles.progress}>
      <ActivityIndicator />
      <Text variant="bodyMedium" style={styles.text}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  text: { textAlign: 'center' },
  progress: { alignItems: 'center', gap: 12, paddingHorizontal: 12 },
});
