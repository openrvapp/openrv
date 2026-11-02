#pragma once

// The device classes. Each one fixes the values and controls every device of its kind reports
// (docs/device-classes.md), so the app can show a Mopeka and a future SeeLevel tank sensor with
// the same cards. A protocol's driver subclasses one of these, decodes its bytes into the class's
// reading struct, and calls set_reading(); the class does the rest.
//
// Units on the wire: temperatures in Celsius, levels and charge in %, V, A, W, Hz, Ah, kWh, min.

#include <optional>
#include <string>

#include "openrv/driver.h"

namespace openrv {

// ---- Temperature sensor: temp, humidity, battery ----

struct TemperatureReading {
  float temperature_c;
  std::optional<float> humidity_pct;
  std::optional<float> battery_pct;
};

class TemperatureSensor : public Driver {
 public:
  struct Features {
    bool humidity = false;
    bool battery = true;
    int decimals = 1;  // of the temperature
  };
  explicit TemperatureSensor(Features f) : features_(f) {}
  void values(const Device &d, Values &out) const override;

 protected:
  void set_reading(const TemperatureReading &r) { reading_ = r; }
  const std::optional<TemperatureReading> &reading() const { return reading_; }

 private:
  Features features_;
  std::optional<TemperatureReading> reading_;
};

// ---- Liquid level sensor: level, height, temp, battery, quality ----

enum class Fluid : uint8_t { PROPANE, FRESH_WATER, GREY_WATER, BLACK_WATER, FUEL, OTHER };
/// How well an ultrasonic sensor hears the liquid surface.
enum class EchoQuality : uint8_t { NONE, LOW, MEDIUM, HIGH };

struct LevelReading {
  std::optional<float> level_pct;  // nullopt when the sensor can't tell, such as no echo
  std::optional<float> height_mm;  // of liquid above the sensor
  std::optional<float> temperature_c;
  std::optional<float> battery_pct;
  std::optional<EchoQuality> quality;
};

class LiquidLevelSensor : public Driver {
 public:
  struct Features {
    Fluid fluid;
    bool height = false;
    bool temperature = false;
    bool battery = true;
    bool quality = false;
  };
  explicit LiquidLevelSensor(Features f) : features_(f) {}
  void values(const Device &d, Values &out) const override;
  void traits(cJSON *out) const override;

 protected:
  void set_reading(const LevelReading &r) { reading_ = r; }
  const std::optional<LevelReading> &reading() const { return reading_; }
  /// The level to report. Override to work it out from the device's settings, such as a tank size.
  virtual std::optional<float> level_pct(const Device &, const LevelReading &r) const { return r.level_pct; }

 private:
  Features features_;
  std::optional<LevelReading> reading_;
};

// ---- Battery monitor (shunt or smart battery): soc, battery_v, current_a, power_w, ... ----

struct BatteryReading {
  std::optional<float> soc_pct;
  std::optional<float> voltage_v;
  std::optional<float> current_a;  // positive while charging
  std::optional<float> power_w;    // positive while charging
  std::optional<float> remaining_ah;
  std::optional<float> time_left_min;
  std::optional<float> temperature_c;
};

class BatteryMonitor : public Driver {
 public:
  struct Features {
    bool current = true;
    bool power = true;
    bool remaining = false;
    bool time_left = false;
    bool temperature = false;
  };
  explicit BatteryMonitor(Features f) : features_(f) {}
  void values(const Device &d, Values &out) const override;

 protected:
  void set_reading(const BatteryReading &r) { reading_ = r; }
  const std::optional<BatteryReading> &reading() const { return reading_; }

 private:
  Features features_;
  std::optional<BatteryReading> reading_;
};

// ---- Solar charge controller: battery_v, battery_pct, solar_w, charge_a, solar_v, load_a ----

struct SolarReading {
  std::optional<float> battery_v;
  std::optional<float> battery_pct;
  std::optional<float> solar_w;
  std::optional<float> solar_v;
  std::optional<float> charge_a;
  std::optional<float> load_a;
};

class SolarController : public Driver {
 public:
  struct Features {
    bool battery_pct = false;
    bool solar_v = true;
    bool load = false;
  };
  explicit SolarController(Features f) : features_(f) {}
  void values(const Device &d, Values &out) const override;

