// Mopeka Pro family. Format and LPG coefficients from Bluetooth-Devices/mopeka-iot-ble (MIT),
// see THIRD_PARTY_NOTICES.md.
#include "mopeka_pro.h"

#include <algorithm>

namespace openrv::mopeka {

namespace {

constexpr size_t DATA_LEN = 10;
// Converts the raw level to millimetres of propane, compensating for temperature.
constexpr double PROPANE_COEF[] = {0.573045, -0.002822, -0.00000535};

/// Model bytes of the Pro family (Pro Check, BottleCheck, Pro Plus, TD40/TD200, Pro-200, Universal).
bool supported_type(uint8_t t) {
  switch (t) {
    case 0x03: case 0x04: case 0x05: case 0x06: case 0x08: case 0x09: case 0x0A: case 0x0B: case 0x0C: case 0x12:
      return true;
    default:
      return false;
  }
}

std::optional<Bytes> payload(const Advert &ad) {
  auto m = ad.manufacturer();
  if (!m || m->company_id != COMPANY_ID || m->data.size() != DATA_LEN || !supported_type(m->data[0]))
    return std::nullopt;
  return m->data;
}

}  // namespace

bool looks_like(const Advert &ad) { return payload(ad).has_value(); }

std::optional<Reading> decode(const Advert &ad) {
  auto p = payload(ad);
  if (!p)
    return std::nullopt;
  const Bytes d = *p;

  int raw_temp = d[2] & 0x7F;
  int raw_level = ((d[4] << 8) | d[3]) & 0x3FFF;
  double mm = raw_level * (PROPANE_COEF[0] + PROPANE_COEF[1] * raw_temp + PROPANE_COEF[2] * raw_temp * raw_temp);
  float volts = d[1] / 32.0f;

  return Reading{
      .distance_mm = static_cast<float>(static_cast<int>(mm)),
      .temperature_c = static_cast<int8_t>(raw_temp - 40),
      .battery_pct = static_cast<uint8_t>(std::clamp((volts - 2.2f) / 0.65f * 100.0f, 0.0f, 100.0f)),
      .battery_v = volts,
      .quality = static_cast<Quality>(d[4] >> 6),
      .sensor_type = d[0],
  };
}

float level_pct(float height_mm, const Tank &tank) {
  if (tank.full_mm <= tank.empty_mm)
    return 0;
  return std::clamp(100.0f * (height_mm - tank.empty_mm) / (tank.full_mm - tank.empty_mm), 0.0f, 100.0f);
}

}  // namespace openrv::mopeka
