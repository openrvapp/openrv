// The web flasher: pick a firmware (a version for your hardware from a GitHub release, or a file),
// connect an ESP32 board over Web Serial, check the board has what that firmware needs, and write
// it with Espressif's esptool-js.
//
// A release's manifest.json lists its builds, one per kind of hardware, each with its needs:
//   { "builds": [{ "id": "gateway", "name": "Gateway (no screen)", "chip": "ESP32-S3",
//                  "file": "openrv-gateway-full.bin", "size": 1145328, "sha256": "…",
//                  "requires": { "flash_mb": 4, "psram_mb": 0 } }] }
// A future touchscreen build is one more entry, needing more flash and PSRAM.
import { ESPLoader, Transport } from '../vendor/esptool-js/esptool.js';
import { inspectImage, sha256Hex } from './image.js';
import { boardChecks, describeNeeds, psramFromFeatures, requirementsFor } from './requirements.js';
import { bluetoothMac, claimLink, formatSetupCode, generateSetupCode, withSetupCode } from './setup.js';
import qrcode from '../vendor/qrcode-generator/qrcode.mjs';

// ---- Configuration ----

const params = new URLSearchParams(location.search);
/** The repository releases come from; `?repo=owner/name` tries another (a fork, say). */
const REPO = params.get('repo') || 'openrvapp/openrv';
const TAG_PREFIX = 'firmware-v';
const MANIFEST = 'manifest.json';
/** Releases before manifests listed builds had just this image. */
const DEFAULT_IMAGE = 'openrv-gateway-full.bin';
/** Releases the site's own deploy copied next to it (see website/README.md); same origin, no API limits. */
const LOCAL_INDEX = 'firmware/releases.json';
const GATEWAY_PROJECT = 'openrv-gateway';

const FLASH_BAUD = 921600;
const ROM_BAUD = 115200;

// ---- Page ----

const $ = (id) => document.getElementById(id);
const ui = {
  unsupported: $('unsupported'),
  tabRelease: $('tab-release'),
  tabFile: $('tab-file'),
  panelRelease: $('panel-release'),
  panelFile: $('panel-file'),
  release: $('release'),
  buildField: $('build-field'),
  build: $('build'),
  releaseNote: $('release-note'),
  file: $('file'),
  imageFacts: $('image-facts'),
  imageStatus: $('image-status'),
  connect: $('connect'),
  disconnect: $('disconnect'),
  boardFacts: $('board-facts'),
  checks: $('checks'),
  boardStatus: $('board-status'),
  erase: $('erase'),
  address: $('address'),
  install: $('install'),
  progressWrap: $('progress-wrap'),
  progressLabel: $('progress-label'),
  progress: $('progress'),
  installStatus: $('install-status'),
  log: $('log'),
  setupCard: $('setup-card'),
  setupQr: $('setup-qr'),
  setupMac: $('setup-mac'),
  setupCode: $('setup-code'),
  setupPrint: $('setup-print'),
  setupSave: $('setup-save'),
};

const state = {
  /** Releases from the site's index or the GitHub API. */
  releases: [],
  /** The chosen release's builds (from its manifest). */
  builds: [],
  /** { bytes, name, info, requires } of the chosen firmware. */
  image: undefined,
  transport: undefined,
  loader: undefined,
  /** { chip, flashMb, psramMb, features, mac } of the connected board. */
  board: undefined,
  busy: false,
  /** { mac, code, link } written with the last install, for the QR code. */
  setup: undefined,
};

