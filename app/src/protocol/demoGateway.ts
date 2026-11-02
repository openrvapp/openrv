// An in-memory gateway that speaks the real protocol, for the demo mode, the web preview and tests.
import type { Transport } from './client';
import { encodeMessage, LineDecoder } from './framing';
import type { Alarm, Control, Device, Event, Hello, Model, Request, Response, Rule, Snapshot } from './types';

const PACKET = 244;

const fToC = (f: number) => ((f - 32) * 5) / 9;

/** The models the real gateway supports, plus two demo-only ones for the classes no driver covers yet. */
const MODELS: Model[] = [
  { type: 'mopeka_pro', model: 'Mopeka Pro Check', class: 'liquid_level_sensor' },
  { type: 'alpicool_cooler', model: 'Alpicool-protocol cooler', class: 'refrigerator' },
  { type: 'inkbird_ibs_th2', model: 'Inkbird IBS-TH / IBS-TH2', class: 'temperature_sensor' },
  { type: 'gopower_pwm', model: 'Go Power PWM solar controller', class: 'solar_controller' },
  { type: 'rvlock_trek', model: 'RVLock Trek', class: 'lock' },
  { type: 'demo_battery', model: 'Battery monitor (demo)', class: 'battery_monitor' },
  { type: 'demo_surge', model: 'Surge protector (demo)', class: 'surge_protector' },
];

const modelOf = (type: string) => MODELS.find((m) => m.type === type)!;

/** The lock's control as the gateway builds it from its settings. */
function lockControls(settings: Record<string, unknown>): Control[] {
  if (settings.lock_only === true) return [{ key: 'lock', label: 'Lock', kind: 'action', actions: ['lock'] }];
  return [
    {
      key: 'lock',
      label: 'Lock',
      kind: 'action',
      actions: ['lock', 'unlock'],
      ...(settings.unlock_pin === false ? {} : { pin: ['unlock'] }),
    },
  ];
}

const TANK_DEFS: Control[] = [
  {
    key: 'tank',
    label: 'Tank size',
    kind: 'choice',
    value: 'lb20_vertical',
    options: ['lb20_vertical', 'lb30_vertical', 'lb40_vertical', 'eu6kg', 'eu11kg', 'eu14kg', 'custom'],
    labels: [
      '20 lb vertical',
      '30 lb vertical',
      '40 lb vertical',
      '6 kg (Europe)',
      '11 kg (Europe)',
      '14 kg (Europe)',
      'Custom',
    ],
  },
];

