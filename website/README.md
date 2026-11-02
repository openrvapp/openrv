# Website

The project's public site, `index.html`, and the web flasher, `flash.html`. Plain HTML, CSS and JavaScript modules with no build step, published to GitHub Pages by `.github/workflows/pages.yml`.

## Try it locally

```bash
node website/dev.mjs              # http://localhost:8090
node website/dev.mjs --firmware   # also offers firmware/build's full image as a release
```

`--firmware` needs a full image first: in `firmware/`, run `idf.py build` and then `idf.py merge-bin --output openrv-gateway-full.bin`.

The flasher talks to the board with Web Serial, so use Chrome or Edge on a computer. Web Serial only works on secure pages, and `http://localhost` counts as one.

## How the flasher works

It follows the flow of [ESP Web Tools](https://esphome.github.io/esp-web-tools/), ESPHome's installer: choose the firmware, connect, install. It's built directly on Espressif's [esptool-js](https://github.com/espressif/esptool-js) instead, because it checks more than the chip: before installing, it compares the connected board's chip, flash size and in-package PSRAM with what the chosen firmware needs (`assets/requirements.js`), and offers a version per kind of hardware.

**Firmware versions per hardware.** `firmware/builds.json` lists each build, the image file it produces and what it needs:

```json
{ "id": "gateway", "name": "Gateway (no screen)", "chip": "ESP32-S3",
  "file": "openrv-gateway-full.bin", "requires": { "flash_mb": 4 } }
```

A release's `manifest.json` repeats that list with each image's size and SHA-256, and the flasher shows a "Version for your hardware" choice when there's more than one. A touchscreen build will be one more entry, needing, for example, `{ "flash_mb": 16, "psram_mb": 8 }`, plus a step in the release workflow that builds it. The image's own header adds its chip and the flash size its layout assumes. PSRAM can only be detected when it's inside the chip package (ESP32-S3R8 and the like); otherwise the flasher says it couldn't tell, and lets the person decide.

## How the flasher gets firmware

- **Releases:** the flasher reads `firmware/releases.json` next to the page. The Pages deploy writes that file and copies each `firmware-v*` release's `manifest.json` and full images beside it, because GitHub doesn't let other sites' pages download release files directly. The flasher checks each download against the SHA-256 in the release's manifest. Without that file, as when the page is opened from disk, it lists releases from the GitHub API, but can then only point people to the release page to download the file.
- **A file:** any image the person picks. The flasher reads the image header to tell a full image (bootloader, partition table and app, flashed at 0x0) from an app image alone, and shows the app's name, version and target chip.

`?repo=owner/name` points the release list at another repository, such as a fork. Tests for the image and board checks run with `node --test website/test/*.test.mjs`.

## Files

| Path | What |
|---|---|
| `index.html` | The project site |
| `flash.html`, `assets/flasher.js` | The web flasher |
| `assets/requirements.js` | What a firmware needs, checked against the board (also runs under Node) |
| `test/` | Tests for the image and board checks (`node --test website/test/*.test.mjs`) |
| `assets/image.js` | Reads ESP-IDF image headers (also runs under Node) |
| `assets/setup.js` | The setup code written with the firmware and its QR code link (also runs under Node) |
| `assets/style.css` | Shared look, light and dark |
| `brand/` | The logo, mark and wordmark as SVG, with a brand sheet (`brand/index.html`) |
| `vendor/esptool-js/` | [esptool-js](https://github.com/espressif/esptool-js) 0.7.0 by Espressif, Apache-2.0, kept here so the site has no outside dependencies |
| `vendor/qrcode-generator/` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, MIT, for the setup QR code |
| `dev.mjs` | The local server |

After installing a full image, the flasher shows a QR code for the new gateway. It writes a fresh setup code into the image's `setup` partition (0x12000) before flashing, and the QR code holds `openrv://claim?mac=<Bluetooth address>&code=<setup code>`, which the app opens to pair and become the gateway's owner. The Bluetooth address is the chip's base MAC plus 2. Firmware without a `setup` partition (before 0.4) gets no code.

When a device is added to the firmware, add it to the supported devices table in `index.html` too.

## The domain

The site is published at **https://openrv.app**, set as the custom domain in the repository's Pages settings (`apply.sh` sets it too). It needs these DNS records at the domain's registrar:

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `openrvapp.github.io` |
| TXT | `_github-pages-challenge-openrvapp` | the code GitHub shows when the domain is added under the organization's Settings → Pages |

The TXT record verifies the domain for the openrvapp organization, so no other GitHub account can point it at their own site. `.app` domains only work over HTTPS, so the site loads once GitHub has issued its certificate (usually within an hour of the records taking effect); then turn on "Enforce HTTPS" in the repository's Pages settings.
