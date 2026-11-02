// Mopeka Pro family propane sensors, as liquid level sensors. The level comes from the height of
// propane and the tank size chosen in the device's settings.
#include <cstring>

#include "mopeka_pro.h"
#include "openrv/device.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

class MopekaPro : public LiquidLevelSensor {
 public:
  MopekaPro()
      : LiquidLevelSensor({.fluid = Fluid::PROPANE, .height = true, .temperature = true, .battery = true, .quality = true}) {}

  bool on_advert(const Device &, const Advert &ad) override {
    auto r = mopeka::decode(ad);
    if (!r)
      return false;
    bool echo = r->quality != mopeka::Quality::NONE;
    set_reading({
        .level_pct = std::nullopt,  // worked out in level_pct() from the tank size
        .height_mm = echo ? std::optional(r->distance_mm) : std::nullopt,
        .temperature_c = r->temperature_c,
        .battery_pct = r->battery_pct,
        .quality = static_cast<EchoQuality>(r->quality),
    });
    return true;
  }

  void default_settings(cJSON *out) const override {
    cJSON_AddStringToObject(out, "tank", "lb20_vertical");
    cJSON_AddNumberToObject(out, "empty_mm", 0);
    cJSON_AddNumberToObject(out, "full_mm", 0);
  }

  void setting_defs(const Device &d, Controls &out) const override {
    const char *tank = setting_string(d, "tank");
    bool preset = tank && mopeka::find_tank_preset(tank);
    out.choice("tank", "Tank size", preset ? tank : "custom", {});
    for (const auto &p : mopeka::TANK_PRESETS)
      out.option(p.id, p.label);
    out.option("custom", "Custom");
    if (!preset) {
      // A custom tank: the propane height reading when it is empty and when it is full.
      out.number("empty_mm", "Empty at", "mm", 0, 1000, 1, setting_number(d, "empty_mm", 0));
      out.number("full_mm", "Full at", "mm", 0, 1000, 1, setting_number(d, "full_mm", 0));
    }
  }

  bool valid_setting(const char *key, const cJSON *v) const override {
    if (!std::strcmp(key, "tank"))
      return cJSON_IsString(v) && (!std::strcmp(v->valuestring, "custom") || mopeka::find_tank_preset(v->valuestring));
    return (!std::strcmp(key, "empty_mm") || !std::strcmp(key, "full_mm")) && cJSON_IsNumber(v) && v->valuedouble >= 0 &&
           v->valuedouble <= 1000;
  }

 protected:
  std::optional<float> level_pct(const Device &d, const LevelReading &r) const override {
    if (!r.height_mm)
      return std::nullopt;  // no echo
    const char *id = setting_string(d, "tank");
    const mopeka::TankPreset *preset = id ? mopeka::find_tank_preset(id) : nullptr;
    mopeka::Tank tank = preset ? preset->tank
                               : mopeka::Tank{static_cast<float>(setting_number(d, "empty_mm", 0)),
                                              static_cast<float>(setting_number(d, "full_mm", 0))};
    if (tank.full_mm <= tank.empty_mm)
      return std::nullopt;  // a custom tank not calibrated yet: only the height shows
    return mopeka::level_pct(*r.height_mm, tank);
  }
};

}  // namespace

extern const DriverInfo MOPEKA_PRO = {
    .type = "mopeka_pro",
    .model = "Mopeka Pro Check",
    .device_class = DeviceClass::LIQUID_LEVEL_SENSOR,
    .transport = Transport::ADVERT,
    .looks_like = [](const Advert &ad, const Mac &) { return mopeka::looks_like(ad); },
    .create = []() -> std::unique_ptr<Driver> { return std::make_unique<MopekaPro>(); },
};

}  // namespace openrv
