# Contributing to OpenRV

Thanks for helping. The most useful contribution is support for another Bluetooth device: a tank sensor, battery monitor, surge protector, fridge or anything else in an RV. This guide walks through that. Fixes and other improvements follow the same pull request steps at the end.

## How device support is organised

Every device belongs to a **device class**, such as temperature sensor, liquid level sensor or battery monitor. The class decides what the device reports (its standard values, controls and settings), and the app draws every device of a class with the same cards. A **protocol driver** only turns one maker's Bluetooth bytes into the class's reading.

```
firmware/components/devices/
  include/openrv/driver.h          the driver API: Driver, Values, Controls, Handler, DriverInfo
  include/openrv/device_classes.h  the device classes to subclass, and their reading structs
  classes/                         how each class reports its readings
  protocols/
    registry.cpp                   one line per supported model
    mopeka_pro/                    one folder per protocol:
      mopeka_pro.h, mopeka_pro.cpp   the decoder: bytes in, a reading out (plain C++, no ESP-IDF)
      driver.cpp                     the driver: a device class subclass, plus its DriverInfo
      mopeka_pro_test.cpp            host tests for both
```

The app has no code per maker or protocol, so adding a device that fits an existing class needs no app change at all. The classes and their standard values are listed in [docs/device-classes.md](docs/device-classes.md).

## Adding a device

### 1. Check the licence of what you learn from

OpenRV is MIT licensed. You can learn a protocol from your own captures, from published specifications, or from open-source projects whose licence allows reuse in MIT code with attribution (MIT, BSD, Apache-2.0 and similar). Don't copy code from GPL or LGPL projects; reading one to understand a byte layout and then writing your own decoder from that understanding is fine, as is copying small data tables such as calibration constants.

Credit every source in the Credits section of [README.md](README.md), and add its licence text to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when you use more than facts from it. Add a one-line comment at the top of your decoder naming the source.

### 2. Pick the device class

Find the class in [docs/device-classes.md](docs/device-classes.md) that describes the device, and the reading struct it takes in `device_classes.h`. If nothing fits, open an issue to propose a new class before writing a driver: a class is shared by every future device of that kind, and it also needs app cards.

### 3. Write the decoder

Create `firmware/components/devices/protocols/<maker_model>/` with a header and a `.cpp` that turn bytes into a plain struct. Keep this part free of ESP-IDF and JSON: it is the piece that's easiest to test and to review against a capture.

- **Advertising devices** (they broadcast readings; the gateway never connects) get an `Advert` and look up their data with `ad.manufacturer()`, `ad.find(type)` or `ad.name()`.
- **Connected devices** (the gateway connects for short sessions) need frame builders for the requests you send and a parser for the notifications you get back. Notifications can arrive split or joined, so reassemble frames as `alpicool/alpicool.cpp` does.

### 4. Write the driver

`driver.cpp` subclasses the class and reports readings with `set_reading()`. An advertising temperature sensor is this short:

```cpp
#include "acme_thermo.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

class AcmeThermo : public TemperatureSensor {
 public:
  AcmeThermo() : TemperatureSensor({.humidity = true, .battery = true, .decimals = 1}) {}

  bool on_advert(const Device &, const Advert &ad) override {
    auto r = acme::decode(ad);
    if (!r)
      return false;
    set_reading({.temperature_c = r->temp_c, .humidity_pct = r->humidity, .battery_pct = r->battery});
    return true;
  }
};

}  // namespace

extern const DriverInfo ACME_THERMO = {
    .type = "acme_thermo",            // stored in gateway configs: never rename it once released
    .model = "Acme Thermo 2",         // what people see
    .device_class = DeviceClass::TEMPERATURE_SENSOR,
    .transport = Transport::ADVERT,
    .looks_like = [](const Advert &ad, const Mac &) { return acme::looks_like(ad); },
    .create = []() -> std::unique_ptr<Driver> { return std::make_unique<AcmeThermo>(); },
};

}  // namespace openrv
```

Then:

- **Connected devices** also implement the `Handler` session (`spec`, `interval_s`, `validate`, `begin`, `data`, and `poll` for timeouts) and return `this` from `handler()`. The `Refrigerator` and `Lock` classes already implement `validate()` and turn commands into a `FridgeChange` or a lock action; see `alpicool/driver.cpp` and `rvlock_trek/driver.cpp`.
- **Settings** the device needs (a tank size, a password, a poll interval) go in `default_settings`, `setting_defs` and `valid_setting`. Mark secrets with `secret_setting` so they never reach phones. When the class has settings of its own (locks do), call the class's version too.
- **Units:** temperatures are always Celsius, whatever the device uses; convert in the driver. The app converts for display.
- **Discovery:** `looks_like` lets the gateway name the device while people are adding one. Make it precise, because the first model in the registry that says yes wins. Use `nullptr` when the adverts carry nothing to tell the device by; people then pick the model from a list.

### 5. Register it

Add one `extern` line and one entry to `firmware/components/devices/protocols/registry.cpp`. The build picks up the new folder by itself (run `idf.py reconfigure` once, since CMake only looks for new files when it runs).

### 6. Test it

Put host tests next to the driver in `<maker_model>_test.cpp`. They run on a PC, with no board and no ESP-IDF:

```bash
cmake -S firmware/test/host -B build/host
cmake --build build/host
ctest --test-dir build/host --output-on-failure
```

Test the decoder with bytes from a real capture (say in a comment where and when it was taken), and the driver end to end with the helpers in `firmware/test/host/device_testing.h`: `testing::make("acme_thermo")`, `testing::advert(*d, "...")`, `testing::number(*d, "temp")`, and `testing::FakeSession` for connected devices. The existing `_test.cpp` files show each.

Then build the firmware (`idf.py build` in `firmware/`, or `firmware/build.ps1` on Windows) and, if you have the device, flash a gateway and add it from the app. Say in the pull request whether you tested on real hardware.

### 7. Document it

Add the device to the supported devices tables in `README.md` and `website/index.html`. If the protocol isn't documented elsewhere, add `docs/devices/<maker-model>.md` with what you learned: services and characteristics, frame layout, an annotated capture, and anything surprising. [docs/devices/rvlock-trek.md](docs/devices/rvlock-trek.md) is an example.

## Pull requests

- One device or one fix per pull request.
- `firmware/`: the host tests pass, and the firmware builds with no warnings (warnings are errors).
- `app/`: `npm run typecheck`, `npm test` and `npx prettier --check src` pass.
- Match the surrounding code: the C++ style is in `firmware/.clang-format`, and comments say why, not what.
- Fill in the pull request template. CI runs the same checks on every pull request.

## Reporting a device you'd like supported

Open an issue with the "Device support request" template. A capture makes it far more likely someone can add it: an Android Bluetooth HCI snoop log (`btsnoop_hci.log`) taken while the maker's own app reads or controls the device, plus what the app showed at the time.