function log(line) {
  ui.log.textContent += `${line}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

const terminal = {
  clean: () => {},
  writeLine: (line) => log(line),
  write: (data) => {
    ui.log.textContent += data;
  },
};

function setStatus(el, kind, message) {
  el.hidden = !message;
  el.className = `status ${kind}`;
  el.textContent = message;
}

function setFacts(el, rows) {
  el.replaceChildren();
  for (const [name, value] of rows) {
    if (value === undefined || value === '') continue;
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    dd.textContent = value;
    el.append(dt, dd);
  }
  el.hidden = el.childElementCount === 0;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ---- Firmware source ----

function selectTab(release) {
  ui.tabRelease.setAttribute('aria-selected', String(release));
  ui.tabFile.setAttribute('aria-selected', String(!release));
  ui.panelRelease.hidden = !release;
  ui.panelFile.hidden = release;
  clearImage();
  if (release) chooseRelease();
  else if (ui.file.files?.[0]) chooseFile(ui.file.files[0]);
}

ui.tabRelease.addEventListener('click', () => selectTab(true));
ui.tabFile.addEventListener('click', () => selectTab(false));
for (const tab of [ui.tabRelease, ui.tabFile]) {
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const other = tab === ui.tabRelease ? ui.tabFile : ui.tabRelease;
      other.focus();
      other.click();
    }
  });
}

function clearImage() {
  state.image = undefined;
  ui.imageFacts.hidden = true;
  setStatus(ui.imageStatus, '', '');
  checkCompatibility();
}

/** Releases newest first: from the site's own copy, else the GitHub API. */
async function loadReleases() {
  try {
    const local = await fetch(LOCAL_INDEX, { cache: 'no-store' });
    if (local.ok) {
      const list = await local.json();
      log(`Found ${list.length} release(s) published with this site.`);
      return list.map((r) => ({ ...r, source: 'site' }));
    }
  } catch {
    // Not deployed with releases (or opened from disk): ask GitHub instead.
  }
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `GitHub has no public releases for ${REPO}.`
        : `GitHub answered ${response.status} ${response.statusText}.`,
    );
  }
  return (await response.json())
    .filter((r) => r.tag_name.startsWith(TAG_PREFIX) && !r.draft)
    .filter((r) => r.assets.some((a) => a.name === MANIFEST))
    .map((r) => ({
      tag: r.tag_name,
      version: r.tag_name.slice(TAG_PREFIX.length),
      published_at: r.published_at,
      prerelease: r.prerelease,
      url: r.html_url,
      assets: r.assets,
      source: 'github',
    }));
}

async function initReleases() {
  try {
    state.releases = await loadReleases();
  } catch (e) {
    log(`Couldn't list releases: ${e.message}`);
    state.releases = [];
    ui.release.replaceChildren(new Option('No releases available', ''));
    ui.releaseNote.textContent = `${e.message} Choose "A file" to flash an image you have.`;
    return;
  }
  if (state.releases.length === 0) {
    ui.release.replaceChildren(new Option('No releases yet', ''));
    ui.releaseNote.textContent = 'There are no firmware releases yet. Choose "A file" to flash an image you built.';
    return;
  }
  ui.release.replaceChildren(
    ...state.releases.map((r, i) => {
      const date = r.published_at ? new Date(r.published_at).toLocaleDateString() : '';
      const label = `${r.version}${r.prerelease ? ' (pre-release)' : i === 0 ? ' (latest)' : ''}${date ? `, ${date}` : ''}`;
      return new Option(label, r.tag);
    }),
  );
  ui.release.disabled = false;
  chooseRelease();
}

ui.release.addEventListener('change', () => chooseRelease());
ui.build.addEventListener('change', () => chooseBuild());

async function download(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A file of a release: the site's copy, or else GitHub's asset API. GitHub doesn't let pages on
 * other sites download release files, so the API route only works where GitHub allows it; the
 * published site always has its own copies.
 */
async function releaseFile(release, name) {
  if (release.source === 'site') return download(`${release.dir}${name}`, { cache: 'no-store' });
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) throw new Error(`the release has no ${name}`);
  return download(`https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`, {
    headers: { Accept: 'application/octet-stream' },
  });
}

/** The builds a release offers. Older manifests describe one full image. */
function buildsOf(manifest) {
  if (Array.isArray(manifest.builds) && manifest.builds.length) return manifest.builds;
  return [
    {
      id: 'gateway',
      name: 'Gateway',
      file: DEFAULT_IMAGE,
      sha256: manifest.full?.sha256,
      requires: {},
    },
  ];
}

let request = 0;

function showDownloadFailure(release, file, e) {
  log(`Download failed: ${e.message}`);
  ui.releaseNote.textContent = `Couldn't download it here (${e.message}). Download ${file} from `;
  const link = document.createElement('a');
  link.href = release.url ?? `https://github.com/${REPO}/releases/tag/${release.tag}`;
  link.textContent = 'the release page';
  ui.releaseNote.append(link, ' and choose "A file" instead.');
}

