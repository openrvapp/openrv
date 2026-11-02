import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

import type { ThemePreference } from '@/store/settings';

// Brand seed: a calm teal that reads well in sunlight and at night.
const light: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#006A6A',
    onPrimary: '#FFFFFF',
    primaryContainer: '#9CF1F0',
    onPrimaryContainer: '#002020',
    secondary: '#4A6363',
    secondaryContainer: '#CCE8E7',
    background: '#F4FBFA',
    surface: '#F4FBFA',
    surfaceVariant: '#DAE5E4',
    error: '#BA1A1A',
  },
};

const dark: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#80D5D4',
    onPrimary: '#003737',
    primaryContainer: '#004F4F',
    onPrimaryContainer: '#9CF1F0',
    secondary: '#B0CCCB',
    secondaryContainer: '#324B4B',
    background: '#0E1514',
    surface: '#0E1514',
    surfaceVariant: '#3F4948',
    error: '#FFB4AB',
  },
};

/** Red on black, to keep night vision in a dark RV. */
const night: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#E04040',
    onPrimary: '#000000',
    primaryContainer: '#3A0A0A',
    onPrimaryContainer: '#FF7070',
    secondary: '#B03030',
    secondaryContainer: '#2A0808',
    onSecondaryContainer: '#E04040',
    background: '#000000',
    surface: '#000000',
    surfaceVariant: '#1A0505',
    onSurface: '#D03030',
    onSurfaceVariant: '#A02828',
    onBackground: '#D03030',
    outline: '#6A1A1A',
    outlineVariant: '#3A0E0E',
    error: '#FF5050',
    elevation: {
      level0: 'transparent',
      level1: '#0D0202',
      level2: '#120303',
      level3: '#170404',
      level4: '#1A0505',
      level5: '#1E0606',
    },
  },
};

export function resolveTheme(preference: ThemePreference, systemScheme: 'light' | 'dark' | null | undefined): MD3Theme {
  switch (preference) {
    case 'light':
      return light;
    case 'dark':
      return dark;
    case 'night':
      return night;
    default:
      return systemScheme === 'dark' ? dark : light;
  }
}

/** Colours for alarm severities, readable on every theme's surface. */
export function severityColor(theme: MD3Theme, severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return theme.colors.error;
  if (severity === 'warning') return theme.dark ? '#FFB951' : '#8B5000';
  return theme.colors.primary;
}
