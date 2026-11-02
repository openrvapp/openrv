import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, List, Portal, Text, TextInput, useTheme } from 'react-native-paper';

import {
  compareVersions,
  download,
  downloadedImage,
  getGitHubToken,
  importFromFile,
  install,
  installOverBluetooth,
  latestRelease,
  setGitHubToken,
  type InstallStep,
  type Release,
  WIFI_INSTALL_AVAILABLE,
} from '@/features/firmware';
import { toast } from '@/store/dialogs';
import { useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';

const STEP_TEXT: Record<InstallStep, string> = {
  opening: 'Asking the gateway to open its update Wi-Fi…',
  joining: 'Joining the gateway’s Wi-Fi (allow it if Android asks)…',
  uploading: 'Sending the firmware…',
  sending: 'Sending the firmware over Bluetooth…',
  checking: 'The gateway is checking the new firmware…',
  restarting: 'The gateway is restarting into the new firmware…',
};

export default function FirmwareScreen() {
  const theme = useTheme();
  const hello = useGateway((s) => s.hello);
  const connection = useGateway((s) => s.connection);
  const openUpdateWindow = useGateway((s) => s.openUpdateWindow);
  const request = useGateway((s) => s.request);
  const connect = useGateway((s) => s.connect);
  const lastGatewayId = useSettings((s) => s.lastGatewayId);
  const setSettings = useSettings((s) => s.set);

  const [onPhone, setOnPhone] = useState(downloadedImage());
  const [latest, setLatest] = useState<Release | null>();
  const [busy, setBusy] = useState<string>();
  const [hasToken, setHasToken] = useState(false);
  const [tokenDialog, setTokenDialog] = useState(false);

  useEffect(() => {
    getGitHubToken().then((t) => setHasToken(!!t));
  }, []);

  const check = useCallback(async () => {
    setBusy('Checking GitHub…');
    try {
      setLatest(await latestRelease());
      setSettings({ lastFirmwareCheck: Date.now() });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }, [setSettings]);

  const fetchImage = async () => {
    if (!latest) return;
    setBusy(`Downloading ${latest.version}…`);
    try {
      setOnPhone(await download(latest));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const pickFile = async () => {
    try {
      const image = await importFromFile();
      if (image) {
        setOnPhone(image);
        toast(`Firmware ${image.version} is ready to install`);
      }
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const installImage = async (over: 'wifi' | 'bluetooth') => {
    if (!onPhone) return;
    try {
      const onStep = (step: InstallStep) => setBusy(STEP_TEXT[step]);
      if (over === 'wifi') await install(onPhone.file, openUpdateWindow, onStep);
      else
        await installOverBluetooth(onPhone.file, request, onStep, (f) =>
          setBusy(`Sending the firmware over Bluetooth… ${Math.round(f * 100)}%`),
        );
      // Give it time to restart, then reconnect and see what it's running.
      await new Promise((r) => setTimeout(r, 12_000));
      setBusy('Reconnecting…');
      if (lastGatewayId) await connect(lastGatewayId);
      const now = useGateway.getState().hello?.fw;
      toast(now === onPhone.version ? `Gateway updated to ${now}` : `Gateway is running ${now ?? 'unknown'}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const gatewayFw = connection === 'connected' ? hello?.fw : undefined;
  const newer = (a?: string, b?: string) => !!a && (!b || compareVersions(a, b) > 0);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <List.Item
        title="Gateway"
        description={gatewayFw ? `Running ${gatewayFw}` : 'Not connected'}
        left={(p) => <List.Icon {...p} icon="chip" />}
      />
      <List.Item
        title="On this phone"
        description={onPhone ? `Firmware ${onPhone.version}` : 'Nothing downloaded'}
        left={(p) => <List.Icon {...p} icon="cellphone-arrow-down" />}
      />
      <List.Item
        title="Newest on GitHub"
        description={latest === undefined ? 'Not checked yet' : latest ? latest.version : 'No releases yet'}
        left={(p) => <List.Icon {...p} icon="github" />}
      />

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator />
          <Text variant="bodyMedium" style={styles.flex}>
            {busy}
          </Text>
        </View>
      ) : (
        <View style={styles.buttons}>
          <Button mode="outlined" icon="refresh" onPress={check}>
            Check GitHub for updates
          </Button>
          {latest && newer(latest.version, onPhone?.version) && (
            <Button mode="contained-tonal" icon="download" onPress={fetchImage}>
              Download {latest.version} to this phone
            </Button>
          )}
          {onPhone && gatewayFw && newer(onPhone.version, gatewayFw) && (
            <>
              {WIFI_INSTALL_AVAILABLE && (
                <Button mode="contained" icon="wifi" onPress={() => installImage('wifi')}>
                  Install {onPhone.version} over Wi-Fi
                </Button>
              )}
              <Button
                mode={WIFI_INSTALL_AVAILABLE ? 'contained-tonal' : 'contained'}
                icon="bluetooth"
                onPress={() => installImage('bluetooth')}
              >
                Install {onPhone.version} over Bluetooth
              </Button>
            </>
          )}
          <Button icon="file-upload-outline" onPress={pickFile}>
            Use a firmware file from this phone
          </Button>
          <Button icon="key-outline" onPress={() => setTokenDialog(true)}>
            {hasToken ? 'Change GitHub access token' : 'Add GitHub access token'}
          </Button>
        </View>
      )}

      <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
        Download at home; install at the RV. Over Wi-Fi, the gateway opens its own network for 10 minutes and the phone
        uses it only for the upload, which takes seconds. Over Bluetooth, the firmware goes over the connection the app
        already has and takes a minute or two; keep the app open. Either way, if the new firmware fails to start, the
        gateway goes back to the old one.
      </Text>

      <TokenDialog
        visible={tokenDialog}
        onDismiss={() => setTokenDialog(false)}
        onSaved={(saved) => {
          setHasToken(saved);
          setTokenDialog(false);
        }}
      />
    </ScrollView>
  );
}

function TokenDialog({
  visible,
  onDismiss,
  onSaved,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSaved: (saved: boolean) => void;
}) {
  const [token, setToken] = useState('');
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>GitHub access token</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodySmall" style={styles.dialogText}>
            The firmware repository is private. A fine-grained token with read access to its contents is enough. It is
            kept in this phone's secure storage.
          </Text>
          <TextInput label="Token" value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setGitHubToken(null).then(() => onSaved(false))}>Remove</Button>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button disabled={!token.trim()} onPress={() => setGitHubToken(token).then(() => onSaved(true))}>
            Save
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 8, paddingBottom: 32 },
  buttons: { padding: 16, gap: 12 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  flex: { flex: 1 },
  note: { paddingHorizontal: 16, paddingTop: 8 },
  dialogText: { marginBottom: 12 },
});
