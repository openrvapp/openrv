import type { ConfigContext, ExpoConfig } from 'expo/config';

// Development builds get their own app ID so they install next to the Play Store release.
// Build one with: APP_VARIANT=development npx expo run:android
const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'OpenRV (dev)' : 'OpenRV',
  slug: 'openrv',
  android: {
    ...config.android,
    package: IS_DEV ? 'app.openrv.dev' : 'app.openrv',
  },
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? 'app.openrv.dev' : 'app.openrv',
  },
});