async function chooseRelease() {
  const release = state.releases.find((r) => r.tag === ui.release.value);
  if (!release) return;
  const mine = ++request;
  clearImage();
  ui.buildField.hidden = true;
  ui.releaseNote.textContent = `Reading ${release.version}…`;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await releaseFile(release, MANIFEST)));
    if (mine !== request) return;
    state.builds = buildsOf(manifest);
    ui.build.replaceChildren(...state.builds.map((b) => new Option(b.name, b.id)));
    ui.buildField.hidden = state.builds.length < 2;
    await chooseBuild();
  } catch (e) {
    if (mine === request) showDownloadFailure(release, MANIFEST, e);
  }
}

async function chooseBuild() {
  const release = state.releases.find((r) => r.tag === ui.release.value);
  const build = state.builds.find((b) => b.id === ui.build.value) ?? state.builds[0];
  if (!release || !build) return;
  const mine = ++request;
  clearImage();
  ui.releaseNote.textContent = `Downloading ${build.name}, ${release.version}…`;
  try {
    const bytes = await releaseFile(release, build.file);
    if (mine !== request) return;
    if (build.sha256 && (await sha256Hex(bytes)) !== build.sha256.toLowerCase())
      throw new Error("the download is damaged: its SHA-256 doesn't match the release");
    ui.releaseNote.replaceChildren();
    if (release.url) {
      const link = document.createElement('a');
      link.href = release.url;
      link.textContent = 'Release notes';
      ui.releaseNote.append(link);
    }
    if (build.sha256) ui.releaseNote.append(`${release.url ? ' · ' : ''}Checksum verified.`);
    setImage(bytes, `${build.file} (${release.version})`, build.requires ?? {});
  } catch (e) {
    if (mine === request) showDownloadFailure(release, build.file, e);
  }
}

ui.file.addEventListener('change', () => {
  clearImage();
  if (ui.file.files?.[0]) chooseFile(ui.file.files[0]);
});

async function chooseFile(file) {
  setImage(new Uint8Array(await file.arrayBuffer()), file.name, {});
}

/** Takes the chosen firmware; `requires` is its release's statement of what it needs. */
function setImage(bytes, name, requires) {
  const info = inspectImage(bytes);
  state.image = { bytes, name, info, requires: requirementsFor(info, requires) };
  setFacts(ui.imageFacts, [
    ['File', name],
    ['Size', mb(bytes.length)],
    ['Firmware', info.app ? `${info.app.project} ${info.app.version}` : undefined],
    ['Built', info.app?.built],
    ['Needs', describeNeeds(state.image.requires)],
  ]);
  if (info.kind === 'full') ui.address.value = '0x0';
  log(`Firmware: ${name}, ${bytes.length} bytes, ${info.kind}${info.app ? `, ${info.app.project} ${info.app.version}` : ''}.`);
  checkCompatibility();
}

// ---- Board ----

function serialSupported() {
  return 'serial' in navigator && window.isSecureContext;
}

ui.connect.addEventListener('click', async () => {
  if (state.busy) return;
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (e) {
    // NotFoundError: the person closed the chooser without picking a port.
    if (e.name !== 'NotFoundError') {
      log(`Couldn't open the port chooser: ${e.message}`);
      setStatus(ui.boardStatus, 'error', `This browser couldn't show its list of serial ports: ${e.message}`);
    }
    return;
  }
  state.busy = true;
  ui.connect.disabled = true;
  setStatus(ui.boardStatus, '', 'Connecting…');
  try {
    state.transport = new Transport(port, false);
    state.loader = new ESPLoader({ transport: state.transport, baudrate: FLASH_BAUD, romBaudrate: ROM_BAUD, terminal });
    await state.loader.main();
    const chip = state.loader.chip;
    const features = await chip.getChipFeatures(state.loader);
    const mac = await chip.readMac(state.loader);
    const flash = await state.loader.detectFlashSize();
    state.board = {
      chip: chip.CHIP_NAME,
      flashMb: flash ? Number.parseInt(flash, 10) : undefined,
      // Only PSRAM inside the chip package shows up (S3R8, S3R2 and the like).
      psramMb: psramFromFeatures(features),
      features,
      mac,
    };
    setFacts(ui.boardFacts, [
      ['Chip', state.board.chip],
      ['Flash', state.board.flashMb ? `${state.board.flashMb} MB` : 'unknown'],
      ['PSRAM', state.board.psramMb ? `${state.board.psramMb} MB` : 'none detected'],
      ['Features', features.join(', ')],
      ['MAC', mac.toUpperCase()],
    ]);
    ui.disconnect.hidden = false;
    setStatus(ui.boardStatus, '', '');
  } catch (e) {
    log(`Connect failed: ${e.message ?? e}`);
    setStatus(
      ui.boardStatus,
      'error',
      "Couldn't talk to the board. Put it in download mode (hold BOOT, press RESET, release BOOT) and connect again.",
    );
    await closePort();
  } finally {
    state.busy = false;
    ui.connect.disabled = false;
  }
  checkCompatibility();
});

