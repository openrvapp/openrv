// Reads what an ESP-IDF firmware image is before it's flashed: a full image (bootloader, partition
// table and app, as `idf.py merge-bin` writes it) or an app image alone, which chip it was built
// for, and the app's name and version. No browser APIs, so it can be tested with Node.

const IMAGE_MAGIC = 0xe9;
const PARTITION_TABLE_OFFSET = 0x8000;
const PARTITION_MAGIC = [0xaa, 0x50];
const APP_DESC_MAGIC = 0xabcd5432;
/** The app description sits right after the image header (24 bytes) and first segment header (8). */
const APP_DESC_OFFSET = 0x20;

/** ESP-IDF chip ids (esp_chip_id_t), as found in an image header. */
export const CHIP_NAMES = {
  0x0000: 'ESP32',
  0x0002: 'ESP32-S2',
  0x0005: 'ESP32-C3',
  0x0009: 'ESP32-S3',
  0x000c: 'ESP32-C2',
  0x000d: 'ESP32-C6',
  0x0010: 'ESP32-H2',
  0x0012: 'ESP32-P4',
  0x0014: 'ESP32-C61',
  0x0017: 'ESP32-C5',
};

const FLASH_SIZES_MB = [1, 2, 4, 8, 16, 32, 64, 128];

function text(bytes, start, length) {
  const slice = bytes.subarray(start, start + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
}

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/** The app description (esp_app_desc_t) of the app image starting at `at`, or undefined. */
function appDescription(bytes, at) {
  const d = at + APP_DESC_OFFSET;
  if (bytes.length < d + 144 || bytes[at] !== IMAGE_MAGIC || u32(bytes, d) !== APP_DESC_MAGIC) return undefined;
  return {
    version: text(bytes, d + 16, 32),
    project: text(bytes, d + 48, 32),
    built: `${text(bytes, d + 96, 16)} ${text(bytes, d + 80, 16)}`.trim(),
    idf: text(bytes, d + 112, 32),
  };
}

/** Where the factory or first OTA app starts, from the partition table; undefined if not found. */
function firstAppOffset(bytes) {
  for (let at = PARTITION_TABLE_OFFSET; at + 32 <= bytes.length && at < PARTITION_TABLE_OFFSET + 0xc00; at += 32) {
    if (bytes[at] !== PARTITION_MAGIC[0] || bytes[at + 1] !== PARTITION_MAGIC[1]) break;
    if (bytes[at + 2] === 0x00) return u32(bytes, at + 4); // type "app"
  }
  return undefined;
}

/**
 * What an image is.
 * kind: 'full' (flash at 0x0), 'app' (an app image alone) or 'unknown'.
 */
export function inspectImage(bytes) {
  if (bytes.length < 32 || bytes[0] !== IMAGE_MAGIC) return { kind: 'unknown', size: bytes.length };
  const chipId = bytes[12] | (bytes[13] << 8);
  const flashSizeMb = FLASH_SIZES_MB[bytes[3] >> 4];
  const hasPartitionTable =
    bytes.length > PARTITION_TABLE_OFFSET + 32 &&
    bytes[PARTITION_TABLE_OFFSET] === PARTITION_MAGIC[0] &&
    bytes[PARTITION_TABLE_OFFSET + 1] === PARTITION_MAGIC[1];
  if (hasPartitionTable) {
    const appAt = firstAppOffset(bytes);
    return {
      kind: 'full',
      size: bytes.length,
      chipId,
      chip: CHIP_NAMES[chipId],
      flashSizeMb,
      app: appAt !== undefined ? appDescription(bytes, appAt) : undefined,
    };
  }
  return { kind: 'app', size: bytes.length, chipId, chip: CHIP_NAMES[chipId], flashSizeMb, app: appDescription(bytes, 0) };
}

/** Hex SHA-256 of the bytes (Web Crypto, in browsers and Node). */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
