import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Icon, List, Switch, Text, TextInput, useTheme } from 'react-native-paper';

import { CardLook } from '@/components/CardLook';
import { ControlView } from '@/components/ControlView';
import type { Device } from '@/protocol/types';
import { toast } from '@/store/dialogs';
import { useGateway, useIsOwner } from '@/store/gateway';
import { useLayout, useLayoutActions } from '@/store/layouts';

export default function DeviceSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useGateway((s) => s.devices.find((d) => d.id === id));
  return device ? <DeviceSettings device={device} /> : null;
}

function DeviceSettings({ device }: { device: Device }) {
  const theme = useTheme();
  const updateDevice = useGateway((s) => s.updateDevice);
  const removeDevice = useGateway((s) => s.removeDevice);
  const owner = useIsOwner();
  const [name, setName] = useState(device.name);
  const [saving, setSaving] = useState(false);
  const hidden = useLayout().hidden.includes(device.id);
  const { hide, show } = useLayoutActions();

  const save = async (changes: Parameters<typeof updateDevice>[1]) => {
    setSaving(true);
    try {
      await updateDevice(device.id, changes);
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = () =>
    Alert.alert(`Remove ${device.name}?`, 'The gateway stops reading it and forgets its alert rules.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeDevice(device.id);
            router.dismissTo('/devices');
          } catch (e) {
            toast(`Couldn't remove: ${(e as Error).message}`);
          }
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScopeHeader
        icon="router-wireless"
        title="Shared settings"
        detail={
          owner
            ? 'Saved on the gateway. Every phone connected to it sees these, and its owners can change them.'
            : 'Saved on the gateway. Only its owners can change these.'
        }
      />
      <View style={styles.block}>
        <TextInput
          label="Name"
          value={name}
          onChangeText={setName}
          maxLength={32}
          onBlur={() => name.trim() && name.trim() !== device.name && save({ name: name.trim() })}
          disabled={saving || !owner}
        />
      </View>
      {device.setting_defs?.map((c) => (
        <ControlView
          key={c.key}
          control={owner ? c : { ...c, disabled: true }}
          busy={saving}
          onAction={(_action, values) => values && save({ settings: values })}
        />
      ))}
      {owner && (
        <View style={styles.block}>
          <Button
            mode="outlined"
            icon="delete-outline"
            textColor={theme.colors.error}
            onPress={confirmRemove}
            disabled={saving}
          >
            Remove from the gateway
          </Button>
        </View>
      )}
      <Divider style={styles.divider} />

      <ScopeHeader
        icon="cellphone"
        title="On this phone only"
        detail="How this device's card looks on this phone's dashboard for this gateway. Other phones keep their own."
      />
      <List.Item
        title="Show on the dashboard"
        right={() => <Switch value={!hidden} onValueChange={(v) => (v ? show(device.id) : hide(device.id))} />}
      />
      <CardLook device={device} />
    </ScrollView>
  );
}

/** A section heading that says where its settings are kept and who they affect. */
function ScopeHeader({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  const theme = useTheme();
  return (
    <View style={styles.scope}>
      <View style={styles.scopeTitle}>
        <Icon source={icon} size={20} color={theme.colors.primary} />
        <Text variant="titleMedium" style={{ color: theme.colors.primary }}>
          {title}
        </Text>
      </View>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  block: { paddingHorizontal: 16, paddingVertical: 8 },
  divider: { marginTop: 16 },
  scope: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8, gap: 4 },
  scopeTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
