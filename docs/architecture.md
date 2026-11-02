# OpenRV architecture

How the gateway firmware, its protocol and the app fit together. Decisions are dated where they were made.

OpenRV grew out of an earlier, private gateway that relayed raw Bluetooth bytes to the phone, which decoded them and kept every setting. OpenRV turns that around:

- **The gateway owns devices, settings and alert rules**, decodes every device itself, and sends ready-to-show values as self-describing JSON. The phone keeps only its own preferences and dashboard layout.
- **Plain ESP-IDF and NimBLE** instead of ESPHome, with device decoders in plain C++ that are tested on a computer.
- **Device classes**: every device is a temperature sensor, liquid level sensor, lock and so on, so the app needs no code per maker.
- **Alert rules** with labels and severities run on the gateway, along with per-device checks such as a cooler's Keep On.

## 1. Firmware

### Stack: ESP-IDF 6.0 + NimBLE (+ LVGL later), no ESPHome, no Arduino

Why:
- **Everything is configured at runtime.** ESPHome is built around devices declared in YAML at compile time; the old firmware spent most of its code working around that (generic slots, raw byte relay, its own preferences). With plain IDF the gateway is just our code.
- **NimBLE instead of Bluedroid.** About half the RAM and flash, and it handles scanner + several centrals + a peripheral at once. ESPHome's BLE components use Bluedroid.
- **LVGL through `esp_lvgl_port`** is Espressif's supported path for touch displays, and it sits in the same build.
- **OTA stays offline-friendly, two ways:** `esp_http_server` on the gateway's own soft AP with a single `/update` endpoint (seconds), or the image in pieces over the encrypted Bluetooth link (`ota.send.*`, a minute or two, no Wi-Fi needed). Both write with `esp_ota_ops`, which checks the image, plus app rollback (a new image must mark itself valid after BLE comes up, or the bootloader returns to the old one).
- **cJSON ships with IDF**, so JSON costs no extra dependency.
- Cost: no ESPHome conveniences (web logs, YAML). Serial logs over USB-C and `idf.py monitor` replace them.

Target: any ESP32-S3 board with 4 MB of flash or more. The firmware uses octal PSRAM when the board has it and runs from internal RAM when it doesn't (about 200 KB stays free either way); the partition table fits 4 MB, with two 1.875 MB app slots for over-the-air updates.

A touchscreen gateway (likely the Waveshare ESP32-S3-Touch-LCD-4.3) will be a separate firmware build (`CONFIG_OPENRV_DISPLAY`), because it needs PSRAM and more flash. Each build is listed in `firmware/builds.json` with the hardware it needs; releases publish one full image per build, and the web flasher offers the builds and checks the connected board's chip, flash and PSRAM against the chosen one (`website/assets/requirements.js`). There is no display code yet.

### Module layout

```
firmware/
  main/                   app_main: starts the modules and wires them together
  components/
    devices/              device support: classes, drivers and decoders (pure C++ and cJSON, no radio)
      include/openrv/       driver.h (the driver API), device_classes.h, device.h
      core/                 device JSON, settings, the builders drivers use
      classes/              one file per group of device classes
      protocols/            registry.cpp, and one folder per protocol (decoder, driver, tests)
    gateway/              configured devices, rules and alarms, device sessions, phones and their roles
                          (access.cpp), the JSON protocol for phones
    ble/                  NimBLE: the GATT server for phones (bonding), the scanner, outbound links to devices
    board/                the BOOT button and the RGB status LED
    ota/                  soft-AP window, HTTP /update, rollback
  main/                   app_main, NVS storage, and the setup code from the flasher (setup_code.cpp)
  test/host/              host tests for device support (CMake, any C++20 compiler, no ESP-IDF)
```

