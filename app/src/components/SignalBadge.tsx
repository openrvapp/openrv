import { StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';

import { signalOf } from '@/format';
import { useGateway } from '@/store/gateway';

/** The Bluetooth signal to the gateway: bars, and its strength in dBm. Nothing while it isn't known. */
export function SignalBadge({ showDbm = true }: { showDbm?: boolean }) {
  const theme = useTheme();
  const rssi = useGateway((s) => (s.connection === 'connected' ? s.rssi : undefined));
  if (rssi === undefined) return null;
  const signal = signalOf(rssi);
  const color = signal.bars <= 1 ? theme.colors.error : theme.colors.onSurfaceVariant;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Bluetooth signal to the gateway: ${signal.label}, ${rssi} dBm`}
    >
      <Icon source={signal.icon} size={18} color={color} />
      {showDbm && (
        <Text variant="labelSmall" style={{ color }}>
          {rssi} dBm
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
});
