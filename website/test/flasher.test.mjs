// Tests for the flasher's firmware and board checks: node --test website/test/*.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectImage } from '../assets/image.js';
import { boardChecks, describeNeeds, psramFromFeatures, requirementsFor } from '../assets/requirements.js';

/** A minimal ESP image header: magic, flash size code, chip id; optionally a partition table. */
function image({ chipId = 9, flashCode = 2, full = true } = {}) {
  const bytes = new Uint8Array(full ? 0x9000 : 0x100);
  bytes[0] = 0xe9;
  bytes[3] = flashCode << 4; // 2 = 4 MB
  bytes[12] = chipId;
  if (full) {
    bytes[0x8000] = 0xaa;
    bytes[0x8001] = 0x50;
  }
  return bytes;
}

const kinds = (rows) => rows.map(([kind]) => kind);
const N16R8 = { chip: 'ESP32-S3', flashMb: 16, psramMb: 8 };
const N4 = { chip: 'ESP32-S3', flashMb: 4, psramMb: undefined };

test('reads chip, flash size and kind from the image header', () => {
  const info = inspectImage(image());
  assert.equal(info.kind, 'full');
  assert.equal(info.chip, 'ESP32-S3');
  assert.equal(info.flashSizeMb, 4);
  assert.equal(inspectImage(image({ full: false })).kind, 'app');
  assert.equal(inspectImage(new Uint8Array(64)).kind, 'unknown');
});

test('the headless gateway suits any ESP32-S3 with 4 MB of flash, with or without PSRAM', () => {
  const needs = requirementsFor(inspectImage(image()), { flash_mb: 4 });
  assert.equal(describeNeeds(needs), 'ESP32-S3, 4 MB flash or more');
  assert.deepEqual(kinds(boardChecks(needs, N16R8)), ['pass', 'pass']);
  assert.deepEqual(kinds(boardChecks(needs, N4)), ['pass', 'pass']);
  assert.deepEqual(kinds(boardChecks(needs, { chip: 'ESP32-S3', flashMb: 2 })), ['pass', 'fail']);
  assert.deepEqual(kinds(boardChecks(needs, { chip: 'ESP32', flashMb: 4 })), ['fail', 'pass']);
});

test('a build that needs PSRAM is checked for it', () => {
  const needs = requirementsFor(inspectImage(image({ flashCode: 4 })), { flash_mb: 16, psram_mb: 8 });
  assert.equal(describeNeeds(needs), 'ESP32-S3, 16 MB flash or more, 8 MB PSRAM or more');
  assert.deepEqual(kinds(boardChecks(needs, N16R8)), ['pass', 'pass', 'pass']);
  assert.deepEqual(kinds(boardChecks(needs, { ...N16R8, psramMb: 2 })), ['pass', 'pass', 'fail']);
  assert.deepEqual(kinds(boardChecks(needs, { ...N16R8, psramMb: undefined })), ['pass', 'pass', 'note']);
  assert.deepEqual(kinds(boardChecks(needs, N4)), ['pass', 'fail', 'note']);
});

test('the flash size in the image raises what the release says', () => {
  const needs = requirementsFor(inspectImage(image({ flashCode: 3 })), { flash_mb: 4 });
  assert.equal(needs.flashMb, 8);
});

test('finds PSRAM in esptool feature lists', () => {
  assert.equal(psramFromFeatures(['Wi-Fi', 'BLE', 'Embedded PSRAM 8MB (AP_3v3)']), 8);
  assert.equal(psramFromFeatures(['Wi-Fi', 'BLE', 'Embedded Flash 8MB (GD)']), undefined);
});
