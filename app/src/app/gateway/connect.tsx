import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, List, Text, useTheme } from 'react-native-paper';

import { requestBlePermissions, scanForGateways, type FoundGateway } from '@/ble';
import { toast } from '@/store/dialogs';
import { DEMO_GATEWAY_ID, useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';

export default function ConnectScreen() {
  const theme = useTheme();
  const connect = useGateway((s) => s.connect);
  const setSettings = useSettings((s) => s.set);
  const [found, setFound] = useState<FoundGateway[]>([]);
  const [scanError, setScanError] = useState<string>();
  const [connecting, setConnecting] = useState<string>();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    requestBlePermissions().then((granted) => {
      if (cancelled) return;
      if (!granted) {
        setScanError('OpenRV needs Bluetooth permission to find the gateway.');
        return;
      }
      stop = scanForGateways(
        (g) =>
          setFound((list) =>
            [...list.filter((x) => x.id !== g.id), g].sort((a, b) => (b.rssi ?? -127) - (a.rssi ?? -127)),
          ),
        (e) => setScanError(e.message),
      );
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const choose = async (id: string) => {
    setConnecting(id);
    try {
      await connect(id);
      setSettings({ lastGatewayId: id });
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      toast(`Couldn't connect: ${(e as Error).message}`);
    } finally {
      setConnecting(undefined);
    }
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={found}
        keyExtractor={(g) => g.id}
        ListHeaderComponent={
          <View style={styles.header}>
            {scanError ? (
              <Text style={{ color: theme.colors.error }}>{scanError}</Text>
            ) : (
              <View style={styles.row}>
                <ActivityIndicator size="small" />
                <Text>Looking for gateways nearby…</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            description={item.rssi !== null ? `Signal ${item.rssi} dBm` : undefined}
            left={(p) => <List.Icon {...p} icon="router-wireless" />}
            right={() => (connecting === item.id ? <ActivityIndicator /> : null)}
            onPress={() => choose(item.id)}
            disabled={!!connecting}
          />
        )}
      />
      <Button
        mode="outlined"
        icon="play-circle-outline"
        style={[styles.demo, { marginBottom: 16 }]}
        onPress={() => choose(DEMO_GATEWAY_ID)}
        disabled={!!connecting}
      >
        Try the demo gateway
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  demo: { margin: 16 },
});
