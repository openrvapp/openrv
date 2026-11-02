import { useEffect, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  List,
  Portal,
  RadioButton,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

import { discoverySections } from '@/dashboardLayout';
import { CLASS_NAMES, deviceIcon } from '@/deviceClasses';
import type { DeviceType, DiscoveredDevice } from '@/protocol/types';
import { toast } from '@/store/dialogs';
import { useGateway } from '@/store/gateway';

const DISCOVERY_SECONDS = 60;

/** Lists what the gateway hears nearby; tap one to add it. */
export default function AddDeviceScreen() {
  const theme = useTheme();
  const discovered = useGateway((s) => s.discovered);
  const devices = useGateway((s) => s.devices);
  const startDiscovery = useGateway((s) => s.startDiscovery);
  const stopDiscovery = useGateway((s) => s.stopDiscovery);
  const loadConfig = useGateway((s) => s.loadConfig);
  const [scanning, setScanning] = useState(true);
  const [picked, setPicked] = useState<DiscoveredDevice>();

  useEffect(() => {
    loadConfig().catch(() => undefined); // the model list, for devices the gateway can't recognize
    startDiscovery(DISCOVERY_SECONDS).catch((e: Error) => toast(e.message));
    const timer = setTimeout(() => setScanning(false), DISCOVERY_SECONDS * 1000);
    return () => {
      clearTimeout(timer);
      stopDiscovery();
    };
  }, [loadConfig, startDiscovery, stopDiscovery]);

  // Devices the gateway can read, then everything else; nearest first; none already on the gateway.
  const { recognized, other } = discoverySections(discovered, devices);
  const sections = [
    { key: 'recognized', title: 'Supported by your gateway', data: recognized },
    { key: 'other', title: 'Other Bluetooth devices', data: other },
  ].filter((section) => section.data.length);

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(d) => d.mac}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            {scanning && <ActivityIndicator size="small" />}
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>
              {scanning
                ? 'The gateway is listening for devices. Nearest first; devices it already has are left out.'
                : 'Finished listening.'}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <List.Subheader>{`${section.title} (${section.data.length})`}</List.Subheader>
        )}
        renderItem={({ item }) => (
          <List.Item
            title={item.model ?? (item.name || 'Unnamed device')}
            description={[item.model && item.name, item.mac, `${item.rssi} dBm`].filter(Boolean).join(' · ')}
            left={(p) => <List.Icon {...p} icon={item.class ? deviceIcon({ class: item.class }) : 'bluetooth'} />}
            onPress={() => setPicked(item)}
          />
        )}
        ListEmptyComponent={
          scanning ? undefined : (
            <Text variant="bodyMedium" style={[styles.none, { color: theme.colors.onSurfaceVariant }]}>
              Nothing new heard nearby. Check the device is on and close to the gateway, then listen again.
            </Text>
          )
        }
      />
      {!scanning && (
        <Button
          mode="outlined"
          style={[styles.again, { marginBottom: 16 }]}
          onPress={() => startDiscovery(DISCOVERY_SECONDS).then(() => setScanning(true))}
        >
          Listen again
        </Button>
      )}
      {picked && <AddDialog found={picked} onDismiss={() => setPicked(undefined)} />}
    </View>
  );
}

function AddDialog({ found, onDismiss }: { found: DiscoveredDevice; onDismiss: () => void }) {
  const addDevice = useGateway((s) => s.addDevice);
  const models = useGateway((s) => s.models);
  // By kind of device, then by name.
  const sortedModels = [...models].sort(
    (a, b) => CLASS_NAMES[a.class]?.localeCompare(CLASS_NAMES[b.class] ?? '') || a.model.localeCompare(b.model),
  );
  const [type, setType] = useState<DeviceType | undefined>(found.type);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!type) return;
    setSaving(true);
    try {
      await addDevice({ type, mac: found.mac, name: name.trim() });
      // Stay on the list, so more devices can be added; this one drops out of it.
      onDismiss();
      toast(`Added ${name.trim()}`);
    } catch (e) {
      toast(`Couldn't add it: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss}>
        <Dialog.Title>Add device</Dialog.Title>
        <Dialog.Content style={styles.dialog}>
          <TextInput
            label="Name"
            placeholder="e.g. Front tank"
            value={name}
            onChangeText={setName}
            maxLength={32}
            autoFocus
          />
          {!found.type && (
            <RadioButton.Group value={type ?? ''} onValueChange={(v) => setType(v as DeviceType)}>
              {sortedModels.map((m) => (
                <RadioButton.Item
                  key={m.type}
                  value={m.type}
                  label={`${m.model} (${CLASS_NAMES[m.class] ?? m.class})`}
                />
              ))}
            </RadioButton.Group>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button onPress={add} disabled={!type || !name.trim() || saving} loading={saving}>
            Add
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  again: { margin: 16 },
  none: { padding: 24, textAlign: 'center' },
  dialog: { gap: 8 },
});
