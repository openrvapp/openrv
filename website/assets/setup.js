// The setup code: a one-time code the flasher writes into the gateway's "setup" partition along
// with the firmware, and shows as a QR code. Scanning it opens the app, which proves the code to
// the gateway and becomes its first owner. A factory reset keeps the code (the gateway comes back
// as it was flashed); reflashing writes a new one. No browser APIs, so it can be tested with Node.
//
// Block, at the start of the partition: "ORVS", version 1, length, the code (ASCII), and a CRC-32
// of all that, little-endian. The firmware reads it in firmware/main/main.cpp.

const PARTITION_TABLE_OFFSET = 0x8000;
const SETUP_SUBTYPE = 0x40;
const SETUP_LABEL = 'setup';
/** No 0/O or 1/I, so it can be typed from a printout. 32 symbols: one per 5 bits, no bias. */
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;

/** A new random code, such as "K7QM2XWPA9". */
export function generateSetupCode(fill = (a) => crypto.getRandomValues(a)) {
  const bytes = fill(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => ALPHABET[b & 31]).join('');
}

/** For people: "K7QM2-XWPA9". */
export function formatSetupCode(code) {
  return code.length === CODE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/** Where a full image's partition table puts the setup partition; undefined if it has none. */
export function setupPartition(image) {
  for (let at = PARTITION_TABLE_OFFSET; at + 32 <= image.length && at < PARTITION_TABLE_OFFSET + 0xc00; at += 32) {
    if (image[at] !== 0xaa || image[at + 1] !== 0x50) break;
    const label = new TextDecoder().decode(image.subarray(at + 12, at + 28)).replace(/\0.*$/s, '');
    if (image[at + 2] === 0x01 && image[at + 3] === SETUP_SUBTYPE && label === SETUP_LABEL)
      return { offset: u32(image, at + 4), size: u32(image, at + 8) };
  }
  return undefined;
}

/** The partition's contents for a code: the block, then erased flash (0xFF). */
export function setupBlock(code, size = 0x1000) {
  const text = new TextEncoder().encode(code);
  const block = new Uint8Array(size).fill(0xff);
  block.set([0x4f, 0x52, 0x56, 0x53, 1, text.length]); // "ORVS", version, length
  block.set(text, 6);
  const crc = crc32(block.subarray(0, 6 + text.length));
  block.set([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24], 6 + text.length);
  return block;
}

/** A copy of a full image with the code in its setup partition; undefined if it has no such partition. */
export function withSetupCode(image, code) {
  const part = setupPartition(image);
  if (!part) return undefined;
  const out = new Uint8Array(Math.max(image.length, part.offset + part.size)).fill(0xff);
  out.set(image);
  out.set(setupBlock(code, part.size), part.offset);
  return out;
}

/** The Bluetooth address phones see: the chip's base MAC (what esptool reads) plus 2, as AA:BB:…. */
export function bluetoothMac(baseMac) {
  const n = BigInt(`0x${baseMac.replace(/[^0-9a-f]/gi, '')}`) + 2n;
  const hex = (n & 0xffffffffffffn).toString(16).padStart(12, '0').toUpperCase();
  return hex.match(/../g).join(':');
}

/** What the QR code holds; the app opens it (scheme "openrv", route /claim). */
export function claimLink(mac, code) {
  return `openrv://claim?mac=${mac}&code=${code}`;
}
