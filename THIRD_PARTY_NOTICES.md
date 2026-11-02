# Third-party notices

OpenRV is MIT-licensed (see `LICENSE`). It only uses sources and libraries under permissive licenses that allow that (MIT, Apache-2.0, BSD, ISC and similar), with attribution. Copyleft code such as ESPHome's GPL C++ is not used; the only thing taken from ESPHome is a short table of LP tank dimensions (data, not code), with the maintainer's agreement. Where a device protocol was learned from someone else's work, the decoder was written from that source, which is credited here and in a comment at the top of the file.

## Device protocols (code written from these sources)

| Used in | Source | License |
|---|---|---|
| `firmware/components/devices/protocols/mopeka_pro/mopeka_pro.cpp` (advert layout, model bytes, propane coefficients, battery scale) | [Bluetooth-Devices/mopeka-iot-ble](https://github.com/Bluetooth-Devices/mopeka-iot-ble), Copyright (c) 2022 J. Nick Koston | MIT |
| `firmware/components/devices/protocols/inkbird_ibs_th/inkbird_ibs_th.cpp` (nine-byte advert layout, "no humidity sensor" values, plausibility checks) | [Bluetooth-Devices/inkbird-ble](https://github.com/Bluetooth-Devices/inkbird-ble), Copyright (c) 2022 J. Nick Koston | MIT |
| `firmware/components/devices/protocols/alpicool/alpicool.cpp` (frame format, commands, status and settings layout, checksum) | [klightspeed/BrassMonkeyFridgeMonitor](https://github.com/klightspeed/BrassMonkeyFridgeMonitor), Copyright (c) 2023 Ben Peddell | MIT |
| `firmware/components/devices/protocols/gopower_pwm/gopower_pwm.cpp` (Modbus-style poll request, ASCII reply fields) | [bigthrilla/camper-ble-bridge](https://github.com/bigthrilla/camper-ble-bridge), Copyright (c) 2026 bigthrilla | MIT |
| `firmware/components/devices/protocols/mopeka_pro/mopeka_pro.h` (LP tank presets: empty/full distances for common cylinders, data only, no code) | [esphome/esphome](https://github.com/esphome/esphome) `mopeka_pro_check` component | ESPHome License (the values are facts; no ESPHome code is used) |
| `firmware/components/devices/protocols/rvlock_trek/rvlock_trek.cpp` | Decoded from our own Bluetooth capture of the RVLock app (see `docs/devices/rvlock-trek.md`) | — |

The MIT license text for each of these is reproduced at the end of this file.

## Libraries

### Phone app (`app/`)

Direct dependencies, all MIT: Expo and its modules (expo, expo-router, expo-constants, expo-dev-client, expo-build-properties, expo-document-picker, expo-file-system, expo-linking, expo-notifications, expo-background-task, expo-secure-store, expo-haptics, expo-status-bar, @expo/vector-icons), React, React DOM, React Native, react-native-web, react-native-paper, react-native-safe-area-context, react-native-screens, react-native-svg, react-native-gesture-handler, react-native-reanimated, react-native-worklets, react-native-sortables, @react-native-async-storage/async-storage, react-native-ble-nitro (with a small fix kept in `app/patches/`), react-native-nitro-modules, zustand, @noble/hashes. Test and tooling: jest, jest-expo, @testing-library/react-native, patch-package, prettier (MIT); TypeScript (Apache-2.0, build-time only).

The app was started from Expo's project template, Copyright (c) 2015-present 650 Industries, Inc. (aka Expo), under the MIT license.

The icons are Material Design Icons by Pictogrammers, shipped inside @expo/vector-icons, under the Apache-2.0 license.

### Website (`website/`)

The web flasher uses [esptool-js](https://github.com/espressif/esptool-js) 0.7.0 by Espressif Systems, under the Apache-2.0 license. Its browser bundle is kept in `website/vendor/esptool-js/` with its license text, and includes [pako](https://github.com/nodeca/pako) (MIT and Zlib) and [atob-lite](https://github.com/hughsk/atob-lite) (MIT), whose license texts are in `website/vendor/esptool-js/THIRD_PARTY_LICENSES.txt`.

The setup QR code is drawn with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, under the MIT license, kept in `website/vendor/qrcode-generator/` with its license text. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

### Artwork (`brand/`)

The logo and icons are original to OpenRV. `brand/build.mjs` renders them to PNG with [sharp](https://github.com/lovell/sharp) (Apache-2.0), a build-time tool that isn't part of the app or the website.

### Gateway firmware (`firmware/`)

| Library | License |
|---|---|
| [ESP-IDF](https://github.com/espressif/esp-idf) (includes FreeRTOS, MIT) | Apache-2.0 |
| [NimBLE](https://github.com/apache/mynewt-nimble), as bundled in ESP-IDF | Apache-2.0 |
| [Mbed TLS / TF-PSA-Crypto](https://github.com/Mbed-TLS/mbedtls), as bundled in ESP-IDF | Apache-2.0 |
| [cJSON](https://github.com/DaveGamble/cJSON), via espressif/cjson | MIT |
| [led_strip](https://components.espressif.com/components/espressif/led_strip), for the status LED | Apache-2.0 |

## MIT license texts

### mopeka-iot-ble and inkbird-ble

```
MIT License

Copyright (c) 2022 J. Nick Koston

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BrassMonkeyFridgeMonitor

```
MIT License

Copyright (c) 2023 Ben Peddell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### camper-ble-bridge

```
MIT License

Copyright (c) 2026 bigthrilla

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Expo project template

```
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
