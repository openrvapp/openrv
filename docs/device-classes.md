# Device classes

Every device the gateway supports belongs to one class. The class fixes the keys, units and labels of the values a device reports, its controls, and any settings every device of that kind shares. The app chooses cards, icons and gauges from the class alone, so all temperature sensors look the same whoever made them.

A driver subclasses the class in `firmware/components/devices/include/openrv/device_classes.h` and hands it a reading struct. A driver can also add its own settings (a tank size, a password), but not values or controls beyond its class: those belong to the class, so that every app and touchscreen understands them.

Units on the wire are fixed: temperatures in Celsius (`C`), and `%`, `V`, `A`, `W`, `Hz`, `Ah`, `kWh`, `mm` and `min`. The app converts temperatures to the user's unit. Values a model can't measure are left out (a feature flag in the class's `Features`); values it measures but hasn't reported yet are sent as `null`.

★ marks the primary value: the one a compact card shows, and what a dial or bar gauge fills to.

## Temperature sensor (`temperature_sensor`)

Thermometers and hygrometers. Cards: text, dial (temperature), bar (humidity, or temperature without it), compact.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `temp` ★ | Temperature | C | `Features.decimals`, default 1 |
| `humidity` | Humidity | % | `Features.humidity` |
| `battery` | Battery | % | `Features.battery` |

Drivers: Inkbird IBS-TH / IBS-TH2.

## Liquid level sensor (`liquid_level_sensor`)

Tank sensors for propane, fresh, grey and black water, and fuel. The model's fluid is a trait (`"traits": {"fluid": "propane"}`), which picks the default card: a propane cylinder or a rounded tank. Cards: propane tank, liquid tank, text, dial, bar, compact.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `level` ★ | Level | % | range 0-100; `null` when the sensor can't tell (no echo, tank not calibrated) |
| `height` | Height | mm | liquid above the sensor; `Features.height` |
| `temp` | Temperature | C | `Features.temperature` |
| `battery` | Battery | % | `Features.battery` |
| `quality` | Echo | `none`, `low`, `medium`, `high` | ultrasonic sensors; shown as 0-3 stars; `Features.quality` |

A driver that reports height rather than level overrides `level_pct()` to work the level out from its settings, as the Mopeka driver does from the tank size.

Drivers: Mopeka Pro Check (propane).

## Battery monitor (`battery_monitor`)

Shunts and smart batteries. Cards: text, dial (charge), bar (charge), compact; two columns wide by default.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `soc` ★ | Charge | % | range 0-100 |
| `battery_v` | Voltage | V | 2 decimals, range 11-14.6 |
| `current_a` | Current | A | positive while charging; `Features.current` |
| `power_w` | Power | W | positive while charging; `Features.power` |
| `remaining_ah` | Remaining | Ah | `Features.remaining` |
| `time_left_min` | Time left | min | `Features.time_left` |
| `temp` | Temperature | C | `Features.temperature` |

No driver yet; the demo gateway has an example.

## Solar controller (`solar_controller`)

Charge controllers. Cards: text, dial (battery voltage), bar, compact; two columns wide by default.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `battery_v` ★ | Battery | V | range 11-14.6 |
| `battery_pct` | Charge | % | `Features.battery_pct` |
| `solar_w` | Solar | W | |
| `charge_a` | Charging | A | |
| `solar_v` | Panel | V | `Features.solar_v` |
| `load_a` | Load | A | `Features.load` |

Drivers: Go Power PWM (experimental).

## Refrigerator (`refrigerator`)

Fridges and coolers, with one zone or separately controlled left and right zones. Connected devices: the class checks commands and turns them into a `FridgeChange` for the driver to write. Cards: text, dial, compact; two columns wide by default, and a dual-zone fridge shows both zones side by side.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `temp` ★ | Temperature | C | single zone; range = the settable range |
| `left.current` ★, `right.current` | Left, Right | C | dual zone, instead of `temp` |
| `battery_v` | Supply | V | |
| `battery` | Battery | % | when the fridge reports it |

Controls: `power` (toggle); `target` (number, C), or `left.target` and `right.target` on a dual-zone fridge, stepping by one of the fridge's own degrees (5/9 °C when it works in °F); `mode` (`max` or `eco`) when the fridge has it; `locked` (its panel lock) when it has one.

Drivers: Alpicool-protocol coolers (Alpicool, Renogy, Brass Monkey and others).

## Lock (`lock`)

Keyless entry locks. Connected devices. Cards: lock switch, text, compact.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `last_action` ★ | Last command | `lock`, `unlock` | the last command the lock confirmed |

Controls: `lock`, an action control with `lock` and `unlock` (just `lock` with Lock only on). `unlock` needs the gateway PIN while Ask for the PIN is on.

Settings every lock has: `lock_only` (refuse unlock) and `unlock_pin` (ask for the gateway PIN to unlock; on by default). A driver adds what it needs to talk to the lock, and its `ready()` refuses commands until then.

Drivers: RVLock Trek (experimental: setup needs a Bluetooth capture from a phone; see [devices/rvlock-trek.md](devices/rvlock-trek.md)).

## Surge protector (`surge_protector`)

Surge protectors and energy management systems on shore power. Cards: text, dial (voltage), bar, compact; two columns wide by default. A fault shows as a red FAULT chip on the card.

| Key | Label | Unit | Notes |
|---|---|---|---|
| `voltage_v` ★ | Voltage | V | range 100-140 |
| `current_a` | Current | A | |
| `power_w` | Power | W | |
| `l1.voltage_v` ★, `l2.voltage_v`, `l1.current_a`, ... | L1 Voltage, L2 Voltage, ... | | 50 A models (`Features.two_legs`), instead of the plain keys |
| `frequency_hz` | Frequency | Hz | `Features.frequency` |
| `energy_kwh` | Energy | kWh | `Features.energy` |
| `fault` | Fault | text | `null` while the power is fine, otherwise what is wrong |

No driver yet; the demo gateway has an example.

## Adding a class

Propose it in an issue first. A new class needs its reading struct and `values()` in the firmware (`device_classes.h`, `classes/`), its name in `protocol/schema.json` and the app's `DeviceClass` type, its icon and card styles in `app/src/deviceClasses.ts`, a demo device, and a section here. An app that doesn't know a class yet still shows its devices, with plain text cards.