function demoDevices(): Device[] {
  return [
    {
      id: 'lp-front',
      type: 'mopeka_pro',
      class: 'liquid_level_sensor',
      model: 'Mopeka Pro Check',
      traits: { fluid: 'propane' },
      name: 'Front LP',
      mac: 'C4:12:34:56:78:9A',
      settings: { tank: 'lb20_vertical' },
      setting_defs: TANK_DEFS,
      status: { online: true, rssi: -71, age_s: 4, link: 'advert' },
      values: [
        { key: 'level', label: 'Level', unit: '%', value: 62, min: 0, max: 100, decimals: 0, primary: true },
        { key: 'height', label: 'Height', unit: 'mm', value: 172, decimals: 0 },
        { key: 'temp', label: 'Temperature', unit: 'C', value: 18, decimals: 0 },
        { key: 'battery', label: 'Battery', unit: '%', value: 88, decimals: 0 },
        { key: 'quality', label: 'Echo', value: 'high', enum: ['none', 'low', 'medium', 'high'] },
      ],
      controls: [],
    },
    {
      id: 'lp-rear',
      type: 'mopeka_pro',
      class: 'liquid_level_sensor',
      model: 'Mopeka Pro Check',
      traits: { fluid: 'propane' },
      name: 'Rear LP',
      mac: 'C4:12:34:56:78:9B',
      settings: { tank: 'lb20_vertical' },
      setting_defs: TANK_DEFS,
      status: { online: true, rssi: -80, age_s: 9, link: 'advert' },
      values: [
        { key: 'level', label: 'Level', unit: '%', value: 14, min: 0, max: 100, decimals: 0, primary: true },
        { key: 'height', label: 'Height', unit: 'mm', value: 68, decimals: 0 },
        { key: 'temp', label: 'Temperature', unit: 'C', value: 17, decimals: 0 },
        { key: 'battery', label: 'Battery', unit: '%', value: 71, decimals: 0 },
        { key: 'quality', label: 'Echo', value: 'medium', enum: ['none', 'low', 'medium', 'high'] },
      ],
      controls: [],
      alarms: [
        {
          rule: 'lp-rear-low',
          device: 'lp-rear',
          key: 'level',
          state: 'low',
          severity: 'warning',
          label: 'Low',
          value: 14,
        },
      ],
    },
    {
      id: 'fridge',
      type: 'inkbird_ibs_th2',
      class: 'temperature_sensor',
      model: 'Inkbird IBS-TH / IBS-TH2',
      name: 'Fridge',
      mac: '49:22:01:AB:CD:01',
      status: { online: true, rssi: -64, age_s: 2, link: 'advert' },
      values: [
        { key: 'temp', label: 'Temperature', unit: 'C', value: 3.4, decimals: 1, primary: true },
        { key: 'humidity', label: 'Humidity', unit: '%', value: 41, decimals: 0 },
        { key: 'battery', label: 'Battery', unit: '%', value: 100, decimals: 0 },
      ],
      controls: [],
    },
    {
      id: 'cabin',
      type: 'inkbird_ibs_th2',
      class: 'temperature_sensor',
      model: 'Inkbird IBS-TH / IBS-TH2',
      name: 'Cabin',
      mac: '49:22:01:AB:CD:02',
      status: { online: true, rssi: -58, age_s: 6, link: 'advert' },
      values: [
        { key: 'temp', label: 'Temperature', unit: 'C', value: 21.7, decimals: 1, primary: true },
        { key: 'humidity', label: 'Humidity', unit: '%', value: 52, decimals: 0 },
        { key: 'battery', label: 'Battery', unit: '%', value: 93, decimals: 0 },
      ],
      controls: [],
    },
    {
      id: 'cooler',
      type: 'alpicool_cooler',
      class: 'refrigerator',
      model: 'Alpicool-protocol cooler',
      name: 'Cooler',
      mac: '94:77:F2:2E:28:EE',
      settings: { check_min: 10, keep_on: true, auto_lock: true },
      setting_defs: [
        { key: 'check_min', label: 'Check every (minutes)', kind: 'number', min: 1, max: 60, step: 1, value: 10 },
        { key: 'keep_on', label: 'Keep on: turn it back on if found off', kind: 'toggle', value: true },
        { key: 'auto_lock', label: 'Auto-lock the panel', kind: 'toggle', value: true },
      ],
      status: { online: true, rssi: -77, age_s: 140, link: 'idle' },
      values: [
        // A cooler set to °F: the gateway reports it in Celsius, like every temperature.
        {
          key: 'left.current',
          label: 'Left',
          unit: 'C',
          value: fToC(35),
          min: -20,
          max: 20,
          decimals: 1,
          primary: true,
        },
        { key: 'right.current', label: 'Right', unit: 'C', value: fToC(2), min: -20, max: 20, decimals: 1 },
        { key: 'battery_v', label: 'Supply', unit: 'V', value: 12.9, decimals: 1 },
        { key: 'battery', label: 'Battery', unit: '%', value: 76, decimals: 0 },
      ],
      controls: [
        { key: 'power', label: 'Power', kind: 'toggle', value: true },
        {
          key: 'left.target',
          label: 'Left target',
          kind: 'number',
          unit: 'C',
          min: -20,
          max: 20,
          step: 5 / 9,
          value: fToC(34),
        },
        {
          key: 'right.target',
          label: 'Right target',
          kind: 'number',
          unit: 'C',
          min: -20,
          max: 20,
          step: 5 / 9,
          value: fToC(0),
        },
        { key: 'mode', label: 'Mode', kind: 'choice', options: ['max', 'eco'], value: 'eco' },
        { key: 'locked', label: 'Panel lock', kind: 'toggle', value: true },
      ],
    },
    {
      id: 'door',
      type: 'rvlock_trek',
      class: 'lock',
      model: 'RVLock Trek',
      name: 'Door',
      mac: '5C:53:10:12:34:56',
      settings: { lock_only: false, unlock_pin: true },
      setting_defs: [
        { key: 'lock_only', label: 'Lock only (refuse unlock)', kind: 'toggle', value: false },
        { key: 'unlock_pin', label: 'Ask for the gateway PIN to unlock', kind: 'toggle', value: true },
      ],
      status: { online: true, rssi: -83, age_s: 3600, link: 'idle' },
      values: [{ key: 'last_action', label: 'Last command', value: 'lock', enum: ['lock', 'unlock'], primary: true }],
      controls: [{ key: 'lock', label: 'Lock', kind: 'action', actions: ['lock', 'unlock'], pin: ['unlock'] }],
    },
    {
      id: 'solar',
      type: 'gopower_pwm',
      class: 'solar_controller',
      model: 'Go Power PWM solar controller',
      name: 'Solar',
      mac: 'D0:5F:B8:00:11:22',
      status: { online: true, rssi: -79, age_s: 20, link: 'idle' },
      values: [
        { key: 'battery_v', label: 'Battery', unit: 'V', value: 13.6, min: 11, max: 14.6, decimals: 1, primary: true },
        { key: 'battery_pct', label: 'Charge', unit: '%', value: 87, decimals: 0 },
        { key: 'solar_w', label: 'Solar', unit: 'W', value: 142, decimals: 0 },
        { key: 'charge_a', label: 'Charging', unit: 'A', value: 10.4, decimals: 1 },
        { key: 'solar_v', label: 'Panel', unit: 'V', value: 18, decimals: 0 },
      ],
      controls: [],
    },
    {
      id: 'house-battery',
      type: 'demo_battery',
      class: 'battery_monitor',
      model: 'Battery monitor (demo)',
      name: 'House battery',
      mac: 'E8:00:00:00:00:01',
      status: { online: true, rssi: -66, age_s: 3, link: 'connected' },
      values: [
        { key: 'soc', label: 'Charge', unit: '%', value: 84, min: 0, max: 100, decimals: 0, primary: true },
        { key: 'battery_v', label: 'Voltage', unit: 'V', value: 13.28, min: 11, max: 14.6, decimals: 2 },
        { key: 'current_a', label: 'Current', unit: 'A', value: -3.6, decimals: 1 },
        { key: 'power_w', label: 'Power', unit: 'W', value: -48, decimals: 0 },
        { key: 'remaining_ah', label: 'Remaining', unit: 'Ah', value: 168, decimals: 0 },
        { key: 'time_left_min', label: 'Time left', unit: 'min', value: 2800, decimals: 0 },
      ],
      controls: [],
    },
    {
      id: 'shore-power',
      type: 'demo_surge',
      class: 'surge_protector',
      model: 'Surge protector (demo)',
      name: 'Shore power',
      mac: 'E8:00:00:00:00:02',
      status: { online: true, rssi: -74, age_s: 5, link: 'connected' },
      values: [
        { key: 'voltage_v', label: 'Voltage', unit: 'V', value: 121.4, min: 100, max: 140, decimals: 0, primary: true },
        { key: 'current_a', label: 'Current', unit: 'A', value: 11.2, decimals: 1 },
        { key: 'power_w', label: 'Power', unit: 'W', value: 1360, decimals: 0 },
        { key: 'frequency_hz', label: 'Frequency', unit: 'Hz', value: 60, decimals: 1 },
        { key: 'fault', label: 'Fault', value: null },
      ],
      controls: [],
    },
  ];
}

