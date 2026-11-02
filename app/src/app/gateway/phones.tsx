import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, List, Portal, SegmentedButtons, Text, useTheme } from 'react-native-paper';

import { ActionMenu } from '@/components/ActionMenu';
import type { KnownPhone } from '@/protocol/types';
import { toast } from '@/store/dialogs';
import { useGateway } from '@/store/gateway';

const PAIRING_S = 120;

/** The phones the gateway lets in, for its owners: change who's an owner, remove one, add one. */
export default function PhonesScreen() {
  const theme = useTheme();
  const listPhones = useGateway((s) => s.listPhones);
  const [phones, setPhones] = useState<KnownPhone[]>();
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      listPhones().then(setPhones, (e: Error) => {
        toast(`Couldn't load the phones: ${e.message}`);
        setPhones([]);
      }),
    [listPhones],
  );
  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.root}>
      <FlatList
        data={phones ?? []}
        keyExtractor={(p) => p.addr}
        ItemSeparatorComponent={Divider}
        refreshing={phones === undefined}
        onRefresh={load}
        ListHeaderComponent={
          <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            Only these phones can connect to the gateway. Owners can change its settings, devices, alerts and this list;
            guests can watch and operate devices.
          </Text>
        }
        renderItem={({ item }) => <PhoneRow phone={item} onChanged={load} />}
        ListFooterComponent={
          <View style={styles.footer}>
            <Button mode="contained" icon="account-plus" onPress={() => setAdding(true)}>
              Add a phone
            </Button>
          </View>
        }
      />
      {adding && (
        <AddPhoneDialog
          onDismiss={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </View>
  );
}

function PhoneRow({ phone, onChanged }: { phone: KnownPhone; onChanged: () => void }) {
  const updatePhone = useGateway((s) => s.updatePhone);
  const removePhone = useGateway((s) => s.removePhone);
  const owner = phone.role === 'owner';

  const run = (p: Promise<void>, failed: string) =>
    p.then(onChanged, (e: Error) =>
      toast(e.message === 'refused' ? 'The gateway needs at least one owner.' : `${failed}: ${e.message}`),
    );

  const confirmRemove = () =>
    Alert.alert(
      `Remove ${phone.name || 'this phone'}?`,
      phone.you
        ? "This phone can't connect to the gateway again until an owner adds it back."
        : "It can't connect to the gateway again until an owner adds it back.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => run(removePhone(phone.addr), "Couldn't remove it") },
      ],
    );

  const status = [owner ? 'Owner' : 'Guest', phone.you ? 'this phone' : phone.connected ? 'connected' : undefined]
    .filter(Boolean)
    .join(' · ');

  return (
    <List.Item
      title={phone.name || phone.addr}
      description={status}
      left={(p) => <List.Icon {...p} icon={owner ? 'account-key' : 'account-outline'} />}
      right={() => (
        <ActionMenu
          title={phone.name || phone.addr}
          actions={[
            {
              label: owner ? 'Make a guest' : 'Make an owner',
              icon: owner ? 'account-outline' : 'account-key',
              onPress: () => run(updatePhone(phone.addr, { role: owner ? 'guest' : 'owner' }), "Couldn't change it"),
            },
            { label: 'Remove', icon: 'delete-outline', destructive: true, onPress: confirmRemove },
          ]}
          anchor={(open) => <Button onPress={open}>Change</Button>}
        />
      )}
    />
  );
}

/** Opens the gateway to one new phone for a couple of minutes. */
function AddPhoneDialog({ onDismiss }: { onDismiss: () => void }) {
  const openPairing = useGateway((s) => s.openPairing);
  const [role, setRole] = useState<'guest' | 'owner'>('guest');
  const [until, setUntil] = useState<number>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  const left = until ? Math.max(0, Math.round((until - now) / 1000)) : 0;

  const open = () =>
    openPairing(role).then(
      () => {
        setUntil(Date.now() + PAIRING_S * 1000);
        setNow(Date.now());
      },
      (e: Error) => toast(`Couldn't open pairing: ${e.message}`),
    );

  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss}>
        <Dialog.Title>Add a phone</Dialog.Title>
        <Dialog.Content style={styles.dialog}>
          {until && left > 0 ? (
            <Text variant="bodyMedium">
              On the other phone, open OpenRV, tap Find a gateway and choose this one within {Math.floor(left / 60)}:
              {String(left % 60).padStart(2, '0')}. It joins as {role === 'owner' ? 'an owner' : 'a guest'}.
            </Text>
          ) : (
            <>
              <Text variant="bodyMedium">
                For the next {PAIRING_S / 60} minutes, the first new phone to connect is let in. Holding the
                gateway&apos;s BOOT button for 3 seconds does the same, for a guest.
              </Text>
              <SegmentedButtons
                value={role}
                onValueChange={(v) => setRole(v as 'guest' | 'owner')}
                buttons={[
                  { value: 'guest', label: 'Guest', icon: 'account-outline' },
                  { value: 'owner', label: 'Owner', icon: 'account-key' },
                ]}
              />
            </>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          {!(until && left > 0) && <Button onPress={open}>{until ? 'Open again' : 'Let a phone in'}</Button>}
          <Button onPress={onDismiss}>Done</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hint: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  footer: { padding: 16 },
  dialog: { gap: 12 },
});
