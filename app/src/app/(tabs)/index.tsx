import { router, Tabs } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Banner, Button, Dialog, IconButton, List, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';

import { ConnectionPanel } from '@/components/ConnectionPanel';
import { DeviceCard } from '@/components/DeviceCard';
import { SignalBadge } from '@/components/SignalBadge';
import { ActionMenu } from '@/components/ActionMenu';
import { CardLook } from '@/components/CardLook';
import { hiddenDevices, orderAfterDrag, shownDevices } from '@/dashboardLayout';
import { deviceIcon } from '@/deviceClasses';
import type { Device } from '@/protocol/types';
import { selectAlarms, useGateway, useIsOwner } from '@/store/gateway';
import { DEFAULT_DASHBOARD_TITLE, useLayout, useLayoutActions } from '@/store/layouts';
import { useSettings, type ThemePreference } from '@/store/settings';

/**
 * The dashboard: this phone's cards for the connected gateway. Press and hold a card, then drag it
 * into place. The edit button lets you rename the dashboard, restyle or hide cards; + brings hidden
 * cards back. All of it is this phone's, for this gateway.
 */
export default function DashboardScreen() {
  const owner = useIsOwner();
  const theme = useTheme();
  const connection = useGateway((s) => s.connection);
  const devices = useGateway((s) => s.devices);
  const refresh = useGateway((s) => s.refresh);
  const layout = useLayout();
  const alarms = useMemo(() => selectAlarms({ devices }), [devices]);
  const { setOrder, hide, show, setTitle } = useLayoutActions();
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [styling, setStyling] = useState<Device>();
  const [renaming, setRenaming] = useState(false);
  const [rowWidth, setRowWidth] = useState<number>();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  const shown = useMemo(() => shownDevices(devices, layout), [devices, layout]);
  const hidden = useMemo(() => hiddenDevices(devices, layout), [devices, layout]);
  const title = layout.title ?? DEFAULT_DASHBOARD_TITLE;

  if (connection !== 'connected')
    return (
      <>
        <DashboardHeader />
        <ConnectionPanel />
      </>
    );

  const header = (
    <DashboardHeader
      editing={editing}
      onEdit={devices.length ? () => setEditing(!editing) : undefined}
      onAdd={() => setAdding(true)}
    />
  );
  const addDialog = adding && <AddCardDialog onDismiss={() => setAdding(false)} />;

  if (devices.length === 0) {
    return (
      <View style={styles.empty}>
        {header}
        <Text variant="titleMedium">No devices yet</Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
          Add your tanks, sensors and other devices to the gateway, and they will show up here.
        </Text>
        {owner && (
          <Button mode="contained" icon="plus" onPress={() => router.push('/device/add')}>
            Add device
          </Button>
        )}
        {addDialog}
      </View>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh().catch(() => undefined);
    setRefreshing(false);
  };
  const critical = alarms.filter((a) => a.severity === 'critical');

  return (
    <Animated.ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />}
    >
      {header}
      {editing && (
        <View>
          <List.Item
            title={title}
            description="Dashboard name on this phone. Tap to rename."
            left={(p) => <List.Icon {...p} icon="pencil-outline" />}
            onPress={() => setRenaming(true)}
          />
          <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            Press and hold a card, then drag it into place. Tap a card to change how it looks, or the eye to hide it.
            These changes are only on this phone, for this gateway.
          </Text>
        </View>
      )}
      <Banner
        visible={critical.length > 0}
        icon="alert"
        style={{ backgroundColor: theme.colors.errorContainer }}
        actions={[{ label: 'View alerts', onPress: () => router.navigate('/alerts') }]}
      >
        {critical.map((a) => `${a.deviceName}: ${a.label}`).join(' · ')}
      </Banner>
      {shown.length === 0 ? (
        <View style={styles.noCards}>
          <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            Every card is hidden on this phone.
          </Text>
          <Button mode="contained-tonal" icon="plus" onPress={() => setAdding(true)}>
            Add a card
          </Button>
        </View>
      ) : (
        <View style={styles.grid} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
          {rowWidth !== undefined && (
            <Sortable.Flex
              flexDirection="row"
              flexWrap="wrap"
              scrollableRef={scrollRef}
              autoScrollEnabled
              dragActivationDelay={300}
              hapticsEnabled
              onDragEnd={({ order }) => setOrder(orderAfterDrag(order(shown), layout))}
            >
              {shown.map((d) => (
                <DeviceCard
                  key={d.id}
                  device={d}
                  rowWidth={rowWidth}
                  onPress={
                    editing
                      ? () => setStyling(d)
                      : () => router.push({ pathname: '/device/[id]', params: { id: d.id } })
                  }
                  actions={
                    editing && (
                      <IconButton
                        icon="eye-off-outline"
                        mode="contained-tonal"
                        size={18}
                        accessibilityLabel={`Hide ${d.name}`}
                        onPress={() => hide(d.id)}
                      />
                    )
                  }
                />
              ))}
            </Sortable.Flex>
          )}
        </View>
      )}
      {editing && hidden.length > 0 && (
        <List.Section title="Hidden on this phone">
          {hidden.map((d) => (
            <List.Item
              key={d.id}
              title={d.name}
              description={d.model}
              left={(p) => <List.Icon {...p} icon={deviceIcon(d)} />}
              right={() => (
                <IconButton icon="eye-outline" accessibilityLabel={`Show ${d.name}`} onPress={() => show(d.id)} />
              )}
              onPress={() => show(d.id)}
            />
          ))}
        </List.Section>
      )}
      {addDialog}
      {styling && <CardStyleDialog device={styling} onDismiss={() => setStyling(undefined)} />}
      {renaming && (
        <RenameDialog
          title={title}
          onSave={(t) => setTitle(t && t !== DEFAULT_DASHBOARD_TITLE ? t : undefined)}
          onDismiss={() => setRenaming(false)}
        />
      )}
    </Animated.ScrollView>
  );
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'night', label: 'Night (red)' },
];

