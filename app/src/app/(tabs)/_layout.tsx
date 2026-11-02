import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import { useTheme } from 'react-native-paper';

import { selectAlarms, useGateway } from '@/store/gateway';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  // React Navigation types the tint as a ColorValue; ours are always theme strings.
  return ({ color, size }: { color: unknown; size: number }) => (
    <MaterialCommunityIcons name={name} color={color as string} size={size} />
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const alarmCount = useGateway((s) => selectAlarms(s).length);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        tabBarStyle: { backgroundColor: theme.colors.elevation.level2, borderTopColor: theme.colors.outlineVariant },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: tabIcon('view-dashboard') }} />
      <Tabs.Screen name="devices" options={{ title: 'Devices', tabBarIcon: tabIcon('devices') }} />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarIcon: tabIcon('bell'),
          tabBarBadge: alarmCount || undefined,
          tabBarBadgeStyle: { backgroundColor: theme.colors.error, color: theme.colors.onError },
        }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('cog') }} />
    </Tabs>
  );
}