Data flow: the scanner or a device session hands bytes to the device's driver, which decodes them into its class's reading. The gateway turns the device into protocol JSON (`device_json`), checks alert rules against its values, and sends it to phones. Commands from a phone go the other way: the gateway checks the phone's role (and the PIN, for actions that ask for it), the driver's `validate()` checks the command, and the driver writes it during the device's next session.

### Device classes and drivers

Every device belongs to a **device class** (temperature sensor, liquid level sensor, battery monitor, solar controller, refrigerator, lock, surge protector). The class fixes the device's standard values, controls and shared settings ([device-classes.md](device-classes.md)), and the app draws every device of a class with the same cards, whoever made it.

A **driver** is the only place that knows a maker's bytes. It subclasses its class and hands it a reading struct:

```cpp
class InkbirdIbsTh : public TemperatureSensor {
 public:
  InkbirdIbsTh() : TemperatureSensor({.humidity = true, .battery = true, .decimals = 1}) {}
  bool on_advert(const Device &, const Advert &ad) override {
    auto r = inkbird::decode(ad);
    if (!r) return false;
    set_reading({.temperature_c = r->temperature_c, .humidity_pct = r->humidity_pct, .battery_pct = r->battery_pct});
    return true;
  }
};
```

Connected devices also implement the `Handler` session (link spec, schedule, `validate`, `begin`, `data`, `poll`). Each model is described by a `DriverInfo` (type id, model name, class, transport, `looks_like` for discovery, factory) and listed in `protocols/registry.cpp`.

Adding a device = one protocol folder + one line in the registry, with host tests in the same folder. The app needs no change unless the device needs a new class. [CONTRIBUTING.md](../CONTRIBUTING.md) walks through it.

### Storage

One JSON document with a schema version, saved in NVS (namespace `openrv`, key `config`). It holds the gateway name, the PIN, the known phones and their roles, and the devices with their settings and alert rules. Secrets (the RVLock password frame, the PIN) are never sent back to a phone. Latest values live in RAM only. NimBLE keeps its bonds in NVS too, so erasing NVS is a full factory reset.

Flash layout (`partitions.csv`, 4 MB): `nvs`, `otadata`, `phy_init`, `setup` (the setup code, which a factory reset leaves alone) and two 1.875 MB app slots. Installing a full image from the web flasher writes over everything, NVS included.

### Touchscreen (future)

Same model as the app, fewer features: a dashboard of device cards, a device screen with its controls (cooler setpoint, lock/unlock with the PIN on-screen), active alarms, and a short settings list (screen brightness/timeout, start the update Wi-Fi, rename a device). Adding devices and editing alert rules stay in the app.

## 2. Protocol (gateway <-> app)

### Transport

One GATT service, two characteristics (Nordic-UART style):

| Name | UUID | Properties |
|---|---|---|
| OpenRV service | `6f70656e-7276-4000-8000-000000000001` | advertised |
| RX (phone -> gateway) | `...0002` | write, write without response |
| TX (gateway -> phone) | `...0003` | notify |

Messages are **compact JSON, one per line (`\n`-terminated)**, split across as many writes/notifications as the MTU needs (the app asks for MTU 517). Both sides reassemble by reading up to `\n`. No binary framing to keep in sync.

Advertisement: the service UUID, with the gateway's name in the scan response. (Alarm flags in the advertisement, so a phone could notice an alarm without connecting, are an idea for later.)

### Envelope

```jsonc
// request (phone -> gateway)
{"id": 7, "op": "device.command", "args": {"device": "cooler", "action": "set", "values": {"left.target": -4}}}
// response
{"id": 7, "ok": true, "result": {}}
{"id": 7, "ok": false, "error": {"code": "not_authorized", "message": "PIN required"}}
// event (gateway -> phone, no id)
{"ev": "device", "data": { ...device... }}
```

### Ops

