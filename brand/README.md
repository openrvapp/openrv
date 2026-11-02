# OpenRV brand

The OpenRV logo and everything made from it.

**The mark** is a travel trailer on its tongue, sending a signal from the front: an RV that talks Bluetooth. **The wordmark** is drawn in monoline strokes to match, with "Open" light and "RV" bold. Both are plain SVG drawings with no fonts.

## Files

| File | Use |
|---|---|
| `svg/openrv-mark.svg` | The trailer on its teal tile: app icons, favicons, avatars |
| `svg/openrv-glyph.svg` | The trailer in outline, one colour (`currentColor` when placed inline) |
| `svg/openrv-wordmark.svg`, `svg/openrv-wordmark-dark.svg` | The name, for light or dark backgrounds |
| `svg/openrv-logo.svg`, `svg/openrv-logo-dark.svg` | Mark and name side by side, for light or dark backgrounds |
| `png/` | Bitmaps of the above, and `openrv-social.png` (1280 × 640) for link previews and GitHub's social preview |

The website's brand sheet, `website/brand/index.html`, shows them all.

## Colours

| Name | Hex | Use |
|---|---|---|
| Teal | `#006A6A` | The tile, "RV" on light backgrounds, the app's primary colour |
| Signal aqua | `#9CF1F0` | The signal waves |
| Teal on dark | `#80D5D4` | "RV" on dark backgrounds |
| Ink | `#161D1D` | "Open" on light backgrounds |
| Light text | `#DDE4E3` | "Open" on dark backgrounds |

## Changing the artwork

The drawings live in `build.mjs`, which writes every file derived from them:

- these SVGs and PNGs
- the website's copies (`website/brand/`, `website/assets/social.png`)
- the app's icons (`app/assets/`): the icon, Android's adaptive and themed icons, the splash icon and the favicon
- the SVG strings the app draws the logo from (`app/src/brand/artwork.ts`)

```bash
cd brand
npm install
node build.mjs
```

Edit the drawings in `build.mjs`, never the generated files. Changing the Android icons also needs `npx expo prebuild` in `app/` before the next native build. `sharp` (Apache-2.0) only turns SVG into PNG here; it isn't part of the app or the site.

## Using the logo

The logo is MIT licensed with the rest of the project. If you show it, keep its proportions and colours, leave some space around it, and don't use it in a way that suggests a product or service is official OpenRV when it isn't.