 protected:
  void set_reading(const SolarReading &r) { reading_ = r; }
  const std::optional<SolarReading> &reading() const { return reading_; }

 private:
  Features features_;
  std::optional<SolarReading> reading_;
};

// ---- Surge protector / energy management system: voltage_v, current_a, power_w, ... ----

struct SurgeLeg {
  std::optional<float> voltage_v;
  std::optional<float> current_a;
  std::optional<float> power_w;
};

struct SurgeReading {
  SurgeLeg l1;
  std::optional<SurgeLeg> l2;  // 50 A services
  std::optional<float> frequency_hz;
  std::optional<float> energy_kwh;
  std::string fault;  // empty when the power is fine
};

class SurgeProtector : public Driver {
 public:
  struct Features {
    bool two_legs = false;  // a 50 A model
    bool frequency = true;
    bool energy = false;
  };
  explicit SurgeProtector(Features f) : features_(f) {}
  void values(const Device &d, Values &out) const override;

 protected:
  void set_reading(const SurgeReading &r) { reading_ = r; }
  const std::optional<SurgeReading> &reading() const { return reading_; }

 private:
  Features features_;
  std::optional<SurgeReading> reading_;
};

// ---- Refrigerator / cooler: temp (or left/right zones), targets, power, mode, panel lock ----

struct FridgeZone {
  float current_c;
  float target_c;
};

struct FridgeState {
  FridgeZone left;                  // the only zone of a single-zone fridge
  std::optional<FridgeZone> right;  // dual-zone models
  float min_c, max_c;               // settable target range
  float step_c = 1;                 // one of the fridge's own degrees (5/9 when it works in °F)
  int decimals = 0;                 // of the temperatures
  bool powered_on = true;
  std::optional<bool> eco;           // eco / max cooling mode, when the fridge has one
  std::optional<bool> panel_locked;  // the fridge's own panel lock, when it has one
  std::optional<float> supply_v;
  std::optional<float> battery_pct;
};

/// A change asked for from a phone, already checked against the fridge's range.
struct FridgeChange {
  std::optional<bool> powered_on;
  std::optional<bool> eco;
  std::optional<bool> panel_locked;
  std::optional<float> left_target_c;
  std::optional<float> right_target_c;
};

/// Fridges are connected devices: subclasses implement the Handler session, and call
/// change_from() on each command to learn what to write.
class Refrigerator : public Driver, public Handler {
 public:
  void values(const Device &d, Values &out) const override;
  void controls(const Device &d, Controls &out) const override;
  Handler *handler() override { return this; }
  const char *validate(const Device &d, const Command &c) const override;

 protected:
  void set_state(const FridgeState &s) { state_ = s; }
  const std::optional<FridgeState> &state() const { return state_; }
  /// The change a validated "set" command asks for.
  FridgeChange change_from(const Command &c) const;

 private:
  std::optional<FridgeState> state_;
};

// ---- Lock: last_action, the lock/unlock action, lock_only and unlock_pin settings ----

enum class LockAction : uint8_t { LOCK, UNLOCK };

/// Locks are connected devices: subclasses implement the Handler session. The class handles the
/// standard settings (lock only, ask for the PIN to unlock) and checks commands against them.
class Lock : public Driver, public Handler {
 public:
  void values(const Device &d, Values &out) const override;
  void controls(const Device &d, Controls &out) const override;
  Handler *handler() override { return this; }
  void default_settings(cJSON *out) const override;
  void setting_defs(const Device &d, Controls &out) const override;
  bool valid_setting(const char *key, const cJSON *value) const override;
  bool action_needs_pin(const Device &d, const std::string &action) const override;
  const char *validate(const Device &d, const Command &c) const override;

 protected:
  void set_last_action(LockAction a) { last_action_ = a; }
  /// Whether the lock can be operated now; an error code such as "refused" when not (for example
  /// no password stored yet).
  virtual const char *ready(const Device &) const { return nullptr; }

 private:
  std::optional<LockAction> last_action_;
};

}  // namespace openrv
