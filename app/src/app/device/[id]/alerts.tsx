import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, List, Portal, SegmentedButtons, Switch, TextInput, useTheme } from 'react-native-paper';

import { displayUnit, fromDisplayTemperature, isTemperature, toDisplayTemperature } from '@/format';
import { describeRule, newRuleId } from '@/rules';
import type { Device, Rule, Severity } from '@/protocol/types';
import { toast } from '@/store/dialogs';
import { useGateway, useIsOwner } from '@/store/gateway';
import { type TemperatureUnit, useSettings } from '@/store/settings';
import { severityColor } from '@/theme';

export default function DeviceAlertsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useGateway((s) => s.devices.find((d) => d.id === id));
  const loadConfig = useGateway((s) => s.loadConfig);
  useEffect(() => {
    loadConfig().catch(() => undefined);
  }, [loadConfig]);
  return device ? <DeviceAlerts device={device} /> : null;
}

function DeviceAlerts({ device }: { device: Device }) {
  const theme = useTheme();
  const unit = useSettings((s) => s.temperatureUnit);
  const rules = useGateway((s) => s.rules);
  const putRule = useGateway((s) => s.putRule);
  const owner = useIsOwner();
  const [editing, setEditing] = useState<Rule>();
  const mine = rules.filter((r) => r.device === device.id);
  const numeric = device.values.filter((v) => typeof v.value === 'number' || v.value === null);

  const toggle = (r: Rule, enabled: boolean) => putRule({ ...r, enabled }).catch((e: Error) => toast(e.message));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {mine.map((r) => (
        <List.Item
          key={r.id}
          title={r.label}
          description={describeRule(r, device, unit)}
          left={(p) => <List.Icon {...p} icon="bell-outline" color={severityColor(theme, r.severity)} />}
          right={() => <Switch value={r.enabled !== false} onValueChange={(v) => toggle(r, v)} disabled={!owner} />}
          onPress={owner ? () => setEditing(r) : undefined}
        />
      ))}
      {!owner && (
        <List.Item
          title="Only the gateway's owners can change its alerts"
          titleNumberOfLines={2}
          left={(p) => <List.Icon {...p} icon="account-lock-outline" />}
        />
      )}
      {owner && numeric.length > 0 && (
        <View style={styles.block}>
          <Button
            mode="contained-tonal"
            icon="plus"
            onPress={() =>
              setEditing({
                id: '',
                device: device.id,
                value: numeric[0].key,
                label: '',
                severity: 'warning',
                hysteresis: 0,
              })
            }
          >
            Add alert
          </Button>
        </View>
      )}
      {editing && (
        <RuleDialog
          device={device}
          rule={editing}
          taken={rules.map((r) => r.id)}
          onDismiss={() => setEditing(undefined)}
        />
      )}
    </ScrollView>
  );
}

function parse(text: string): number | null {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Thresholds are stored on the gateway in its units (Celsius for temperatures) and edited in the app's.
function thresholdText(n: number | null | undefined, temperature: boolean, unit: TemperatureUnit): string {
  if (n === null || n === undefined) return '';
  return temperature ? Number(toDisplayTemperature(n, unit).toFixed(1)).toString() : n.toString();
}

function thresholdValue(text: string, temperature: boolean, unit: TemperatureUnit): number | null {
  const n = parse(text);
  if (n === null || !temperature) return n;
  return Math.round(fromDisplayTemperature(n, unit) * 100) / 100;
}

/** One sheet for a whole rule: which value, below/above, label and severity. */
function RuleDialog({
  device,
  rule,
  taken,
  onDismiss,
}: {
  device: Device;
  rule: Rule;
  taken: string[];
  onDismiss: () => void;
}) {
  const putRule = useGateway((s) => s.putRule);
  const removeRule = useGateway((s) => s.removeRule);
  const unit = useSettings((s) => s.temperatureUnit);
  const ruleIsTemp = isTemperature(device.values.find((v) => v.key === rule.value)?.unit);
  const [value, setValue] = useState(rule.value);
  const [label, setLabel] = useState(rule.label);
  const [below, setBelow] = useState(thresholdText(rule.below, ruleIsTemp, unit));
  const [above, setAbove] = useState(thresholdText(rule.above, ruleIsTemp, unit));
  const [severity, setSeverity] = useState<Severity>(rule.severity);
  const valueDef = device.values.find((v) => v.key === value);
  const temperature = isTemperature(valueDef?.unit);
  const suffix = displayUnit(valueDef?.unit, unit);
  const valid = label.trim() !== '' && (parse(below) !== null || parse(above) !== null);

  const save = async () => {
    const id = rule.id || newRuleId(device.id, label, taken);
    try {
      await putRule({
        ...rule,
        id,
        value,
        label: label.trim(),
        severity,
        below: thresholdValue(below, temperature, unit),
        above: thresholdValue(above, temperature, unit),
      });
      onDismiss();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss}>
        <Dialog.Title>{rule.id ? 'Edit alert' : 'New alert'}</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView contentContainerStyle={styles.dialog}>
            <SegmentedButtons
              value={value}
              onValueChange={setValue}
              buttons={device.values
                .filter((v) => typeof v.value === 'number' || v.value === null)
                .map((v) => ({ value: v.key, label: v.label }))}
            />
            <TextInput label="Name" placeholder="e.g. Low" value={label} onChangeText={setLabel} maxLength={24} />
            <View style={styles.row}>
              <TextInput
                style={styles.flex}
                label="Below"
                value={below}
                onChangeText={setBelow}
                keyboardType="decimal-pad"
                right={<TextInput.Affix text={suffix} />}
              />
              <TextInput
                style={styles.flex}
                label="Above"
                value={above}
                onChangeText={setAbove}
                keyboardType="decimal-pad"
                right={<TextInput.Affix text={suffix} />}
              />
            </View>
            <SegmentedButtons
              value={severity}
              onValueChange={(v) => setSeverity(v as Severity)}
              buttons={[
                { value: 'info', label: 'Info' },
                { value: 'warning', label: 'Warning' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {rule.id !== '' && (
            <Button onPress={() => removeRule(rule.id).then(onDismiss, (e: Error) => toast(e.message))}>Delete</Button>
          )}
          <Button onPress={onDismiss}>Cancel</Button>
          <Button onPress={save} disabled={!valid}>
            Save
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 8, paddingBottom: 32 },
  block: { padding: 16 },
  dialog: { gap: 12, paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
