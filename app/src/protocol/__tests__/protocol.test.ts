import { pinProof } from '../auth';
import { GatewayClient, GatewayError, type Transport } from '../client';
import { DemoGateway } from '../demoGateway';
import { encodeMessage, LineDecoder } from '../framing';
import type { Device, Hello, Snapshot } from '../types';

describe('framing', () => {
  it('splits a message into packets and reassembles it', () => {
    const message = { id: 1, op: 'device.command', args: { device: 'cooler', note: 'é'.repeat(100) } };
    const packets = encodeMessage(message, 20);
    expect(packets.length).toBeGreaterThan(5);
    expect(packets.every((p) => p.length <= 20)).toBe(true);

    const decoder = new LineDecoder();
    const lines = packets.flatMap((p) => decoder.push(p));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(message);
  });

  it('reads two messages from one packet', () => {
    const decoder = new LineDecoder();
    const bytes = new TextEncoder().encode('{"a":1}\n{"b":2}\n{"c"');
    expect(decoder.push(bytes)).toEqual(['{"a":1}', '{"b":2}']);
    expect(decoder.push(new TextEncoder().encode(':3}\n'))).toEqual(['{"c":3}']);
  });
});

describe('pinProof', () => {
  it('is the first 16 bytes of HMAC-SHA256 as hex', () => {
    // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?".
    const nonce = Array.from(new TextEncoder().encode('what do ya want for nothing?'), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    expect(pinProof('Jefe', nonce)).toBe('5bdcc146bf60754e6a042426089575c7');
  });
});

describe('GatewayClient with the demo gateway', () => {
  let client: GatewayClient;
  beforeEach(() => {
    client = new GatewayClient(new DemoGateway());
  });
  afterEach(() => client.close());

  it('says hello and returns a snapshot of devices', async () => {
    const hello = await client.request<Hello>('hello');
    expect(hello.proto).toBe(1);
    const snapshot = await client.request<Snapshot>('snapshot');
    expect(snapshot.devices.map((d) => d.class)).toContain('lock');
  });

  it('sends a command and receives the updated device as an event', async () => {
    const updated = new Promise<Device>((resolve) =>
      client.onEvent((e) => e.ev === 'device' && e.data.id === 'door' && resolve(e.data)),
    );
    await client.request('device.command', { device: 'door', action: 'unlock' });
    const door = await updated;
    expect(door.values.find((v) => v.key === 'last_action')?.value).toBe('unlock');
  });

  it('turns an error response into a GatewayError', async () => {
    await expect(client.request('device.command', { device: 'nope', action: 'lock' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('GatewayClient', () => {
  it('times out when the gateway never answers', async () => {
    const silent: Transport = {
      packetSize: 100,
      write: async () => undefined,
      onPacket: () => () => undefined,
      onClose: () => () => undefined,
      close: async () => undefined,
    };
    const client = new GatewayClient(silent);
    await expect(client.request('hello', undefined, 20)).rejects.toBeInstanceOf(GatewayError);
  });
});
