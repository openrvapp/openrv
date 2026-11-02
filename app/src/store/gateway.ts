import { Platform } from 'react-native';
import { create } from 'zustand';

import { GatewayPairing } from '../../modules/gateway-pairing';
import { GatewayTransport } from '@/ble';
import { pause } from '@/features/pause';
import { accessOf, join } from '@/protocol/access';
import { authenticate } from '@/protocol/auth';
import { GatewayClient, type Transport } from '@/protocol/client';
import { DemoGateway } from '@/protocol/demoGateway';
import type {
  Access,
  Alarm,
  Config,
  Device,
  DeviceType,
  DiscoveredDevice,
  Event,
  GatewayStatus,
  Hello,
  KnownPhone,
  Model,
  Op,
  OtaBegin,
  Rule,
  Snapshot,
} from '@/protocol/types';

export const DEMO_GATEWAY_ID = 'demo';

/** "setup": reached a gateway that has no owner yet; it needs its setup code or BOOT button. */
type Connection = 'disconnected' | 'connecting' | 'setup' | 'connected';

/** What the gateway calls this phone in its list of phones. */
export function phoneName(): string {
  const c = Platform.constants as { Model?: string; Manufacturer?: string; Brand?: string };
  if (Platform.OS === 'android' && c.Model) {
    const maker = c.Manufacturer ?? c.Brand ?? '';
    const name = c.Model.toLowerCase().startsWith(maker.toLowerCase()) ? c.Model : `${maker} ${c.Model}`;
    return name.trim().slice(0, 32);
  }
  return Platform.OS === 'ios' ? 'iPhone' : 'Phone';
}

interface GatewayState {
  connection: Connection;
  gatewayId?: string;
  error?: string;
  hello?: Hello;
  /** This phone's role on the gateway, and whether it may pair or claim. */
  access?: Access;
  /** The Bluetooth signal strength to the gateway, in dBm, while connected. */
  rssi?: number;
  status?: GatewayStatus;
  /** Devices in the gateway's order. */
  devices: Device[];
  rules: Rule[];
  /** The models the gateway supports (from config.get), for adding a device by hand. */
  models: Model[];
  /** Nearby devices reported while discovery runs, strongest first. */
  discovered: DiscoveredDevice[];

