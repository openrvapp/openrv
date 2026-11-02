import { compareVersions, imageVersion, installOverBluetooth, toBase64 } from '../firmware';
import type { File } from 'expo-file-system';

jest.mock('expo-file-system', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('../../../modules/gateway-wifi', () => ({ GatewayWifi: null }));

function fakeImage(version: string): Uint8Array {
  const b = new Uint8Array(256);
  b[0] = 0xe9;
  b.set([0x32, 0x54, 0xcd, 0xab], 32);
  b.set(new TextEncoder().encode(version), 48);
  return b;
}

describe('firmware', () => {
  it('reads the version from an ESP32 app image', () => {
    expect(imageVersion(fakeImage('0.2.1'))).toBe('0.2.1');
  });

  it('rejects files that are not app images', () => {
    expect(imageVersion(new Uint8Array(256))).toBeNull();
  });

  it('orders versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
  });

  it('encodes base64 the way the gateway decodes it', () => {
    const enc = (t: string) => toBase64(new TextEncoder().encode(t));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(toBase64(new Uint8Array([0, 255, 128, 7]))).toBe('AP+ABw==');
  });

  it('sends an image over Bluetooth in order, then finishes', async () => {
    const image = new Uint8Array(5000).map((_, i) => i & 0xff);
    const file = { exists: true, bytes: async () => image } as unknown as File;
    const sent: number[] = [];
    let received = 0;
    const request = jest.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === 'ota.send.begin') return { chunk: 2048 };
      if (op === 'ota.send.data') {
        sent.push(args!.offset as number);
        received += atob(args!.data as string).length;
      }
      return {};
    }) as never;
    const steps: string[] = [];
    const progress: number[] = [];
    await installOverBluetooth(
      file,
      request,
      (s) => steps.push(s),
      (f) => progress.push(f),
    );
    expect(sent).toEqual([0, 2048, 4096]);
    expect(received).toBe(5000);
    expect(steps).toEqual(['sending', 'checking', 'restarting']);
    expect(progress.at(-1)).toBe(1);
  });

  it('tells the gateway to drop a half-sent image when sending fails', async () => {
    const file = { exists: true, bytes: async () => new Uint8Array(5000) } as unknown as File;
    const ops: string[] = [];
    const request = jest.fn(async (op: string) => {
      ops.push(op);
      if (op === 'ota.send.begin') return { chunk: 2048 };
      if (op === 'ota.send.data' && ops.filter((o) => o === op).length === 2) throw new Error('lost');
      return {};
    }) as never;
    await expect(
      installOverBluetooth(
        file,
        request,
        () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow('lost');
    expect(ops).toContain('ota.send.abort');
    expect(ops).not.toContain('ota.send.end');
  });
});
