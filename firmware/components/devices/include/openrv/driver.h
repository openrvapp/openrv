#pragma once

// The API a device protocol is written against. A protocol is a folder under
// components/devices/protocols/ with a byte-level decoder and a driver.cpp that subclasses one of
// the device classes in device_classes.h. See CONTRIBUTING.md, "Adding a device".

#include <array>
#include <cstdint>
#include <deque>
#include <initializer_list>
#include <memory>
#include <optional>
#include <string>

#include "openrv/advert.h"
#include "openrv/json.h"

namespace openrv {

struct Device;

/// In printed order: AA:BB:CC:DD:EE:FF is {0xAA, ..., 0xFF}.
using Mac = std::array<uint8_t, 6>;

/// What a device is, independent of its maker. The class fixes the device's standard values and
/// controls (docs/device-classes.md), and the app draws every device of a class with the same cards.
enum class DeviceClass : uint8_t {
  TEMPERATURE_SENSOR,
  LIQUID_LEVEL_SENSOR,
  BATTERY_MONITOR,
  SOLAR_CONTROLLER,
  REFRIGERATOR,
  LOCK,
  SURGE_PROTECTOR,
};
/// The protocol name: "temperature_sensor", "liquid_level_sensor", ...
const char *class_name(DeviceClass c);

/// How the gateway hears a device.
enum class Transport : uint8_t {
  ADVERT,     // readings arrive in advertisements; the gateway never connects
  CONNECTED,  // the gateway connects for short sessions (a Handler)
};

/// Builds a device's "values" array (schema.json #/$defs/value). Each call adds one value; the
/// modifiers after it (primary, range) apply to the value just added.
class Values {
 public:
  explicit Values(cJSON *array) : array_(array) {}
  /// A number in `unit` (temperatures always "C"); nullopt shows as "no data yet".
  Values &number(const char *key, const char *label, const char *unit, std::optional<float> value, int decimals = 0);
  /// One of `options`; nullptr shows as "no data yet".
  Values &choice(const char *key, const char *label, const char *value, std::initializer_list<const char *> options);
  /// Free text, such as a fault description; nullptr = none.
  Values &text(const char *key, const char *label, const char *value);
  /// The value a compact card shows.
  Values &primary();
  /// The range a gauge spans for this value.
  Values &range(float min, float max);

 private:
  cJSON *add_(const char *key, const char *label);
  cJSON *array_;
  cJSON *last_ = nullptr;
};

/// Builds a "controls" or "setting_defs" array (schema.json #/$defs/control).
class Controls {
 public:
  explicit Controls(cJSON *array) : array_(array) {}
  Controls &toggle(const char *key, const char *label, bool value);
  Controls &number(const char *key, const char *label, const char *unit, double min, double max, double step, double value);
  /// `labels` (same order as `options`) are shown instead of the option ids when given.
  Controls &choice(const char *key, const char *label, const char *value, std::initializer_list<const char *> options,
                   std::initializer_list<const char *> labels = {});
  /// Adds one option to the choice just added, for option lists built at run time.
  Controls &option(const char *id, const char *label = nullptr);
  /// A text field. A secret one is never sent back to phones; `placeholder` says whether it is set.
  Controls &text(const char *key, const char *label, const char *value, bool secret = false, const char *placeholder = nullptr);
  /// Buttons; `pin` lists the actions that need the gateway PIN.
  Controls &action(const char *key, const char *label, std::initializer_list<const char *> actions,
                   std::initializer_list<const char *> pin = {});

 private:
  cJSON *add_(const char *key, const char *label, const char *kind);
  cJSON *array_;
  cJSON *last_ = nullptr;
};

/// Reads a device's stored settings.
bool setting_bool(const Device &d, const char *key, bool fallback = false);
double setting_number(const Device &d, const char *key, double fallback);
const char *setting_string(const Device &d, const char *key);

// ---- Connected devices ----

struct LinkSpec {
  Mac mac;
  uint16_t service;
  uint16_t write_chr;
  uint16_t notify_chr;
};

struct Command {
  std::string action;  // "set" for controls, or an action control's action ("lock", ...)
  Json values;         // for "set": control key -> value
};

/// What a handler can do during a session.
class SessionIo {
 public:
  virtual ~SessionIo() = default;
  virtual void write(Bytes data) = 0;
  /// The device's reading changed: phones hear it and alert rules are checked.
  virtual void updated() = 0;
  /// Nothing more to do: the session ends and the link closes.
  virtual void done() = 0;
  virtual int64_t now_us() = 0;
};

/// Speaks a connected device's protocol. The gateway connects for short sessions, on a schedule or
/// when a command is waiting, so the device's own phone app can still use it in between.
class Handler {
 public:
  virtual ~Handler() = default;
  virtual LinkSpec spec(const Device &d) const = 0;
  /// Seconds between scheduled sessions; 0 = only when a command is waiting.
  virtual uint32_t interval_s(const Device &d) const = 0;
  /// Checks a command before it is queued: nullptr, or a protocol error code ("bad_request",
  /// "unsupported", "refused").
  virtual const char *validate(const Device &d, const Command &c) const = 0;
  /// The link is up. `scheduled` = the timer started this session, not a command.
  virtual void begin(Device &d, SessionIo &io, std::deque<Command> &commands, bool scheduled) = 0;
  virtual void data(Device &d, SessionIo &io, Bytes bytes, std::deque<Command> &commands) = 0;
  /// About every 100 ms while the link is up, for the handler's own timers.
  virtual void poll(Device &, SessionIo &, std::deque<Command> &) {}
};

// ---- Drivers ----

/// One device's protocol logic and latest reading. Subclass a device class (device_classes.h),
/// not this directly: the class turns your readings into the standard values and controls.
class Driver {
 public:
  virtual ~Driver() = default;

  /// Advert devices: decodes an advertisement from this device into the reading. False when it
  /// isn't a reading (for example a scan response without data).
  virtual bool on_advert(const Device &, const Advert &) { return false; }
  /// Connected devices: the session handler (usually `this`).
  virtual Handler *handler() { return nullptr; }

  /// The device's values and controls. The device classes implement these.
  virtual void values(const Device &d, Values &out) const = 0;
  virtual void controls(const Device &, Controls &) const {}
  /// Fixed facts the app may use, such as {"fluid": "propane"}. Added to the device as "traits".
  virtual void traits(cJSON *) const {}

  /// Settings: what a new device starts with, how phones edit them, and which values are allowed.
  /// A driver extending a class's settings calls the class's version too.
  virtual void default_settings(cJSON *) const {}
  virtual void setting_defs(const Device &, Controls &) const {}
  virtual bool valid_setting(const char * /*key*/, const cJSON * /*value*/) const { return false; }
  /// Settings never sent to phones, such as passwords.
  virtual bool secret_setting(const char *) const { return false; }

  /// Whether a phone must have proven the gateway PIN to run this action.
  virtual bool action_needs_pin(const Device &, const std::string &action) const { return action != "refresh"; }
};

/// One supported device model, as the registry lists it (protocols/registry.cpp).
struct DriverInfo {
  const char *type;   // stable id stored in the gateway's config, e.g. "mopeka_pro"; never rename
  const char *model;  // shown to people, e.g. "Mopeka Pro Check"
  DeviceClass device_class;
  Transport transport;
  /// For discovery: whether an advert comes from this model. nullptr when it can't be told; the
  /// person then picks the model by hand.
  bool (*looks_like)(const Advert &ad, const Mac &mac);
  std::unique_ptr<Driver> (*create)();
};

}  // namespace openrv
