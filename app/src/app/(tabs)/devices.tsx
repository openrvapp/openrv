import { router, Tabs } from 'expo-router';
import { memo, useMemo } from 'react';
import { FlatList, Platform, StyleSheet, View } from 'react-native';
import { Divider, FAB, IconButton, List, Text, useTheme } from 'react-native-paper';

import { ConnectionPanel } from '@/components/ConnectionPanel';
import { applyOrder } from '@/dashboardLayout';
import { deviceIcon } from '@/deviceClasses';
import { formatAge, formatValue, primaryValue } from '@/format';
import type { Device } from '@/protocol/types';
import { useGateway, useIsOwner } from '@/store/gateway';
import { useLayout } from '@/store/layouts';
import { useSettings } from '@/store/settings';

/**
 * Every device on the gateway, to manage it: its readings, controls, settings and alerts are shared
 * with every phone. Whether its card shows on the dashboard is this phone's choice.
 */
export default function DevicesScreen() {
  const theme = useTheme();
  const connection = useGateway((s) => s.connection);
  const devices = useGateway((s) => s.devices);
  const layout = useLayout();
  const owner = useIsOwner();
  const sorted = useMemo(() => applyOrder(devices, layout.order), [devices, layout.order]);
  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden]);

  if (connection !== 'connected') return <ConnectionPanel />;

  return (
    <View style={styles.root}>
      <FlatList
        data={sorted}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DeviceRow device={item} hidden={hidden.has(item.id)} />}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          sorted.length ? (
            <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
              The devices on the gateway, shared by every phone that connects to it.
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <Text variant="bodyLarge" style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>
            {owner
              ? 'No devices yet. Tap Add device and the gateway will listen for them.'
              : 'No devices yet. An owner of the gateway can add them.'}
          </Text>
        }
      />
      {owner && Platform.OS === 'ios' && (
        // iOS puts a screen's main action in its navigation bar; Android uses a floating button.
        <Tabs.Screen
          options={{
            headerRight: () => (
              <IconButton icon="plus" accessibilityLabel="Add device" onPress={() => router.push('/device/add')} />
            ),
          }}
        />
      )}
      {owner && Platform.OS !== 'ios' && (
        <FAB icon="plus" label="Add device" style={styles.fab} onPress={() => router.push('/device/add')} />
      )}
    </View>
  );
}

const DeviceRow = memo(function DeviceRow({ device: d, hidden }: { device: Device; hidden: boolean }) {
  const theme = useTheme();
  const unit = useSettings((s) => s.temperatureUnit);
  const v = primaryValue(d);
  const status = d.status.online ? formatAge(d.status.age_s) : 'offline';

  return (
    <List.Item
      title={d.name}
      description={`${d.model} · ${status}${hidden ? ' · hidden on the dashboard' : ''}`}
      descriptionNumberOfLines={2}
      left={(p) => <List.Icon {...p} icon={deviceIcon(d)} />}
      right={() => (
        <Text
          variant="titleMedium"
          style={[styles.value, { color: d.status.online ? theme.colors.onSurface : theme.colors.outline }]}
        >
          {v ? formatValue(v, unit) : ''}
        </Text>
      )}
      onPress={() => router.push({ pathname: '/device/[id]', params: { id: d.id } })}
    />
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingBottom: 96 },
  hint: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  empty: { padding: 24, textAlign: 'center' },
  value: { alignSelf: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
