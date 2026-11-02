// The advert-style device classes: each turns its reading struct into the standard values.
#include <cstring>

#include "openrv/device.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

template <typename R, typename F> std::optional<float> field(const std::optional<R> &r, F f) {
  return r ? std::optional<float>(f(*r)) : std::nullopt;
}

template <typename R> std::optional<float> opt(const std::optional<R> &r, std::optional<float> R::*m) {
  return r ? (*r).*m : std::nullopt;
}

}  // namespace

// ---- Temperature sensor ----

void TemperatureSensor::values(const Device &, Values &out) const {
  out.number("temp", "Temperature", "C", field(reading_, [](auto &r) { return r.temperature_c; }), features_.decimals).primary();
  if (features_.humidity)
    out.number("humidity", "Humidity", "%", opt(reading_, &TemperatureReading::humidity_pct));
  if (features_.battery)
    out.number("battery", "Battery", "%", opt(reading_, &TemperatureReading::battery_pct));
}

// ---- Liquid level sensor ----

void LiquidLevelSensor::values(const Device &d, Values &out) const {
  out.number("level", "Level", "%", reading_ ? level_pct(d, *reading_) : std::nullopt).primary().range(0, 100);
  if (features_.height)
    out.number("height", "Height", "mm", opt(reading_, &LevelReading::height_mm));
  if (features_.temperature)
    out.number("temp", "Temperature", "C", opt(reading_, &LevelReading::temperature_c));
  if (features_.battery)
    out.number("battery", "Battery", "%", opt(reading_, &LevelReading::battery_pct));
  if (features_.quality) {
    static constexpr const char *QUALITY[] = {"none", "low", "medium", "high"};
    const char *q = reading_ && reading_->quality ? QUALITY[static_cast<int>(*reading_->quality)] : nullptr;
    out.choice("quality", "Echo", q, {"none", "low", "medium", "high"});
  }
}

void LiquidLevelSensor::traits(cJSON *out) const {
  static constexpr const char *FLUIDS[] = {"propane", "fresh_water", "grey_water", "black_water", "fuel", "other"};
  cJSON_AddStringToObject(out, "fluid", FLUIDS[static_cast<int>(features_.fluid)]);
}

// ---- Battery monitor ----

void BatteryMonitor::values(const Device &, Values &out) const {
  out.number("soc", "Charge", "%", opt(reading_, &BatteryReading::soc_pct)).primary().range(0, 100);
  out.number("battery_v", "Voltage", "V", opt(reading_, &BatteryReading::voltage_v), 2).range(11.0f, 14.6f);
  if (features_.current)
    out.number("current_a", "Current", "A", opt(reading_, &BatteryReading::current_a), 1);
  if (features_.power)
    out.number("power_w", "Power", "W", opt(reading_, &BatteryReading::power_w));
  if (features_.remaining)
    out.number("remaining_ah", "Remaining", "Ah", opt(reading_, &BatteryReading::remaining_ah));
  if (features_.time_left)
    out.number("time_left_min", "Time left", "min", opt(reading_, &BatteryReading::time_left_min));
  if (features_.temperature)
    out.number("temp", "Temperature", "C", opt(reading_, &BatteryReading::temperature_c));
}

// ---- Solar charge controller ----

void SolarController::values(const Device &, Values &out) const {
  out.number("battery_v", "Battery", "V", opt(reading_, &SolarReading::battery_v), 1).primary().range(11.0f, 14.6f);
  if (features_.battery_pct)
    out.number("battery_pct", "Charge", "%", opt(reading_, &SolarReading::battery_pct));
  out.number("solar_w", "Solar", "W", opt(reading_, &SolarReading::solar_w));
  out.number("charge_a", "Charging", "A", opt(reading_, &SolarReading::charge_a), 1);
  if (features_.solar_v)
    out.number("solar_v", "Panel", "V", opt(reading_, &SolarReading::solar_v));
  if (features_.load)
    out.number("load_a", "Load", "A", opt(reading_, &SolarReading::load_a), 1);
}

// ---- Surge protector ----

void SurgeProtector::values(const Device &, Values &out) const {
  bool two = features_.two_legs || (reading_ && reading_->l2);
  auto leg = [&](const char *prefix, const char *name, const std::optional<SurgeLeg> &l, bool primary) {
    std::string p = prefix, n = name;
    auto get = [&](std::optional<float> SurgeLeg::*m) { return l ? (*l).*m : std::nullopt; };
    out.number((p + "voltage_v").c_str(), (n + "Voltage").c_str(), "V", get(&SurgeLeg::voltage_v)).range(100, 140);
    if (primary)
      out.primary();
    out.number((p + "current_a").c_str(), (n + "Current").c_str(), "A", get(&SurgeLeg::current_a), 1);
    out.number((p + "power_w").c_str(), (n + "Power").c_str(), "W", get(&SurgeLeg::power_w));
  };
  std::optional<SurgeLeg> l1 = reading_ ? std::optional(reading_->l1) : std::nullopt;
  if (two) {
    leg("l1.", "L1 ", l1, true);
    leg("l2.", "L2 ", reading_ ? reading_->l2 : std::nullopt, false);
  } else {
    leg("", "", l1, true);
  }
  if (features_.frequency)
    out.number("frequency_hz", "Frequency", "Hz", reading_ ? reading_->frequency_hz : std::nullopt, 1);
  if (features_.energy)
    out.number("energy_kwh", "Energy", "kWh", reading_ ? reading_->energy_kwh : std::nullopt, 1);
  out.text("fault", "Fault", reading_ && !reading_->fault.empty() ? reading_->fault.c_str() : nullptr);
}

}  // namespace openrv