ui.disconnect.addEventListener('click', () => closePort().then(checkCompatibility));

async function closePort() {
  try {
    await state.transport?.disconnect();
  } catch {
    // Already gone (unplugged).
  }
  state.transport = undefined;
  state.loader = undefined;
  state.board = undefined;
  ui.disconnect.hidden = true;
  ui.boardFacts.hidden = true;
}

navigator.serial?.addEventListener('disconnect', () => {
  if (state.transport && !state.busy) {
    log('The board was unplugged.');
    closePort().then(checkCompatibility);
  }
});

// ---- Checks ----

function parseAddress() {
  const value = ui.address.value.trim();
  const n = /^0x[0-9a-f]+$/i.test(value) ? Number.parseInt(value, 16) : /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) && n % 0x1000 === 0 ? n : undefined;
}

/** Problems with the firmware itself, before any board is connected. */
function imageProblems() {
  const problems = [];
  const warnings = [];
  const image = state.image?.info;
  if (!image) return { problems, warnings };
  const address = parseAddress();
  if (image.kind === 'unknown') problems.push("This file isn't an ESP firmware image.");
  if (image.kind === 'app' && address === 0)
    problems.push(
      'This is an app image without a bootloader, such as openrv-gateway.bin, which the app uses for updates. Choose a full image (…-full.bin), or set the address under Advanced.',
    );
  if (address === undefined) problems.push('The address under Advanced must be a multiple of 0x1000, such as 0x0.');
  if (image.app && image.app.project !== GATEWAY_PROJECT)
    warnings.push(`This is "${image.app.project}", not OpenRV gateway firmware.`);
  return { problems, warnings };
}

function checkCompatibility() {
  const { problems, warnings } = imageProblems();
  setStatus(ui.imageStatus, problems.length ? 'error' : 'warn', [...problems, ...warnings].join(' '));

  const rows = state.image && state.board ? boardChecks(state.image.requires, state.board) : [];
  ui.checks.replaceChildren(
    ...rows.map(([kind, text]) => {
      const li = document.createElement('li');
      li.className = kind;
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.setAttribute('aria-label', kind === 'pass' ? 'OK' : kind === 'fail' ? 'Problem' : 'Note');
      mark.textContent = kind === 'pass' ? '✓' : kind === 'fail' ? '✗' : '!';
      li.append(mark, document.createTextNode(text));
      return li;
    }),
  );
  ui.checks.hidden = rows.length === 0;
  const fails = rows.filter(([kind]) => kind === 'fail').length;
  if (!state.busy && state.board) {
    if (!state.image) setStatus(ui.boardStatus, '', 'Choose a firmware to check this board against it.');
    else if (fails) setStatus(ui.boardStatus, 'error', "This board doesn't suit this firmware.");
    else if (!problems.length) setStatus(ui.boardStatus, 'ok', 'Ready to install.');
    else setStatus(ui.boardStatus, '', '');
  }
  ui.install.disabled = state.busy || !state.image || !state.loader || problems.length > 0 || fails > 0;
}

ui.address.addEventListener('input', checkCompatibility);

// ---- Install ----

/**
 * Restarts the board into its new firmware. esptool-js's own hard reset only releases RTS without
 * pulling it first, so on boards with the usual auto-reset circuit (EN on RTS, BOOT on DTR) the
 * chip stayed in the bootloader. This pulses EN with BOOT released, as esptool.py does.
 */