const demoRules: Rule[] = [
  {
    id: 'lp-front-low',
    device: 'lp-front',
    value: 'level',
    below: 20,
    hysteresis: 2,
    label: 'Low',
    severity: 'warning',
  },
  {
    id: 'lp-front-vlow',
    device: 'lp-front',
    value: 'level',
    below: 10,
    hysteresis: 2,
    label: 'Very low',
    severity: 'critical',
  },
  { id: 'lp-rear-low', device: 'lp-rear', value: 'level', below: 20, hysteresis: 2, label: 'Low', severity: 'warning' },
  {
    id: 'fridge-warm',
    device: 'fridge',
    value: 'temp',
    above: 7,
    hysteresis: 0.5,
    label: 'Warm',
    severity: 'critical',
  },
];

export class DemoGateway implements Transport {
  readonly packetSize = PACKET;
  private readonly packetHandlers = new Set<(p: Uint8Array) => void>();
  private readonly closeHandlers = new Set<(e?: Error) => void>();
  private readonly lines = new LineDecoder();
  private devices = demoDevices();
  private rules = [...demoRules];
  private subscribed = false;
  private timer?: ReturnType<typeof setInterval>;

  async write(packet: Uint8Array): Promise<void> {
    for (const line of this.lines.push(packet)) {
      const request = JSON.parse(line) as Request;
      // Answer asynchronously, like a radio would.
      setTimeout(() => this.reply(this.handle(request)), 30);
    }
  }

