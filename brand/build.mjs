// Builds every OpenRV graphic from the drawings below: the SVG logos, the app's icons, the website's
// copies and its social preview image. Run it after changing a drawing:
//
//   cd brand && npm install && node build.mjs
//
// The drawings are the source of truth; everything this writes is generated, so edit here, not
// the outputs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ---- Colours ----

const TEAL = '#006A6A';
const AQUA = '#9CF1F0';
const WHITE = '#FFFFFF';
const INK = '#161D1D';
const PAPER = '#F4FBFA';
const LIGHT_TEXT = '#DDE4E3';
const TEAL_ON_DARK = '#80D5D4';

// ---- The mark: a travel trailer on its tongue, sending a signal from the front (64-unit grid) ----

const BODY = 'M7 40V27c0-5 4-8 9-8h17c5 0 9 2 12 6l4 6v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z';
const SIGNAL = 'M46 12a8 8 0 0 1 6 6M46 6a14 14 0 0 1 12 12';
/** Where the drawing sits in the grid, for centring it in icons. */
const CONTENT = { x: 7, y: 6, width: 51, height: 42 };

/** The trailer filled, on a background of `ground` (the windows and wheel hub show it). */
function trailer(ground) {
  return [
    `<path d="${BODY}" fill="${WHITE}"/>`,
    `<rect x="12" y="24" width="9" height="6" rx="2" fill="${ground}"/>`,
    `<rect x="27" y="24" width="6" height="13" rx="2" fill="${ground}"/>`,
    `<path d="M47 40h10" fill="none" stroke="${WHITE}" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M53 40v6" fill="none" stroke="${WHITE}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<circle cx="18" cy="43" r="5" fill="${ground}" stroke="${WHITE}" stroke-width="3"/>`,
    `<path d="${SIGNAL}" fill="none" stroke="${AQUA}" stroke-width="3" stroke-linecap="round"/>`,
  ].join('\n  ');
}

/** The trailer as outlines in one colour. */
function trailerOutline(color) {
  return [
    `<path d="${BODY}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`,
    `<rect x="12" y="24" width="9" height="6" rx="2" fill="none" stroke="${color}" stroke-width="2.5"/>`,
    `<rect x="27" y="24" width="6" height="13" rx="2" fill="none" stroke="${color}" stroke-width="2.5"/>`,
    `<path d="M49 40h8M53 40v6" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`,
    `<circle cx="18" cy="43" r="5" fill="none" stroke="${color}" stroke-width="3"/>`,
    `<path d="${SIGNAL}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`,
  ].join('\n  ');
}

/** Scales the drawing to `fraction` of the canvas width and centres it. */
function centred(content, fraction) {
  const scale = (64 * fraction) / CONTENT.width;
  const cx = CONTENT.x + CONTENT.width / 2;
  const cy = CONTENT.y + CONTENT.height / 2;
  return `<g transform="translate(32 32) scale(${scale.toFixed(4)}) translate(${-cx} ${-cy})">\n  ${content}\n  </g>`;
}

const svg = (viewBox, body, label = 'OpenRV') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">\n  ${body}\n</svg>\n`;

const tile = (rx) => `<rect width="64" height="64" rx="${rx}" fill="${TEAL}"/>`;

// ---- The wordmark: monoline letters on a 64-unit-high grid, "Open" light and "RV" bold ----

const O = 'M22 8A19 20 0 0 0 22 48A19 20 0 0 0 22 8z';
const PEN = [
  'M39.5 20V62M39.5 34a13 13 0 1 0 26 0a13 13 0 1 0 -26 0', // p
  'M76 34H102A13 13 0 1 0 98.2 43.2', // e
  'M111 48V21M111 33A11 11 0 0 1 133 33V48', // n
];
const RV = [
  'M146 47V10H157A10.5 10.5 0 0 1 157 31H146M157 31L168 47', // R
  'M178 10L192 47L206 10', // V
];
const PEN_SHIFT = 12; // after the wide O
const WORD_WIDTH = 224;
const WORD_HEIGHT = 66;

function word(openColor, rvColor, dx = 0) {
  return (
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(${dx} 0)">` +
    `<path d="${O}" stroke="${openColor}" stroke-width="5"/>` +
    `<g transform="translate(${PEN_SHIFT} 0)">` +
    `<path d="${PEN.join(' ')}" stroke="${openColor}" stroke-width="5"/>` +
    `<path d="${RV.join(' ')}" stroke="${rvColor}" stroke-width="7"/>` +
    `</g></g>`
  );
}

const LOGO_GAP = 18;
const LOGO_WIDTH = 64 + LOGO_GAP + WORD_WIDTH;
const logo = (openColor, rvColor) =>
  `<g transform="translate(0 1)">${tile(15)}\n  ${trailer(TEAL)}</g>\n  ${word(openColor, rvColor, 64 + LOGO_GAP)}`;

// ---- Outputs ----

