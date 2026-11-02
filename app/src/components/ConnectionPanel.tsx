import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TextInput, useTheme } from 'react-native-paper';

import { LogoMark, Wordmark } from '@/components/Logo';
import { useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';

/** Shown in place of content while there is no gateway connection. */
export function ConnectionPanel() {
  const theme = useTheme();
  const connection = useGateway((s) => s.connection);
  const error = useGateway((s) => s.error);
  const connect = useGateway((s) => s.connect);
  const lastGatewayId = useSettings((s) => s.lastGatewayId);

  if (connection === 'setup') return <SetupPanel />;

  if (connection === 'connecting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text variant="bodyLarge">Connecting to the gateway…</Text>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <View style={styles.brand}>
        <LogoMark size={72} />
        <Wordmark height={30} />
      </View>
      <View style={styles.status}>
        <Icon source="bluetooth-off" size={20} color={theme.colors.onSurfaceVariant} />
        <Text variant="titleMedium">Not connected</Text>
      </View>
      {error && (
        <Text variant="bodyMedium" style={[styles.text, { color: theme.colors.error }]}>
          {error}
        </Text>
      )}
      {lastGatewayId && (
        <>
          <Text variant="bodySmall" style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>
            Trying again by itself every few seconds.
          </Text>
          <Button mode="contained" onPress={() => connect(lastGatewayId).catch(() => undefined)}>
            Reconnect now
          </Button>
        </>
      )}
      <Button mode={lastGatewayId ? 'text' : 'contained'} onPress={() => router.push('/gateway/connect')}>
        Find a gateway
      </Button>
    </View>
  );
}

/**
 * Reached a gateway that doesn't let this phone in yet. One without an owner: become its owner with
 * the setup code, or by putting it in pairing mode. One with an owner: get let in (pairing mode, or
 * an owner), or start over with a factory reset.
 */
function SetupPanel() {
  const theme = useTheme();
  const access = useGateway((s) => s.access);
  const name = useGateway((s) => s.hello?.name) ?? 'the gateway';
  const storeError = useGateway((s) => s.error);
  const resume = useGateway((s) => s.resume);
  const disconnect = useGateway((s) => s.disconnect);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const claimed = access?.claimed ?? false;
  const muted = { color: theme.colors.onSurfaceVariant };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await resume(code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (access?.pairing)
    return (
      <View style={styles.center}>
        <LogoMark size={56} />
        <Text variant="titleLarge" style={styles.text}>
          {name} is in pairing mode
        </Text>
        <View style={styles.status}>
          <ActivityIndicator size="small" />
          <Text variant="bodyMedium" style={styles.text}>
            {claimed ? 'Joining…' : 'Setting up…'} If the phone asks to pair, tap Pair.
          </Text>
        </View>
        {(error ?? storeError) && (
          <Text style={[styles.text, { color: theme.colors.error }]}>{error ?? storeError}</Text>
        )}
        <Button onPress={() => disconnect()}>Cancel</Button>
      </View>
    );

  return (
    <ScrollView contentContainerStyle={styles.setup}>
      <View style={styles.brand}>
        <LogoMark size={56} />
        <Text variant="titleLarge" style={styles.text}>
          {claimed ? `${name} already has an owner` : `Set up ${name}`}
        </Text>
      </View>
      <Text variant="bodyMedium" style={muted}>
        {claimed
          ? "It doesn't know this phone yet. Ask one of its owners to add this phone in Settings › Phones, or put it in pairing mode to join as a guest:"
          : 'Nobody owns it yet. Enter the setup code from the web flasher (under its QR code), or put it in pairing mode and this phone becomes its owner:'}
      </Text>

      {!claimed && access?.setup_code && (
        <View style={styles.block}>
          <TextInput
            mode="outlined"
            label="Setup code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="K7QM2-XWPA9"
            disabled={busy}
            onSubmitEditing={submit}
          />
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy || code.trim().length < 6}>
            Become the owner
          </Button>
        </View>
      )}
      {(error ?? storeError) && <Text style={{ color: theme.colors.error }}>{error ?? storeError}</Text>}

      <Step icon="gesture-tap-hold" title="Pairing mode">
        On the gateway board, press and hold the BOOT button for 3 seconds, until its light blinks blue, then let go.
        Keep this screen open; the app carries on by itself. Pairing mode lasts 2 minutes.
      </Step>

      {claimed && (
        <Step icon="restore-alert" title="Factory reset" danger>
          If you&apos;re its new owner and no one can add you, hold BOOT for 10 seconds, until its light blinks red
          faster and faster and then stays red. This erases everything on the gateway: its devices and their
          connections, alert rules, settings, PIN and every phone it knows. It can&apos;t be undone. Afterwards, set it
          up again with its setup code or pairing mode.
        </Step>
      )}

      <Button onPress={() => disconnect()}>Cancel</Button>
    </ScrollView>
  );
}

function Step({
  icon,
  title,
  danger,
  children,
}: {
  icon: string;
  title: string;
  danger?: boolean;
  children: string | string[];
}) {
  const theme = useTheme();
  const color = danger ? theme.colors.error : theme.colors.primary;
  return (
    <View style={[styles.step, { borderColor: danger ? theme.colors.error : theme.colors.outlineVariant }]}>
      <View style={styles.stepTitle}>
        <Icon source={icon} size={20} color={color} />
        <Text variant="titleSmall" style={{ color }}>
          {title}
        </Text>
      </View>
      <Text variant="bodyMedium">{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  setup: { padding: 24, gap: 16 },
  block: { gap: 8 },
  step: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  stepTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  text: { textAlign: 'center' },
  brand: { alignItems: 'center', gap: 12, marginBottom: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
