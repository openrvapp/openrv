import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, List, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';

import { ActionMenu } from '@/components/ActionMenu';
import { capitalize, displayUnit, isTemperature, toDisplayTemperature } from '@/format';
import type { Control } from '@/protocol/types';
import { useSettings } from '@/store/settings';

interface Props {
  control: Control;
  busy: boolean;
  /** Called with the action to run and, for settable controls, the new value. */
  onAction: (action: string, values?: Record<string, unknown>) => void;
}

/** Renders any control the gateway describes: switch, stepper, choice, text field or action buttons. */
export function ControlView({ control, busy, onAction }: Props) {
  const temperatureUnit = useSettings((s) => s.temperatureUnit);
  const disabled = busy || control.disabled;
  const set = (value: unknown) => onAction('set', { [control.key]: value });

  switch (control.kind) {
    case 'text':
      return <TextControl control={control} disabled={!!disabled} onSave={set} />;
    case 'toggle':
      return (
        <List.Item
          title={control.label}
          right={() => <Switch value={control.value} onValueChange={set} disabled={disabled} />}
        />
      );
    case 'number': {
      // Steps stay in the gateway's units (a cooler's own degree); only the number shown is converted.
      const step = control.step ?? 1;
      const EPS = 1e-6;
      const shown = isTemperature(control.unit)
        ? Number(toDisplayTemperature(control.value, temperatureUnit).toFixed(1)).toString()
        : String(control.value);
      const unit = displayUnit(control.unit, temperatureUnit);
      return (
        <List.Item
          title={control.label}
          right={() => (
            <View style={styles.stepper}>
              <IconButton
                icon="minus"
                mode="contained-tonal"
                disabled={disabled || control.value - step < control.min - EPS}
                onPress={() => set(control.value - step)}
                accessibilityLabel={`Lower ${control.label}`}
              />
              <Text variant="titleMedium" style={styles.number}>
                {shown}
                {unit ? ` ${unit}` : ''}
              </Text>
              <IconButton
                icon="plus"
                mode="contained-tonal"
                disabled={disabled || control.value + step > control.max + EPS}
                onPress={() => set(control.value + step)}
                accessibilityLabel={`Raise ${control.label}`}
              />
            </View>
          )}
        />
      );
    }
    case 'choice':
      if (control.options.length > 3) return <ChoiceMenu control={control} disabled={!!disabled} onSelect={set} />;
      return (
        <View style={styles.block}>
          <Text variant="bodyLarge" style={styles.label}>
            {control.label}
          </Text>
          <SegmentedButtons
            value={control.value}
            onValueChange={set}
            buttons={control.options.map((o, i) => ({
              value: o,
              label: control.labels?.[i] ?? capitalize(o),
              disabled,
            }))}
          />
        </View>
      );
    case 'action':
      return (
        <View style={[styles.block, styles.actions]}>
          {control.actions.map((a) => (
            <Button
              key={a}
              mode="contained-tonal"
              disabled={disabled}
              onPress={() => onAction(a)}
              style={styles.action}
            >
              {capitalize(a)}
            </Button>
          ))}
        </View>
      );
  }
}

type Choice = Extract<Control, { kind: 'choice' }>;
type TextField = Extract<Control, { kind: 'text' }>;

/** A text setting, saved with its own button; secret ones never show what is stored. */
function TextControl({
  control,
  disabled,
  onSave,
}: {
  control: TextField;
  disabled: boolean;
  onSave: (v: string) => void;
}) {
  const [value, setValue] = useState(control.secret ? '' : control.value);
  return (
    <View style={styles.block}>
      <TextInput
        label={control.label}
        value={value}
        onChangeText={setValue}
        placeholder={control.placeholder}
        secureTextEntry={control.secret}
        autoCapitalize="none"
        autoCorrect={false}
        disabled={disabled}
      />
      <Button
        mode="contained-tonal"
        disabled={disabled || !value.trim() || value === control.value}
        onPress={() => {
          onSave(value.trim());
          if (control.secret) setValue('');
        }}
      >
        Save
      </Button>
    </View>
  );
}

/** A choice with too many options for segmented buttons. */
function ChoiceMenu({
  control,
  disabled,
  onSelect,
}: {
  control: Choice;
  disabled: boolean;
  onSelect: (v: string) => void;
}) {
  const label = (o: string) => control.labels?.[control.options.indexOf(o)] ?? capitalize(o);
  return (
    <ActionMenu
      title={control.label}
      actions={control.options.map((o) => ({
        label: label(o),
        selected: o === control.value,
        onPress: () => onSelect(o),
      }))}
      anchor={(open) => (
        <List.Item
          title={control.label}
          description={label(control.value)}
          right={(p) => <List.Icon {...p} icon="menu-down" />}
          onPress={open}
          disabled={disabled}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center' },
  number: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  block: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  label: { marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1 },
});