const SVGS = {
  'openrv-mark.svg': svg('0 0 64 64', `${tile(15)}\n  ${trailer(TEAL)}`),
  'openrv-glyph.svg': svg('0 0 64 64', trailerOutline('currentColor')),
  'openrv-wordmark.svg': svg(`0 0 ${WORD_WIDTH} ${WORD_HEIGHT}`, word(INK, TEAL)),
  'openrv-wordmark-dark.svg': svg(`0 0 ${WORD_WIDTH} ${WORD_HEIGHT}`, word(LIGHT_TEXT, TEAL_ON_DARK)),
  'openrv-logo.svg': svg(`0 0 ${LOGO_WIDTH} ${WORD_HEIGHT}`, logo(INK, TEAL)),
  'openrv-logo-dark.svg': svg(`0 0 ${LOGO_WIDTH} ${WORD_HEIGHT}`, logo(LIGHT_TEXT, TEAL_ON_DARK)),
};

/** Rendered images: [path from the repo root, size, svg] or [path, width, height, svg]. */
const square = (body) => svg('0 0 64 64', body);
const PNGS = [
  // App (Expo). iOS rounds the icon itself, so it is full bleed. Android's adaptive icon is a
  // teal background plus a foreground kept inside the safe zone (about the middle 60%), and a
  // one-colour version Android tints for themed icons.
  ['app/assets/icon.png', 1024, square(`${tile(0)}\n  ${centred(trailer(TEAL), 0.78)}`)],
  ['app/assets/android-icon-background.png', 1024, square(tile(0))],
  ['app/assets/android-icon-foreground.png', 1024, square(centred(trailer(TEAL), 0.58))],
  ['app/assets/android-icon-monochrome.png', 1024, square(centred(trailerOutline(WHITE), 0.58))],
  ['app/assets/splash-icon.png', 1024, SVGS['openrv-mark.svg']],
  // Android draws notification icons as one colour from their transparency.
  ['app/assets/notification-icon.png', 96, square(centred(trailerOutline(WHITE), 0.86))],
  ['app/assets/favicon.png', 48, SVGS['openrv-mark.svg']],
  // Exports for places that want bitmaps (GitHub avatar, chat apps).
  ['brand/png/openrv-mark-512.png', 512, SVGS['openrv-mark.svg']],
  ['brand/png/openrv-mark-1024.png', 1024, SVGS['openrv-mark.svg']],
  ['brand/png/openrv-logo.png', LOGO_WIDTH * 4, WORD_HEIGHT * 4, SVGS['openrv-logo.svg']],
  ['brand/png/openrv-logo-dark.png', LOGO_WIDTH * 4, WORD_HEIGHT * 4, SVGS['openrv-logo-dark.svg']],
];

/** The social preview (link cards, GitHub's repository preview): 1280 x 640. */
function socialCard() {
  const scale = 2.6;
  const logoWidth = LOGO_WIDTH * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640">
  <rect width="1280" height="640" fill="${PAPER}"/>
  <rect y="600" width="1280" height="40" fill="${TEAL}"/>
  <g transform="translate(${(1280 - logoWidth) / 2} 170) scale(${scale})">${logo(INK, TEAL)}</g>
  <text x="640" y="470" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="40" fill="${INK}">All your RV's Bluetooth devices, in one app.</text>
  <text x="640" y="525" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="28" fill="#4A5958">Open-source gateway and phone app · no cloud</text>
</svg>`;
}

function write(path, data) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
  console.log(`wrote ${path}`);
}

for (const [name, data] of Object.entries(SVGS)) {
  write(`brand/svg/${name}`, data);
  write(`website/brand/${name}`, data); // the site is published on its own, so it keeps copies
}

for (const entry of PNGS) {
  const [path, width, ...rest] = entry;
  const [height, data] = rest.length === 2 ? rest : [width, rest[0]];
  write(path, await sharp(Buffer.from(data), { density: 600 }).resize(width, height).png().toBuffer());
}

// The app draws the mark and wordmark with react-native-svg from these strings. It labels them
// itself; react-native-svg doesn't take ARIA attributes.
const forApp = (name) => JSON.stringify(SVGS[name].replace(' role="img" aria-label="OpenRV"', ''));
write(
  'app/src/brand/artwork.ts',
  `// Generated by brand/build.mjs from its drawings; edit those and run it again, not this file.\n\n` +
    `export const MARK_SVG = ${forApp('openrv-mark.svg')};\n\n` +
    `export const WORDMARK_SVG = ${forApp('openrv-wordmark.svg')};\n\n` +
    `export const WORDMARK_DARK_SVG = ${forApp('openrv-wordmark-dark.svg')};\n\n` +
    `/** Width over height of the wordmark. */\nexport const WORDMARK_ASPECT = ${WORD_WIDTH / WORD_HEIGHT};\n`,
);

const card = await sharp(Buffer.from(socialCard()), { density: 150 }).resize(1280, 640).png().toBuffer();
write('brand/png/openrv-social.png', card);
write('website/assets/social.png', card);
