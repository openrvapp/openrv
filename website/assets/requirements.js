// What a firmware needs from a board, and whether a connected board has it. No browser APIs, so it
// can be tested with Node.

/**
 * A firmware's needs: from its release (`requires` in the manifest: flash_mb, psram_mb) and from
 * the image itself (the chip it was built for, and the flash size its layout assumes).
 */
export function requirementsFor(info, requires = {}) {
  return {
    chip: info.chip ?? requires.chip,
    flashMb: Math.max(requires.flash_mb ?? 0, info.flashSizeMb ?? 0) || undefined,
    psramMb: requires.psram_mb || undefined,
  };
}

/** The needs as one line, e.g. "ESP32-S3, 4 MB flash or more". */
export function describeNeeds(needs) {
  return [
    needs.chip,
    needs.flashMb && `${needs.flashMb} MB flash or more`,
    needs.psramMb && `${needs.psramMb} MB PSRAM or more`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Each need against the board, as [kind, text]: 'pass', 'fail', or 'note' when the board's value
 * couldn't be read. `board` is { chip, flashMb, psramMb }; flashMb and psramMb may be undefined.
 */
export function boardChecks(needs, board) {
  const rows = [];
  if (needs.chip)
    rows.push(
      needs.chip === board.chip
        ? ['pass', `Chip: ${board.chip}`]
        : ['fail', `Chip: the firmware is for an ${needs.chip}, but this board is an ${board.chip}`],
    );
  if (needs.flashMb)
    rows.push(
      board.flashMb === undefined
        ? ['note', `Flash: needs ${needs.flashMb} MB; couldn't read the board's flash size`]
        : board.flashMb >= needs.flashMb
          ? ['pass', `Flash: ${board.flashMb} MB (needs ${needs.flashMb} MB)`]
          : ['fail', `Flash: needs ${needs.flashMb} MB, but this board has ${board.flashMb} MB`],
    );
  if (needs.psramMb)
    rows.push(
      board.psramMb === undefined
        ? [
            'note',
            `PSRAM: needs ${needs.psramMb} MB; none detected. PSRAM outside the chip can't be detected, so continue only if you're sure the board has it`,
          ]
        : board.psramMb >= needs.psramMb
          ? ['pass', `PSRAM: ${board.psramMb} MB (needs ${needs.psramMb} MB)`]
          : ['fail', `PSRAM: needs ${needs.psramMb} MB, but this board has ${board.psramMb} MB`],
    );
  return rows;
}

/** The PSRAM inside the chip package, in MB, from esptool's feature list; undefined if none shows. */
export function psramFromFeatures(features) {
  const match = features.join(' ').match(/PSRAM (\d+)\s*MB/i);
  return match ? Number(match[1]) : undefined;
}
