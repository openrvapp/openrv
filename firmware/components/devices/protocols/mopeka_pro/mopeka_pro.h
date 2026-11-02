#pragma once

#include <optional>

#include "openrv/advert.h"

namespace openrv::mopeka {

constexpr uint16_t COMPANY_ID = 0x0059;

enum class Quality : uint8_t { NONE = 0, LOW = 1, MEDIUM = 2, HIGH = 3 };

struct Reading {
  float distance_mm;  // height of propane above the sensor
  int8_t temperature_c;
  uint8_t battery_pct;
  float battery_v;
  Quality quality;  // NONE = no echo, so distance_mm means nothing
  uint8_t sensor_type;
};

/// A tank's calibration: the readings when it is empty and when it is full, in millimetres.
struct Tank {
  float empty_mm;
  float full_mm;
};

struct TankPreset {
  const char *id;
  const char *label;
  Tank tank;
};

/// Common LP cylinders. The empty/full distances are the values ESPHome's mopeka_pro_check
/// component uses (data only; see THIRD_PARTY_NOTICES.md).
inline constexpr TankPreset TANK_PRESETS[] = {
    {"lb20_vertical", "20 lb vertical", {38, 254}}, {"lb30_vertical", "30 lb vertical", {38, 381}},
    {"lb40_vertical", "40 lb vertical", {38, 508}}, {"eu6kg", "6 kg (Europe)", {38, 336}},
    {"eu11kg", "11 kg (Europe)", {38, 366}},        {"eu14kg", "14 kg (Europe)", {38, 467}},
};

/// The preset with this id, or nullptr.
inline const TankPreset *find_tank_preset(std::string_view id) {
  for (const auto &p : TANK_PRESETS)
    if (id == p.id)
      return &p;
  return nullptr;
}

bool looks_like(const Advert &ad);
std::optional<Reading> decode(const Advert &ad);
/// Fill level in percent, 0-100, from the height of propane.
float level_pct(float height_mm, const Tank &tank);

}  // namespace openrv::mopeka
