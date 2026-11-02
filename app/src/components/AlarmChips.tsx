import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { Alarm } from '@/protocol/types';
import { severityColor } from '@/theme';

export function AlarmChips({ alarms }: { alarms?: Alarm[] }) {
  const theme = useTheme();
  if (!alarms?.length) return null;
  return (
    <View style={styles.row}>
      {alarms.map((a) => {
        const color = severityColor(theme, a.severity);
        return (
          <View key={a.rule} style={[styles.chip, { borderColor: color }]}>
            <Text variant="labelSmall" style={{ color }}>
              {a.label.toUpperCase()}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
});
