import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { List, Text, useTheme } from 'react-native-paper';

import { ConnectionPanel } from '@/components/ConnectionPanel';
import { describeRule } from '@/rules';
import { selectAlarms, useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';
import { severityColor } from '@/theme';

export default function AlertsScreen() {
  const theme = useTheme();
  const connection = useGateway((s) => s.connection);
  const devices = useGateway((s) => s.devices);
  const rules = useGateway((s) => s.rules);
  const loadConfig = useGateway((s) => s.loadConfig);
  const unit = useSettings((s) => s.temperatureUnit);
  const alarms = useMemo(() => selectAlarms({ devices }), [devices]);

  useEffect(() => {
    if (connection === 'connected') loadConfig().catch(() => undefined);
  }, [connection, loadConfig]);

  if (connection !== 'connected') return <ConnectionPanel />;

  return (
    <ScrollView>
      <List.Section title="Active now">
        {alarms.length === 0 ? (
          <List.Item title="No alerts" left={(p) => <List.Icon {...p} icon="check-circle-outline" />} />
        ) : (
          alarms.map((a) => (
            <List.Item
              key={a.rule}
              title={`${a.deviceName}: ${a.label}`}
              description={a.severity}
              left={(p) => <List.Icon {...p} icon="alert-circle" color={severityColor(theme, a.severity)} />}
              onPress={() => router.push({ pathname: '/device/[id]', params: { id: a.device! } })}
            />
          ))
        )}
      </List.Section>
      {devices.map((d) => {
        const deviceRules = rules.filter((r) => r.device === d.id);
        return (
          <List.Section key={d.id} title={d.name}>
            {deviceRules.length === 0 && (
              <Text variant="bodySmall" style={{ paddingHorizontal: 16, color: theme.colors.onSurfaceVariant }}>
                No rules
              </Text>
            )}
            {deviceRules.map((r) => (
              <List.Item
                key={r.id}
                title={r.label}
                description={describeRule(r, d, unit)}
                left={(p) => (
                  <List.Icon
                    {...p}
                    icon={r.enabled === false ? 'bell-off-outline' : 'bell-outline'}
                    color={severityColor(theme, r.severity)}
                  />
                )}
                onPress={() => router.push({ pathname: '/device/[id]/alerts', params: { id: d.id } })}
              />
            ))}
          </List.Section>
        );
      })}
    </ScrollView>
  );
}