| Op | Who | Purpose |
|---|---|---|
| `hello` | anyone | `{proto, fw, name, mac, auth: {pin_set, ok}, access, caps}`; args `{phone}` name the phone |
| `pair` | anyone | Asks the phone to pair (the gateway sends a security request) |
| `claim` | anyone, paired | Becomes the owner of a gateway that has none: `{proof}` = HMAC(setup code, nonce), or no args while pairing is open |
| `auth.challenge` | anyone | A nonce for `auth.prove` or `claim` |
| `auth.prove` | guest | HMAC-SHA256(PIN, nonce), for actions that ask for the PIN |
| `snapshot` | guest | Every device with its latest values, alarms and gateway status |
| `subscribe` | guest | Start live events (`device`, `alarm`, `wifi`, `discovery`) |
| `config.get` | guest | Devices, rules, watchdogs, gateway settings (no secrets) |
| `device.command` | guest | Run a control (`set`, `lock`, `unlock`, `refresh`); and the PIN, for actions that list it |
| `device.add` / `device.update` / `device.remove` | owner | Change one device |
| `rule.put` / `rule.remove` | owner | Change one alert rule |
| `gateway.update` | owner | Name, PIN, display settings |
| `discovery.start` / `discovery.stop` | owner | Report nearby candidate devices with their guessed type |
| `ota.begin` | owner | Open the Wi-Fi window; returns SSID, password, upload URL and token |
| `ota.send.begin` / `ota.send.data` / `ota.send.end` / `ota.send.abort` | owner | Firmware over Bluetooth instead: `{size}` gives the piece size (2048), then base64 pieces `{offset, data}` in order, then end (check, switch, restart) |
| `gateway.reboot` / `gateway.reset` | owner | |
| `phones.list` / `phones.update` / `phones.remove` | owner | The phones it lets in; change a role or name, or remove one (it always keeps an owner) |
| `pairing.open` | owner | Lets one new phone pair for `seconds` (default 120) as `role` |

### Pairing and phones

Phones pair with the gateway (bonded, LE Secure Connections, Just Works since it has no screen) and the gateway keeps up to 8 known phones in its configuration, each an **owner** or a **guest**, by Bluetooth identity address. Until a phone is known, it can only say `hello`, `pair` and `claim`. A phone that comes back with its bond is encrypted straight away and gets its role without a prompt.