  onPacket(handler: (p: Uint8Array) => void): () => void {
    this.packetHandlers.add(handler);
    return () => this.packetHandlers.delete(handler);
  }

  onClose(handler: (e?: Error) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  /** A strong signal that wanders a little, like a gateway across the RV. */
  async readRssi(): Promise<number> {
    return -52 - Math.round(Math.random() * 8);
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.closeHandlers.forEach((h) => h());
  }

  private emit(message: Response | Event): void {
    for (const p of encodeMessage(message, PACKET)) this.packetHandlers.forEach((h) => h(p));
  }

  private reply(response: Response): void {
    this.emit(response);
  }

  private alarms(): Alarm[] {
    return this.devices.flatMap((d) => d.alarms ?? []);
  }

  private handle({ id, op, args = {} }: Request): Response {
    const ok = (result: unknown = {}): Response => ({ id, ok: true, result });
    const fail = (code: 'not_found' | 'bad_request', message?: string): Response => ({
      id,
      ok: false,
      error: { code, message },
    });

    switch (op) {
      case 'hello':
        return ok({
          proto: 1,
          fw: '1.0.0-demo',
          name: 'Demo RV',
          auth: { pin_set: false, ok: true },
          // The demo trusts this phone as its owner, as if it had already claimed it.
          access: { role: 'owner', paired: true, claimed: true, pairing: false, setup_code: false },
          caps: { display: false, max_devices: 24, max_links: 3 },
        } satisfies Hello);
      case 'phones.list':
        return ok({
          phones: [
            { addr: 'DE:MO:00:00:00:01', name: 'This phone', role: 'owner', you: true, connected: true },
            { addr: 'DE:MO:00:00:00:02', name: 'Pixel 8', role: 'guest', you: false, connected: false },
          ],
        });
      // No PIN is set on the demo, so like a real gateway without one it accepts any proof.
      case 'auth.challenge':
        return ok({
          nonce: Array.from({ length: 16 }, () =>
            Math.floor(Math.random() * 256)
              .toString(16)
              .padStart(2, '0'),
          ).join(''),
        });
      case 'auth.prove':
        return ok();
      case 'snapshot':
        return ok({
          gateway: { name: 'Demo RV', fw: '1.0.0-demo', uptime_s: 3600, alarms: this.alarms().length },
          devices: this.devices,
          alarms: this.alarms(),
        } satisfies Snapshot);
      case 'subscribe':
        if (!this.subscribed) {
          this.subscribed = true;
          this.timer = setInterval(() => this.tick(), 3000);
        }
        return ok();
      case 'config.get':
        return ok({
          gateway: { name: 'Demo RV', pin_set: false },
          devices: this.devices.map(({ id, type, name, mac, settings }) => ({ id, type, name, mac, settings })),
          rules: this.rules,
          models: MODELS,
        });
      case 'device.update': {
        const device = this.devices.find((d) => d.id === args.id);
        if (!device) return fail('not_found');
        if (typeof args.name === 'string') device.name = args.name;
        if (args.settings) {
          device.settings = { ...device.settings, ...(args.settings as object) };
          device.setting_defs = device.setting_defs?.map((c) =>
            c.kind !== 'action' && device.settings && c.key in device.settings
              ? ({ ...c, value: device.settings[c.key] } as Control)
              : c,
          );
          if (device.class === 'lock') device.controls = lockControls(device.settings);
        }
        this.emit({ ev: 'device', data: device });
        return ok();
      }
      case 'discovery.start':
        this.discover();
        return ok();
      case 'device.add': {
        const id = String(args.name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-');
        const model = modelOf(String(args.type));
        const device: Device = {
          id,
          type: model.type,
          class: model.class,
          model: model.model,
          name: String(args.name),
          mac: String(args.mac),
          status: { online: true, age_s: 0, link: 'advert' },
          values: [{ key: 'temp', label: 'Temperature', unit: 'C', value: 20, decimals: 1, primary: true }],
          controls: [],
        };
        this.devices.push(device);
        this.emit({ ev: 'device', data: device });
        return ok({ id });
      }
      case 'device.remove':
        this.devices = this.devices.filter((d) => d.id !== args.id);
        this.rules = this.rules.filter((r) => r.device !== args.id);
        return ok();
      case 'device.command':
        return this.command(id, args);
      case 'rule.put': {
        const rule = args as unknown as Rule;
        this.rules = [...this.rules.filter((r) => r.id !== rule.id), rule];
        return ok();
      }
      case 'rule.remove':
        this.rules = this.rules.filter((r) => r.id !== args.id);
        return ok();
      default:
        return ok();
    }
  }

  private command(id: number, args: Record<string, unknown>): Response {
    const device = this.devices.find((d) => d.id === args.device);
    if (!device) return { id, ok: false, error: { code: 'not_found' } };
    if (args.action === 'lock' || args.action === 'unlock') {
      device.values = device.values.map((v) => (v.key === 'last_action' ? { ...v, value: args.action as string } : v));
      device.status = { ...device.status, age_s: 0 };
    } else if (args.action === 'set') {
      const values = (args.values ?? {}) as Record<string, unknown>;
      device.controls = device.controls.map((c) =>
        c.kind !== 'action' && c.key in values ? ({ ...c, value: values[c.key] } as typeof c) : c,
      );
    }
    setTimeout(() => this.emit({ ev: 'device', data: device }), 400);
    return { id, ok: true, result: {} };
  }

  /** Reports a few nearby candidates over a couple of seconds, like a real scan. */
  private discover(): void {
    // Recognized and unknown devices at different strengths, and one the gateway already has.
    const nearby = [
      { mac: 'CA:6A:10:1C:EC:CD', rssi: -83, name: 'MyQ-8BC' },
      { mac: '49:23:04:08:08:0F', rssi: -48, name: 'sps', ...modelOf('inkbird_ibs_th2') },
      { mac: '7C:11:22:33:44:55', rssi: -55, name: 'Galaxy Buds' },
      { mac: 'F6:71:1E:48:0D:10', rssi: -63, ...modelOf('mopeka_pro') },
      { mac: '49:22:01:AB:CD:01', rssi: -60, name: 'tps', ...modelOf('inkbird_ibs_th2') },
      { mac: 'D4:1A:9E:00:00:02', rssi: -77, ...modelOf('mopeka_pro') },
    ];
    nearby.forEach((d, i) =>
      setTimeout(
        () => this.emit({ ev: 'discovery', data: { ...d, added: this.devices.some((x) => x.mac === d.mac) } }),
        300 + i * 500,
      ),
    );
  }

  /** Small changes to the thermometers and the solar controller, so the demo looks alive. */
  private tick(): void {
    const jitter = (n: number, by: number, places: number) =>
      Math.round((n + (Math.random() - 0.5) * by) * 10 ** places) / 10 ** places;
    for (const d of this.devices) {
      if (d.class === 'temperature_sensor') {
        d.values = d.values.map((v) =>
          v.key === 'temp' && typeof v.value === 'number' ? { ...v, value: jitter(v.value, 0.4, 1) } : v,
        );
      } else if (d.class === 'solar_controller') {
        const watts = d.values.find((v) => v.key === 'solar_w')?.value;
        const solar = Math.max(0, jitter(typeof watts === 'number' ? watts : 140, 12, 0));
        d.values = d.values.map((v) =>
          v.key === 'solar_w'
            ? { ...v, value: solar }
            : v.key === 'charge_a'
              ? { ...v, value: Math.round((solar / 13.6) * 10) / 10 }
              : v,
        );
      } else {
        continue;
      }
      d.status = { ...d.status, age_s: 0 };
      this.emit({ ev: 'device', data: d });
    }
  }
}
