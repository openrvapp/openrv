// TypeScript mirror of protocol/schema.json (gateway protocol version 1).

export const PROTOCOL_VERSION = 1;

/** A protocol driver's id, such as "mopeka_pro". The app never depends on the list (config.get has it). */
export type DeviceType = string;
/** What a device is, whatever its maker; it decides the device's cards (docs/device-classes.md). */
export type DeviceClass =
  | 'temperature_sensor'
  | 'liquid_level_sensor'
  | 'battery_monitor'
  | 'solar_controller'
  | 'refrigerator'
  | 'lock'
  | 'surge_protector';
export type Severity = 'info' | 'warning' | 'critical';
/** Temperatures are always Celsius on the wire. */
export type Unit = 'C' | '%' | 'V' | 'A' | 'W' | 'Hz' | 'Ah' | 'kWh' | 'mm' | 'min' | 'dBm';
export type LinkState = 'advert' | 'connected' | 'idle' | 'connecting' | 'unreachable' | 'error';

export type Op =
  | 'hello'
  | 'pair'
  | 'claim'
  | 'phones.list'
  | 'phones.update'
  | 'phones.remove'
  | 'pairing.open'
  | 'auth.challenge'
  | 'auth.prove'
  | 'snapshot'
  | 'subscribe'
  | 'config.get'
  | 'device.add'
  | 'device.update'
  | 'device.remove'
  | 'device.command'
  | 'rule.put'
  | 'rule.remove'
  | 'gateway.update'
  | 'discovery.start'
  | 'discovery.stop'
  | 'ota.begin'
  | 'ota.send.begin'
  | 'ota.send.data'
  | 'ota.send.end'
  | 'ota.send.abort'
  | 'gateway.reboot'
  | 'gateway.reset';

export type ErrorCode =
  | 'bad_request'
  | 'not_authorized'
  | 'auth_failed'
  | 'not_found'
  | 'unreachable'
  | 'busy'
  | 'refused'
  | 'unsupported'
  | 'internal';

export interface Request {
  id: number;
  op: Op;
  args?: Record<string, unknown>;
}

export interface Response {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { code: ErrorCode; message?: string };
}

export type Event =
  | { ev: 'device'; data: Device }
  | { ev: 'device.removed'; data: { id: string } }
  | { ev: 'alarm'; data: Alarm }
  | { ev: 'gateway'; data: GatewayStatus }
  | { ev: 'discovery'; data: DiscoveredDevice }
  | { ev: 'wifi'; data: { on: boolean; seconds_left: number } }
  | { ev: 'access'; data: Access };

/** What a phone may do. Guests watch and operate devices; owners also change settings and decide who gets in. */
export type Role = 'none' | 'guest' | 'owner';

/** This phone's standing with the gateway (hello, the "access" event, and pair/claim answers). */
export interface Access {
  role: Role;
  /** The link is bonded and encrypted. */
  paired: boolean;
  /** The gateway has an owner. */
  claimed: boolean;
  /** New phones may pair now (the BOOT button, or an owner's "Add a phone"). */
  pairing: boolean;
  /** The flasher wrote a setup code, so the first owner can claim with it. */
  setup_code: boolean;
  /** Why the gateway won't let this phone in; it disconnects right after. */
  refused?: 'pairing_closed' | 'full';
}

/** A phone the gateway lets in (phones.list). */
export interface KnownPhone {
  /** Its Bluetooth identity address. */
  addr: string;
  name: string;
  role: Exclude<Role, 'none'>;
  /** The phone asking. */
  you: boolean;
  connected: boolean;
}

export type Message = Response | Event;

export interface Hello {
  proto: number;
  fw: string;
  name: string;
  /** The gateway's Bluetooth address; phones keep a dashboard per gateway by it. */
  mac?: string;
  auth: { pin_set: boolean; ok: boolean };
  /** Missing on firmware before 0.4, which lets every phone in. */
  access?: Access;
  caps: { display?: boolean; max_devices?: number; max_links?: number };
}

export interface DeviceStatus {
  online: boolean;
  rssi?: number;
  age_s?: number | null;
  link?: LinkState;
  busy?: boolean;
}

export interface Value {
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit?: Unit;
  min?: number;
  max?: number;
  decimals?: number;
  enum?: string[];
  primary?: boolean;
}

interface ControlBase {
  key: string;
  label: string;
  disabled?: boolean;
}

export type Control =
  | (ControlBase & { kind: 'toggle'; value: boolean })
  | (ControlBase & { kind: 'number'; value: number; unit?: string; min: number; max: number; step?: number })
  | (ControlBase & { kind: 'choice'; value: string; options: string[]; labels?: string[] })
  | (ControlBase & { kind: 'action'; actions: string[]; confirm?: string[]; pin?: string[] })
  | (ControlBase & { kind: 'text'; value: string; secret?: boolean; placeholder?: string });

export interface Alarm {
  rule: string;
  device?: string;
  /** The value key the rule watches, e.g. "level". */
  key?: string;
  state: 'normal' | 'low' | 'high';
  severity: Severity;
  label: string;
  value?: number | null;
  since_s?: number;
}

export interface Device {
  id: string;
  type: DeviceType;
  class: DeviceClass;
  /** The maker and model, for people. */
  model: string;
  /** Fixed facts about the model, such as { fluid: 'propane' }. */
  traits?: { fluid?: 'propane' | 'fresh_water' | 'grey_water' | 'black_water' | 'fuel' | 'other' };
  name: string;
  mac: string;
  settings?: Record<string, unknown>;
  /** How to edit `settings`: same shapes as controls, keyed by setting name. */
  setting_defs?: Control[];
  status: DeviceStatus;
  values: Value[];
  controls: Control[];
  alarms?: Alarm[];
}

export interface Rule {
  id: string;
  device: string;
  value: string;
  below?: number | null;
  above?: number | null;
  hysteresis?: number;
  hold_s?: number;
  label: string;
  severity: Severity;
  enabled?: boolean;
}

export interface GatewayStatus {
  name: string;
  fw: string;
  uptime_s: number;
  heap_free?: number;
  alarms: number;
}

export interface Snapshot {
  gateway: GatewayStatus;
  devices: Device[];
  alarms: Alarm[];
}

export interface Config {
  gateway: { name: string; pin_set: boolean };
  devices: Pick<Device, 'id' | 'type' | 'name' | 'mac' | 'settings'>[];
  rules: Rule[];
  /** The models this gateway supports, for adding a device by hand. */
  models?: Model[];
}

export interface Model {
  type: DeviceType;
  model: string;
  class: DeviceClass;
}

export interface DiscoveredDevice {
  mac: string;
  rssi: number;
  name?: string;
  type?: DeviceType;
  class?: DeviceClass;
  model?: string;
  preview?: Value[];
  added?: boolean;
}

export interface OtaBegin {
  ssid: string;
  password: string;
  url: string;
  token: string;
  expires_s: number;
}

export function isEvent(m: Message): m is Event {
  return 'ev' in m;
}