  /** Connects, pairing when needed; with a setup code (from the flasher's QR code), claims a new gateway. */
  connect(gatewayId: string, pin?: string, setupCode?: string): Promise<void>;
  /**
   * In "setup": tries again to get in, pairing first when needed. With the setup code, or while the
   * gateway is in pairing mode, a gateway without an owner gets this phone as its owner.
   */
  resume(setupCode?: string): Promise<void>;
  listPhones(): Promise<KnownPhone[]>;
  updatePhone(addr: string, changes: { name?: string; role?: 'owner' | 'guest' }): Promise<void>;
  removePhone(addr: string): Promise<void>;
  /** Lets one new phone pair for a couple of minutes, joining as `role`. */
  openPairing(role: 'owner' | 'guest'): Promise<void>;
  /** Any request to the gateway (firmware updates send pieces this way). */
  request<T = unknown>(op: Op, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  loadConfig(): Promise<Config>;
  command(deviceId: string, action: string, values?: Record<string, unknown>): Promise<void>;
  updateDevice(deviceId: string, changes: { name?: string; settings?: Record<string, unknown> }): Promise<void>;
  removeDevice(deviceId: string): Promise<void>;
  addDevice(device: { type: DeviceType; mac: string; name: string }): Promise<string>;
  startDiscovery(seconds?: number): Promise<void>;
  stopDiscovery(): Promise<void>;
  /** Opens the gateway's firmware-update Wi-Fi for a few minutes. */
  openUpdateWindow(): Promise<OtaBegin>;
  putRule(rule: Rule): Promise<void>;
  removeRule(ruleId: string): Promise<void>;
  authenticate(pin: string): Promise<void>;
}

let client: GatewayClient | undefined;
const SIGNAL_EVERY_MS = 5_000;
/** Set while connecting again after forgetting a stale pairing, so it's tried once. */
let forgotStale = false;

function requireClient(): GatewayClient {
  if (!client) throw new Error('Not connected to a gateway');
  return client;
}

function replaceDevice(devices: Device[], device: Device): Device[] {
  const i = devices.findIndex((d) => d.id === device.id);
  if (i < 0) return [...devices, device];
  const next = devices.slice();
  next[i] = device;
  return next;
}

function applyAlarm(devices: Device[], alarm: Alarm): Device[] {
  return devices.map((d) => {
    if (d.id !== alarm.device) return d;
    const others = (d.alarms ?? []).filter((a) => a.rule !== alarm.rule);
    return { ...d, alarms: alarm.state === 'normal' ? others : [...others, alarm] };
  });
}

/** Starts pairing from the phone where the app can (Android), so Android asks only once. */
function pairFromPhone(gatewayId?: string): (() => Promise<boolean>) | undefined {
  const pairing = GatewayPairing;
  if (!pairing || !gatewayId || gatewayId === DEMO_GATEWAY_ID) return undefined;
  return () => pairing.createBond(gatewayId);
}

export const useGateway = create<GatewayState>()((set, get) => {
  /** Past pairing and claiming: load what's on the gateway. */
  async function finish(c: GatewayClient, hello: Hello): Promise<void> {
    const snapshot = await c.request<Snapshot>('snapshot');
    await c.request('subscribe');
    if (client !== c) return;
    set({ connection: 'connected', hello, status: snapshot.gateway, devices: snapshot.devices });
    watchSignal(c);
  }

  /** Reads the signal strength every few seconds for as long as this connection lasts. */
  async function watchSignal(c: GatewayClient): Promise<void> {
    while (client === c) {
      const rssi = await c.readRssi()?.catch(() => undefined);
      if (client !== c) return;
      if (rssi === undefined && get().rssi === undefined) return; // this transport can't tell
      if (rssi !== undefined && rssi !== get().rssi) set({ rssi });
      await pause(SIGNAL_EVERY_MS);
    }
  }

  function onEvent(event: Event): void {
    switch (event.ev) {
      case 'access': {
        const was = get().access;
        set({ access: event.data });
        // Someone put the gateway in pairing mode while this phone waited: pair, and claim it if
        // it has no owner yet.
        if (get().connection === 'setup' && event.data.pairing && !was?.pairing)
          get()
            .resume()
            .catch((e: Error) => set({ error: e.message }));
        break;
      }
      case 'device':
        set((s) => ({ devices: replaceDevice(s.devices, event.data) }));
        break;
      case 'device.removed':
        set((s) => ({ devices: s.devices.filter((d) => d.id !== event.data.id) }));
        break;
      case 'alarm':
        set((s) => ({ devices: applyAlarm(s.devices, event.data) }));
        break;
      case 'gateway':
        set({ status: event.data });
        break;
      case 'discovery': {
        const found = event.data;
        set((s) => ({
          discovered: [...s.discovered.filter((d) => d.mac !== found.mac), found].sort((a, b) => b.rssi - a.rssi),
        }));
        break;
      }
    }
  }

  return {
    connection: 'disconnected',
    devices: [],
    rules: [],
    models: [],
    discovered: [],

    async connect(gatewayId, pin, setupCode) {
      await get().disconnect();
      set({ connection: 'connecting', gatewayId, error: undefined });
      try {
        const transport: Transport =
          gatewayId === DEMO_GATEWAY_ID ? new DemoGateway() : await GatewayTransport.connect(gatewayId);
        const c = new GatewayClient(transport);
        client = c;
        transport.onClose((e) => {
          if (client !== c) return;
          client = undefined;
          set({ connection: 'disconnected', error: e?.message, rssi: undefined });
        });
        c.onEvent(onEvent);

        const hello = await c.request<Hello>('hello', { phone: phoneName() });
        set({ access: accessOf(hello) });
        const stale = () => !forgotStale && (GatewayPairing?.isBonded(gatewayId) ?? false);
        const access = await join(c, hello, phoneName(), setupCode, pairFromPhone(gatewayId), stale);
        set({ access });
        // The phone still has a pairing the gateway doesn't (it was reset or reflashed). Android
        // tries those old keys on every connection, which stalls pairing, so forget them and
        // connect again with a clean slate.
        if (!access.paired && stale() && (await GatewayPairing!.forgetBond(gatewayId))) {
          forgotStale = true;
          try {
            return await get().connect(gatewayId, pin, setupCode);
          } finally {
            forgotStale = false;
          }
        }
        if (access.role === 'none') {
          set({ connection: 'setup', hello });
          return;
        }
        if (hello.auth.pin_set && !hello.auth.ok && pin) await authenticate(c, pin);
        await finish(c, hello);
      } catch (e) {
        client = undefined;
        set({ connection: 'disconnected', error: (e as Error).message });
        throw e;
      }
    },

    async disconnect() {
      const c = client;
      client = undefined;
      set({
        connection: 'disconnected',
        hello: undefined,
        access: undefined,
        rssi: undefined,
        status: undefined,
        devices: [],
        rules: [],
        models: [],
      });
      await c?.close();
    },

    async resume(setupCode) {
      const c = requireClient();
      const { hello, access: current, gatewayId } = get();
      if (!hello || !current) return;
      set({ error: undefined });
      const access = await join(c, { ...hello, access: current }, phoneName(), setupCode, pairFromPhone(gatewayId));
      set({ access });
      if (access.role !== 'none') await finish(c, hello);
    },

    async listPhones() {
      const { phones } = await requireClient().request<{ phones: KnownPhone[] }>('phones.list');
      return phones;
    },

    async updatePhone(addr, changes) {
      await requireClient().request('phones.update', { addr, ...changes });
    },

    async removePhone(addr) {
      await requireClient().request('phones.remove', { addr });
    },

    request(op, args, timeoutMs) {
      return requireClient().request(op, args, timeoutMs);
    },

    async openPairing(role) {
      await requireClient().request('pairing.open', { role, seconds: 120 });
    },

    async refresh() {
      const snapshot = await requireClient().request<Snapshot>('snapshot');
      set({ status: snapshot.gateway, devices: snapshot.devices });
    },

    async loadConfig() {
      const config = await requireClient().request<Config>('config.get');
      set({ rules: config.rules, models: config.models ?? [] });
      return config;
    },

    async command(deviceId, action, values) {
      await requireClient().request('device.command', { device: deviceId, action, ...(values && { values }) }, 30_000);
    },

    async updateDevice(deviceId, changes) {
      await requireClient().request('device.update', { id: deviceId, ...changes });
    },

    async removeDevice(deviceId) {
      await requireClient().request('device.remove', { id: deviceId });
      set((s) => ({
        devices: s.devices.filter((d) => d.id !== deviceId),
        rules: s.rules.filter((r) => r.device !== deviceId),
      }));
    },

    async addDevice(device) {
      const { id } = await requireClient().request<{ id: string }>('device.add', { ...device });
      return id;
    },

    async startDiscovery(seconds = 60) {
      set({ discovered: [] });
      await requireClient().request('discovery.start', { seconds });
    },

    async openUpdateWindow() {
      return requireClient().request<OtaBegin>('ota.begin', { minutes: 10 });
    },

    async stopDiscovery() {
      await client?.request('discovery.stop').catch(() => undefined);
    },

    async putRule(rule) {
      await requireClient().request('rule.put', { ...rule });
      set((s) => ({ rules: [...s.rules.filter((r) => r.id !== rule.id), rule] }));
    },

    async removeRule(ruleId) {
      await requireClient().request('rule.remove', { id: ruleId });
      set((s) => ({ rules: s.rules.filter((r) => r.id !== ruleId) }));
    },

    async authenticate(pin) {
      await authenticate(requireClient(), pin);
      set((s) => (s.hello ? { hello: { ...s.hello, auth: { ...s.hello.auth, ok: true } } } : {}));
    },
  };
});

/** Every active alarm across devices, most severe first. */
export function selectAlarms(s: Pick<GatewayState, 'devices'>): (Alarm & { deviceName: string })[] {
  const rank = { critical: 0, warning: 1, info: 2 };
  return s.devices
    .flatMap((d) => (d.alarms ?? []).map((a) => ({ ...a, device: d.id, deviceName: d.name })))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Whether this phone may change the gateway's settings, devices, alerts and phones. */
export function useIsOwner(): boolean {
  return useGateway((s) => s.access?.role === 'owner');
}
