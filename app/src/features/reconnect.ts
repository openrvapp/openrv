// Getting back to the gateway after the connection drops (it restarted, or went out of range).
// One policy everywhere: the first try after a second, then twice as long each time, up to every
// 15 seconds, for as long as something wants the connection:
//   - the app while it's open (app/_layout.tsx);
//   - live monitoring, with the app in the background (features/monitoring/monitor.ts);
//   - a periodic background check, within the short time Android gives it (connectWithRetry).
import { AppState } from 'react-native';

import { pause } from '@/features/pause';
import { DEMO_GATEWAY_ID, useGateway } from '@/store/gateway';
import { useSettings } from '@/store/settings';

export const RECONNECT_FIRST_MS = 1_000;
export const RECONNECT_MAX_MS = 15_000;

export const nextDelay = (ms: number) => Math.min(ms * 2, RECONNECT_MAX_MS);

/** The gateway to stay connected to: the last one, unless the person disconnected in Settings. */
export const rememberedGateway = () => useSettings.getState().lastGatewayId;

/** A real gateway to watch for alerts in the background; the demo's alarms aren't real. */
export function watchedGateway(): string | undefined {
  const id = rememberedGateway();
  return id && id !== DEMO_GATEWAY_ID ? id : undefined;
}

let wantedInBackground = false;
let started = false;
/** A try is waiting to run; `round` changes when a newer one replaces it. */
let waiting = false;
let round = 0;
let delay = RECONNECT_FIRST_MS;

/** Whether to keep the connection up now: while the app is open, or in the background for live monitoring. */
function wanted(): string | undefined {
  if (AppState.currentState === 'active') return rememberedGateway();
  return wantedInBackground ? watchedGateway() : undefined;
}

function attempt(): void {
  const gatewayId = wanted();
  if (!gatewayId || useGateway.getState().connection !== 'disconnected') return;
  useGateway
    .getState()
    .connect(gatewayId)
    .then(
      () => (delay = RECONNECT_FIRST_MS),
      () => {
        delay = nextDelay(delay);
        schedule(); // the app shows why; keep trying
      },
    );
}

function schedule(ms = delay): void {
  if (waiting) return;
  waiting = true;
  const mine = ++round;
  pause(ms).then(() => {
    if (mine !== round) return; // replaced by reconnectSoon
    waiting = false;
    attempt();
  });
}

/** Tries again now, from the first delay: the app came to the front, or a new gateway was chosen. */
export function reconnectSoon(): void {
  delay = RECONNECT_FIRST_MS;
  round++;
  waiting = false;
  schedule(0);
}

/** Live monitoring keeps the connection up in the background too, while it runs. */
export function keepConnectedInBackground(on: boolean): void {
  wantedInBackground = on;
  if (on) schedule();
}

/** Starts watching the connection (once): reconnects whenever it drops while it's wanted. */
export function startReconnecting(): void {
  if (started) return;
  started = true;
  useGateway.subscribe((s, prev) => {
    if (s.connection === 'disconnected' && prev.connection !== 'disconnected') schedule();
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') reconnectSoon();
  });
  useSettings.subscribe((s, prev) => {
    if (s.lastGatewayId && s.lastGatewayId !== prev.lastGatewayId) delay = RECONNECT_FIRST_MS;
  });
  schedule(0);
}

/**
 * Connects within a time limit, trying again on the same schedule: a periodic background check
 * has only a short while, and the gateway may be restarting just then. Throws the last error.
 */
export async function connectWithRetry(gatewayId: string, withinMs: number): Promise<void> {
  const end = Date.now() + withinMs;
  let wait = RECONNECT_FIRST_MS;
  for (;;) {
    const state = useGateway.getState().connection;
    if (state === 'connected' || state === 'setup') return;
    try {
      if (state === 'disconnected') await useGateway.getState().connect(gatewayId);
      else await pause(500); // someone else is connecting
      if (useGateway.getState().connection === 'connected') return;
    } catch (e) {
      if (Date.now() + wait > end) throw e;
      await pause(wait);
      wait = nextDelay(wait);
    }
    if (Date.now() > end) throw new Error('Gateway not reachable');
  }
}