A new gateway has no owner. The first phone to pair and then `claim` it becomes the owner, by proving the **setup code** the web flasher wrote to the `setup` partition (and showed as a QR code, `openrv://claim?mac=...&code=...`), or while the **BOOT button** has opened pairing (held 3 s). Later phones get in only while pairing is open (BOOT, or an owner's `pairing.open`), one per window; others are told why (`access.refused`) and disconnected. Every change to a phone's standing arrives as an `access` event.

The BOOT button: a short press shows the status brightly, 3 s opens pairing for 2 minutes, 10 s is a factory reset (NVS erased: devices, rules, phones, bonds, PIN). That leaves the firmware and the setup code, so the gateway is as it was flashed. The board's RGB LED, dim: breathing green idle, steady green with a phone connected, breathing cyan without an owner, blinking blue while pairing, amber for a warning, blinking red for a critical alert, purple during a firmware update. While BOOT is held: a blue blink each second up to 3 s, then steady blue, then red blinking faster up to the reset. Both pins are set in `menuconfig` (OpenRV board).

### Device (self-describing)

```jsonc
{
  "id": "lp-front",                       // stable slug, chosen at add time
  "type": "mopeka_pro",                   // the driver; stored in the config
  "class": "liquid_level_sensor",         // what it is; decides its cards (device-classes.md)
  "model": "Mopeka Pro Check",
  "traits": {"fluid": "propane"},
  "name": "Front LP",
  "mac": "C4:12:34:56:78:9A",
  "settings": {"empty_mm": 20, "full_mm": 300},  // type-specific, validated by the driver; tanks are calibrated from their own readings
  "status": {"online": true, "rssi": -71, "age_s": 4, "link": "advert"},
  "values": [
    {"key": "level", "label": "Level", "unit": "%", "value": 62.5, "min": 0, "max": 100, "primary": true},
    {"key": "temp", "label": "Temperature", "unit": "C", "value": 18},
    {"key": "battery", "label": "Battery", "unit": "%", "value": 88},
    {"key": "quality", "label": "Signal quality", "value": "high", "enum": ["none", "low", "medium", "high"]}
  ],
  "controls": [],
  "alarms": [{"rule": "lp-front-low", "state": "low", "severity": "warning", "label": "Low"}]
}
```

A cooler's controls, for example:

```jsonc
"controls": [
  {"key": "power", "kind": "toggle", "value": true},
  {"key": "left.target", "kind": "number", "unit": "C", "min": -20, "max": 20, "step": 0.5556, "value": 1.1},
  {"key": "mode", "kind": "choice", "options": ["max", "eco"], "value": "eco"},
  {"key": "locked", "kind": "toggle", "value": true}
]
```

and a lock's: `{"key": "lock", "kind": "action", "actions": ["lock", "unlock"], "confirm": ["unlock"], "pin": ["unlock"]}`. `pin` lists the actions that need the gateway PIN. A lock leaves `unlock` out of it when its "Ask for the gateway PIN to unlock" setting (`unlock_pin`) is off, and the gateway then lets any connected phone lock or unlock it; other commands still need the PIN when one is set.

Units are SI on the wire (C, V, A, W, %), and every temperature is Celsius: values, control setpoints, alert thresholds and the alarm logic (2026-10-30). The gateway converts for devices that work in Fahrenheit, such as a cooler set to °F: it reports their readings and setpoints in Celsius, with a step of one of the device's own degrees, and converts a new setpoint back before writing it. The app shows temperatures in the user's chosen unit and converts what the user types back to Celsius.

### Alert rule

```jsonc
{"id": "lp-front-low", "device": "lp-front", "value": "level",
 "below": 20, "above": null, "hysteresis": 2, "hold_s": 30,
 "label": "Low", "severity": "warning", "enabled": true}
```

Severity is `info | warning | critical`. This replaces the phone-side "variant" map: LOW and VERY LOW tank warnings are simply two rules with different labels and severities. What a phone does with each severity (banner, notification, critical notification) stays an app setting.

## 3. App

### Stack

- **Expo (current SDK) with a development build**, TypeScript strict, **Expo Router** for navigation. This is the React Native team's recommended way to start an app, and it keeps native config in `app.json` + config plugins instead of hand-edited native projects.
- **react-native-ble-nitro** for BLE (with a small fix kept in `patches/`).
- **Zustand** for gateway state (one store fed by events), plain React state elsewhere.
- **React Native Paper** (Material 3) for components and theming: light, dark, and a red night theme.
- **react-native-svg** for tank, dial and gauge graphics.
- **expo-secure-store** for an optional GitHub token; **AsyncStorage** for preferences and dashboard layouts.
- **expo-file-system** for firmware downloads; **expo-background-task** + **expo-notifications** for the 12-hourly firmware check, periodic alert checks and alert notifications.
- Three small local Expo modules (Kotlin) instead of thinly maintained packages: `modules/gateway-wifi` joins the gateway's update Wi-Fi (`WifiNetworkSpecifier`), `modules/gateway-monitor` is the foreground service behind live monitoring, and `modules/gateway-pairing` starts Bluetooth pairing from the phone (one prompt instead of two).
- Tests: Jest for the protocol client, access, layouts and notifications; Prettier for formatting.

### Structure

```
app/
  index.ts                     entry: registers background tasks, then Expo Router
  src/app/                     Expo Router routes
    _layout.tsx                providers, theme, monitoring, notification taps
    (tabs)/index.tsx           Dashboard (arrange, hide, add cards)
    (tabs)/devices.tsx         Every device on the gateway
    (tabs)/alerts.tsx          Active alarms and rules
    (tabs)/settings.tsx        App settings and the gateway
    device/[id]/index.tsx      Device details and controls
    device/[id]/settings.tsx   Shared settings and this phone's card
    device/[id]/alerts.tsx     Rules for this device
    device/add.tsx             Discovery list, add
    gateway/connect.tsx        Find and pick a gateway
    gateway/firmware.tsx       Check, download, install
    gateway/phones.tsx         Owners: who can use the gateway
    claim.tsx                  The flasher's QR link: pair and become the owner
  src/protocol/                types.ts (mirrors protocol/schema.json), framing, client, access, demo gateway
  src/ble/                     transport over react-native-ble-nitro
  src/store/                   gateway, settings, per-gateway layouts, dialogs
  src/components/              cards, gauges, tank graphics, controls, connection and setup panels
  src/features/                firmware updates, alert monitoring and notifications
  modules/                     local Expo modules (Android)
```

### What the phone stores, and what the gateway stores

**On the gateway, shared by every phone:** the devices, their names and settings, alert rules, the gateway's name and PIN. Any connected app can change them; the device settings page groups these under "Shared settings".

**On each phone, per gateway** (`store/layouts.ts`, keyed by the gateway's Bluetooth address from `hello.mac`): the dashboard's title, card order, hidden cards, and each card's style and width. Each gateway gets its own dashboard on each phone; the device settings page groups these under "On this phone only" (2026-10-31).

**On each phone, for every gateway** (`store/settings.ts`): theme, temperature unit, alert monitoring (live, periodic or off) and its exit warning, the last gateway, and firmware download preferences.

### UI

- **Dashboard:** grid of cards, one per device, driven by the device's `primary` value and class, never its maker (tank graphic for liquid level sensors, temperature + humidity for temperature sensors, zones side by side for dual-zone fridges, a lock switch for locks). Alarms show as a coloured chip on the card and a banner at the top.
- **Device screen:** the same card large, then every value, then generic controls rendered from `controls` (switch, stepper, segmented choice, action buttons). Settings and Alerts are buttons on this screen, as in the current app.
- **Alerts tab:** what is alarming now, then all rules grouped by device; one sheet edits a rule (value, below/above, label, severity).
- **Gateway / settings:** connection, PIN, phones (owners), firmware (check, download, install), rename, reboot. Install, over Wi-Fi: `ota.begin` -> join Wi-Fi (`modules/gateway-wifi`, Kotlin on Android, Swift with `NEHotspotConfiguration` on iOS) -> POST image -> wait for the gateway to come back over BLE -> confirm version. Over Bluetooth: `ota.send.begin` -> pieces -> `ota.send.end` -> the same wait and check.
- Material 3 patterns: bottom tabs, bottom sheets for quick edits, pull to refresh = `snapshot`, large touch targets, dynamic type, both themes checked for contrast.

## 4. Repository layout

```
openrv/
  firmware/      ESP-IDF project, with host tests in firmware/test/host
  app/           Expo app
  website/       openrv.app and the web flasher
  protocol/      schema.json, the protocol both sides follow
  brand/         the logo and icons, and the script that renders them
  docs/          this file, device classes, notes on device protocols
  .github/       CI, firmware releases, the Pages deploy, rulesets
```

## 5. Out of scope for now

- **Gatewayless direct mode.** The gateway now owns the config, so a phone talking straight to devices would need its own copy. The door stays open cheaply: drivers are pure C++, and their tests double as the spec if they're ever ported to TypeScript.
- iOS builds (the app should stay iOS-clean, but only Android is tested).
- Gateway-to-internet anything.

## 6. Decisions

- 2026-10-29: build for the headless DevKitC now; keep the touchscreen gateway open for later.
- 2026-10-29: card styles and layouts live on each client, not the gateway.
- Toolchains: Node.js LTS, ESP-IDF v6.0.3 (installed with Espressif's EIM), MSVC C++ for host tests.
