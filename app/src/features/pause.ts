import { AppState } from 'react-native';

import { GatewayMonitor } from '../../modules/gateway-monitor';

/**
 * Waits `ms`. In the background React Native pauses setTimeout, even while live monitoring's
 * foreground service keeps the app running, so there the wait is the service's own timer.
 */
export function pause(ms: number): Promise<void> {
  if (AppState.currentState !== 'active' && GatewayMonitor?.isRunning()) return GatewayMonitor.wait(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
