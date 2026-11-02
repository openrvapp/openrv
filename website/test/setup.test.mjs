// Tests for the setup code the flasher writes: node --test website/test/*.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALPHABET,
  bluetoothMac,
  claimLink,
  crc32,
  formatSetupCode,
  generateSetupCode,
  setupBlock,
  setupPartition,
  withSetupCode,
} from '../assets/setup.js';

/** A full image whose partition table has nvs and, optionally, setup at 0x12000. */
function image({ setup = true } = {}) {
  const bytes = new Uint8Array(0x30000);
  bytes[0] = 0xe9;
  const entry = (i, type, subtype, offset, size, label) => {
    const at = 0x8000 + i * 32;
    bytes.set([0xaa, 0x50, type, subtype], at);
    new DataView(bytes.buffer).setUint32(at + 4, offset, true);
    new DataView(bytes.buffer).setUint32(at + 8, size, true);
    bytes.set(new TextEncoder().encode(label), at + 12);
  };
  entry(0, 0x01, 0x02, 0x9000, 0x6000, 'nvs');
  if (setup) entry(1, 0x01, 0x40, 0x12000, 0x1000, 'setup');
  return bytes;
}

test('codes use only the unambiguous alphabet', () => {
  const code = generateSetupCode();
  assert.equal(code.length, 10);
  assert.ok([...code].every((c) => ALPHABET.includes(c)));
  assert.equal(generateSetupCode((a) => a.fill(0)), 'AAAAAAAAAA');
  assert.equal(formatSetupCode('K7QM2XWPA9'), 'K7QM2-XWPA9');
});

test('crc32 is the usual CRC-32', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('the block is what the firmware reads', () => {
  const b = setupBlock('K7QM2XWPA9');
  assert.equal(new TextDecoder().decode(b.subarray(0, 4)), 'ORVS');
  assert.deepEqual([b[4], b[5]], [1, 10]);
  assert.equal(new TextDecoder().decode(b.subarray(6, 16)), 'K7QM2XWPA9');
  const crc = crc32(b.subarray(0, 16));
  assert.equal(new DataView(b.buffer).getUint32(16, true), crc);
  assert.equal(b[20], 0xff);
});

test('writes the code into a full image that has a setup partition', () => {
  assert.deepEqual(setupPartition(image()), { offset: 0x12000, size: 0x1000 });
  const out = withSetupCode(image(), 'K7QM2XWPA9');
  assert.equal(out.length, 0x30000);
  assert.equal(new TextDecoder().decode(out.subarray(0x12006, 0x12010)), 'K7QM2XWPA9');
  assert.equal(withSetupCode(image({ setup: false }), 'K7QM2XWPA9'), undefined);
});

test('the Bluetooth address is the base MAC plus 2, and goes in the claim link', () => {
  assert.equal(bluetoothMac('10:b4:1d:12:34:54'), '10:B4:1D:12:34:56');
  assert.equal(bluetoothMac('10:b4:1d:12:34:ff'), '10:B4:1D:12:35:01');
  assert.equal(claimLink('10:B4:1D:12:34:56', 'K7QM2XWPA9'), 'openrv://claim?mac=10:B4:1D:12:34:56&code=K7QM2XWPA9');
});