/** The dashboard's title (named on this phone, per gateway) and its actions. */
function DashboardHeader({ editing, onEdit, onAdd }: { editing?: boolean; onEdit?: () => void; onAdd?: () => void }) {
  const layout = useLayout();
  const title = layout.title ?? DEFAULT_DASHBOARD_TITLE;
  const themePref = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);

  return (
    <Tabs.Screen
      options={{
        title: editing ? 'Edit dashboard' : title,
        tabBarLabel: 'Dashboard',
        headerRight: () =>
          editing ? (
            <Button onPress={onEdit} style={styles.done}>
              Done
            </Button>
          ) : (
            <View style={styles.headerActions}>
              <SignalBadge />
              <ActionMenu
                title="Appearance"
                actions={THEMES.map((t) => ({
                  label: t.label,
                  selected: themePref === t.value,
                  onPress: () => set({ theme: t.value }),
                }))}
                anchor={(open) => <IconButton icon="theme-light-dark" accessibilityLabel="Appearance" onPress={open} />}
              />
              {onEdit && (
                <IconButton
                  icon="view-dashboard-edit-outline"
                  accessibilityLabel="Edit the dashboard"
                  onPress={onEdit}
                />
              )}
              {onAdd && <IconButton icon="plus" accessibilityLabel="Add a card" onPress={onAdd} />}
            </View>
          ),
      }}
    />
  );
}

/** The gateway's devices without a card here, to bring back. New devices are added on the Devices tab. */
function AddCardDialog({ onDismiss }: { onDismiss: () => void }) {
  const devices = useGateway((s) => s.devices);
  const owner = useIsOwner();
  const layout = useLayout();
  const { show } = useLayoutActions();
  const hidden = hiddenDevices(devices, layout);
  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss}>
        <Dialog.Title>Add a card</Dialog.Title>
        {hidden.length ? (
          <Dialog.ScrollArea style={styles.dialogArea}>
            <ScrollView>
              {hidden.map((d) => (
                <List.Item
                  key={d.id}
                  title={d.name}
                  description={d.model}
                  left={(p) => <List.Icon {...p} icon={deviceIcon(d)} />}
                  onPress={() => {
                    show(d.id);
                    onDismiss();
                  }}
                />
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
        ) : (
          <Dialog.Content>
            <Text variant="bodyMedium">
              Every device on the gateway already has a card. To add a new device to the gateway, use Add device.
            </Text>
          </Dialog.Content>
        )}
        <Dialog.Actions>
          {owner && (
            <Button
              onPress={() => {
                onDismiss();
                router.push('/device/add');
              }}
            >
              Add device
            </Button>
          )}
          <Button onPress={onDismiss}>Close</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function RenameDialog({
  title,
  onSave,
  onDismiss,
}: {
  title: string;
  onSave: (title: string) => void;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState(title);
  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss}>
        <Dialog.Title>Dashboard name</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label="Name"
            value={draft}
            onChangeText={setDraft}
            maxLength={40}
            placeholder={DEFAULT_DASHBOARD_TITLE}
            autoFocus
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button
            onPress={() => {
              onSave(draft.trim());
              onDismiss();
            }}
          >
            Save
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

/** How a card looks on this phone. */
function CardStyleDialog({ device, onDismiss }: { device: Device; onDismiss: () => void }) {
  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss}>
        <Dialog.Title>{device.name}</Dialog.Title>
        <Dialog.ScrollArea style={styles.dialogArea}>
          <ScrollView>
            <CardLook device={device} />
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Done</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 12 },
  grid: { margin: -6 },
  hint: { paddingHorizontal: 16, paddingBottom: 8 },
  noCards: { alignItems: 'center', gap: 12, padding: 24 },
  dialogArea: { paddingHorizontal: 0 },
  headerActions: { flexDirection: 'row' },
  done: { marginRight: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
