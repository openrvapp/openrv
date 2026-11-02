<h1>
  <picture>
    <source srcset="website/brand/openrv-logo-dark.svg" media="(prefers-color-scheme: dark)" />
    <img src="website/brand/openrv-logo.svg" alt="OpenRV" height="56" />
  </picture>
</h1>

[![CI](https://github.com/openrvapp/openrv/actions/workflows/ci.yml/badge.svg)](https://github.com/openrvapp/openrv/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OpenRV brings the Bluetooth gadgets in an RV together in one place. A small ESP32-S3 gateway listens to propane sensors, thermometers, coolers, door locks and solar controllers, remembers the latest readings, watches for problems, and serves everything to a phone app over Bluetooth. No cloud, no account, no internet needed.

## Features

- **One dashboard** for every device, with cards you can restyle, resize and reorder: tank graphics, dial and bar gauges, a lock switch, and side-by-side zones for dual-zone fridges.
- **Alerts** evaluated on the gateway, so they keep working when your phone is away: low propane, a warm fridge, a low battery. The phone notifies you, live or with a check every 15 minutes, whenever it's near the RV.
- **Control** coolers (power, temperature, mode, panel lock) and locks, with an optional gateway PIN.
- **Yours alone:** phones pair with the gateway, and only the ones you let in can use it, as owners or guests. Claim a new gateway with the QR code from the web flasher, or by holding its BOOT button.
- **Watchdogs** that turn a cooler back on and re-lock its panel if they find it off.
- **Firmware updates** from the app, over Bluetooth or a short-lived Wi-Fi link, on Android and iOS, with automatic rollback if an update fails.
- **Your units:** every temperature and alert in °F or °C.
- **Demo mode** to try the app without a gateway.

## Supported devices

| Class | Devices |
|---|---|
| Liquid level sensor | Mopeka Pro Check (propane) |
| Temperature sensor | Inkbird IBS-TH, IBS-TH2 |
| Refrigerator | Alpicool-protocol coolers (Alpicool, Renogy, Brass Monkey and others) |
| Lock | RVLock Trek |
| Solar controller | Go Power PWM (experimental) |
| Battery monitor | none yet |
| Surge protector | none yet |

Every device of a class reports the same values and looks the same in the app, whoever made it ([docs/device-classes.md](docs/device-classes.md)). Missing yours? See [Contributing](#contributing), or open a device support request with a Bluetooth capture.

## What you need

- **A gateway:** any ESP32-S3 board with 4 MB of flash or more, such as the Espressif ESP32-S3-DevKitC-1, powered from the RV's 12 V system through a USB adapter. PSRAM isn't needed; boards with octal PSRAM (modules marked R8, such as N16R8) use it. A touchscreen gateway is planned as a separate firmware version, and the web flasher checks a board has what the version you choose needs.
- **A phone:** Android 7 or later. An iOS version is written but hasn't been built or tested on an iPhone yet.

## Getting started

**New to this?** [docs/getting-started.md](docs/getting-started.md) walks through everything step by step, in plain language, with troubleshooting. All you need is the web flasher and the app from your phone's app store. Here's the short version.

### 1. Flash the gateway

The easiest way is the [web flasher](https://openrv.app/flash.html): connect the board's USB port and use it in Chrome or Edge on a computer. When it's done, it shows a QR code with the gateway's setup code; print it or save it, and keep it with the gateway.

Or download `openrv-gateway-full.bin` from the [latest firmware release](https://github.com/openrvapp/openrv/releases) and flash it with [esptool](https://docs.espressif.com/projects/esptool/):

```bash
pip install esptool
esptool --chip esp32s3 write-flash 0x0 openrv-gateway-full.bin
```

Flashed this way, the gateway has no setup code, so you'll claim it with its BOOT button instead. You only do this once. Later versions install from the app. To build the firmware yourself instead, see [Development](#development).

### 2. Install the app

Install **OpenRV** from Google Play or the App Store. Or build it yourself from this repository (see [Development](#development)). The app has a demo gateway to look around with first.

### 3. Become the gateway's owner

Scan the flasher's QR code with your phone: it opens the app, which pairs with the gateway and makes your phone its owner. Without the QR code, open the app, tap Find a gateway, choose "OpenRV", and either type the setup code or hold the gateway's BOOT button for 3 seconds. Owners can let other phones in from Settings › Phones, as owners or guests. Holding BOOT for 10 seconds resets the gateway to how it was flashed.

### 4. Add devices

Add devices from the Devices tab. The gateway lists what it hears nearby and recognizes supported models; pick one, give it a name, and it appears on the dashboard.

## How it works

The gateway owns the configuration: the devices, their settings and the alert rules all live on it. It reads advertising devices passively, connects to others for short sessions on a schedule or when there's a command to send (so their makers' apps still work in between), and keeps every device's latest values. Phones connect to it over Bluetooth and talk newline-delimited JSON ([protocol/schema.json](protocol/schema.json)); they store only their own preferences, such as theme, units and dashboard layout.

[docs/architecture.md](docs/architecture.md) has the full design.

## Development

| Folder | What's in it |
|---|---|
| `firmware/` | Gateway firmware (C++20, ESP-IDF 6.0) |
| `firmware/components/devices/` | Device classes and protocol drivers |
| `app/` | Phone app (TypeScript, React Native with Expo) |
| `protocol/` | The JSON schema both sides follow |
| `website/` | The project site and web flasher ([website/README.md](website/README.md)) |
| `brand/` | The logo and icons, and the script that builds them ([brand/README.md](brand/README.md)) |
| `docs/` | Architecture, device classes, device protocol notes |

**Firmware.** Install [ESP-IDF v6.0](https://docs.espressif.com/projects/esp-idf/en/v6.0/esp32s3/get-started/), then:

```bash
cd firmware
idf.py build
idf.py -p PORT flash monitor
```

On Windows, `firmware/build.ps1` activates ESP-IDF and runs the same commands (`./build.ps1 -p COM3 flash monitor`).

**Device tests** run on a PC with any C++20 compiler and CMake, no board needed:

```bash
cmake -S firmware/test/host -B build/host
cmake --build build/host
ctest --test-dir build/host --output-on-failure
```

**App.** Needs Node.js 20 or later; Android builds also need JDK 17 and the Android SDK.

```bash
cd app
npm ci
npm run web            # demo mode in a browser
npx expo run:android   # build and run on a connected phone
npm run typecheck && npm test
```

## Contributing

Contributions are welcome, and support for more devices most of all: each protocol is one folder of plain C++ with its own tests, plus one line in a registry, and the app needs no change. [CONTRIBUTING.md](CONTRIBUTING.md) walks through it. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

Questions and ideas go in [Discussions](https://github.com/openrvapp/openrv/discussions); bugs and device requests in [Issues](https://github.com/openrvapp/openrv/issues). Report security problems privately, as [SECURITY.md](SECURITY.md) describes. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Credits

Device protocols were learned from these MIT-licensed projects, and the decoders were written from them:

- Mopeka Pro sensors: [mopeka-iot-ble](https://github.com/Bluetooth-Devices/mopeka-iot-ble) by J. Nick Koston
- Inkbird IBS-TH2: [inkbird-ble](https://github.com/Bluetooth-Devices/inkbird-ble) by J. Nick Koston
- Alpicool-protocol coolers (Renogy and others): [BrassMonkeyFridgeMonitor](https://github.com/klightspeed/BrassMonkeyFridgeMonitor) by Ben Peddell
- Go Power solar controller: [camper-ble-bridge](https://github.com/bigthrilla/camper-ble-bridge) by bigthrilla

The RVLock Trek protocol was decoded from our own capture. Library licenses and the full license texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

OpenRV is an independent project, not affiliated with or endorsed by the makers of any device it supports; product names are their owners' trademarks. It talks to devices through protocols learned by observation, which a firmware update on the device could change. Don't rely on it alone for anything safety-critical, such as gas, smoke or carbon monoxide detection, and keep a physical key for any lock you control with it.

## License

MIT, see [LICENSE](LICENSE).
