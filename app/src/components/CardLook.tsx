import { StyleSheet, View } from 'react-native';
import { RadioButton, SegmentedButtons, Text, useTheme } from 'react-native-paper';

import { useCardStyle, useCardWidth } from '@/components/DeviceCard';
import { cardStyleLabel, cardStyles } from '@/deviceClasses';
import type { Device } from '@/protocol/types';
import { useLayoutActions } from '@/store/layouts';
import type { CardStyle, CardWidth } from '@/store/settings';

/** How a device's dashboard card looks on this phone, for this gateway: its style and whether it spans one or two columns. */
export function CardLook({ device, onChange }: { device: Device; onChange?: () => void }) {
  const theme = useTheme();
  const style = useCardStyle(device);
  const width = useCardWidth(device);
  const { setStyle, setWidth } = useLayoutActions();

  return (
    <View>
      <RadioButton.Group
        value={style}
        onValueChange={(v) => {
          setStyle(device.id, v as CardStyle);
          onChange?.();
        }}
      >
        {cardStyles(device).map((s) => (
          <RadioButton.Item key={s} value={s} label={cardStyleLabel(s, device)} />
        ))}
      </RadioButton.Group>
      <View style={styles.width}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Width
        </Text>
        <SegmentedButtons
          value={String(width)}
          onValueChange={(v) => setWidth(device.id, Number(v) as CardWidth)}
          buttons={[
            { value: '1', label: '1 column' },
            { value: '2', label: '2 columns' },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  width: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
});