async function resetBoard(transport) {
  await transport.setDTR(false); // BOOT high: start the firmware, not the bootloader
  await transport.setRTS(true); // EN low: hold in reset
  await new Promise((r) => setTimeout(r, 100));
  await transport.setRTS(false); // EN high: run
}

// ---- Setup code ----

function showSetup(setup) {
  const qr = qrcode(0, 'M');
  qr.addData(setup.link);
  qr.make();
  ui.setupQr.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 12, scalable: true });
  ui.setupMac.textContent = setup.mac;
  ui.setupCode.textContent = formatSetupCode(setup.code);
  ui.setupCard.hidden = false;
  ui.setupCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

ui.setupPrint.addEventListener('click', () => window.print());

ui.setupSave.addEventListener('click', () => {
  const svg = ui.setupQr.querySelector('svg');
  if (!svg || !state.setup) return;
  // A card to keep: the QR code, the gateway's address and the code typed out.
  const size = 360;
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 90}" viewBox="0 0 ${size} ${size + 90}">
<rect width="100%" height="100%" fill="#fff"/>
<svg x="20" y="20" width="${size - 40}" height="${size - 40}" viewBox="${svg.getAttribute('viewBox')}">${svg.innerHTML}</svg>
<text x="${size / 2}" y="${size + 10}" text-anchor="middle" font-family="monospace" font-size="26" font-weight="bold">${formatSetupCode(state.setup.code)}</text>
<text x="${size / 2}" y="${size + 45}" text-anchor="middle" font-family="sans-serif" font-size="15">OpenRV gateway ${state.setup.mac}</text>
</svg>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([card], { type: 'image/svg+xml' }));
  a.download = `openrv-setup-${state.setup.mac.replace(/:/g, '')}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

ui.install.addEventListener('click', async () => {
  const address = parseAddress();
  if (!state.loader || !state.image || address === undefined) return;
  state.busy = true;
  checkCompatibility();
  ui.connect.disabled = true;
  ui.disconnect.disabled = true;
  ui.progressWrap.hidden = false;
  ui.progress.value = 0;
  setStatus(ui.installStatus, '', '');
  ui.setupCard.hidden = true;
  // A full image gets a fresh setup code in its setup partition (older firmware has none).
  let data = state.image.bytes;
  let setup;
  if (state.image.info.kind === 'full' && address === 0 && state.board?.mac) {
    const code = generateSetupCode();
    const patched = withSetupCode(data, code);
    if (patched) {
      data = patched;
      const mac = bluetoothMac(state.board.mac);
      setup = { mac, code, link: claimLink(mac, code) };
      log(`Writing a setup code for gateway ${mac}.`);
    }
  }
  try {
    if (ui.erase.checked) {
      ui.progressLabel.textContent = 'Erasing the flash (this can take a minute)…';
      ui.progress.removeAttribute('value');
      await state.loader.eraseFlash();
    }
    ui.progressLabel.textContent = 'Writing…';
    ui.progress.value = 0;
    await state.loader.writeFlash({
      fileArray: [{ data, address }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_file, written, total) => {
        ui.progress.value = Math.round((written / total) * 100);
        ui.progressLabel.textContent = `Writing… ${ui.progress.value}%`;
      },
    });
    ui.progressLabel.textContent = 'Restarting the board…';
    await resetBoard(state.transport);
    ui.progress.value = 100;
    ui.progressLabel.textContent = 'Done.';
    setStatus(
      ui.installStatus,
      'ok',
      'Installed. The board has restarted; power it in the RV and find it in the app as "OpenRV".',
    );
    log('Installed and restarted.');
    state.setup = setup;
    if (setup) showSetup(setup);
  } catch (e) {
    log(`Install failed: ${e.message ?? e}`);
    ui.progressLabel.textContent = 'Stopped.';
    setStatus(ui.installStatus, 'error', `It didn't finish: ${e.message ?? e}. Reconnect the board and try again.`);
  } finally {
    state.busy = false;
    ui.disconnect.disabled = false;
    await closePort();
    ui.connect.disabled = false;
    checkCompatibility();
  }
});

// ---- Start ----

if (!serialSupported()) {
  ui.unsupported.hidden = false;
  ui.connect.disabled = true;
}
initReleases();
