// Inkbird IBS-TH / IBS-TH2 nine-byte advertisements. Layout and plausibility checks from
// Bluetooth-Devices/inkbird-ble (MIT), see THIRD_PARTY_NOTICES.md.
#include "inkbird_ibs_th.h"

namespace openrv::inkbird {

namespace {

constexpr size_t MESSAGE_LEN = 9;  // company-ID bytes + 7 data bytes

/// The 9-byte message: the "company ID" bytes carry the temperature, then the data bytes follow.
bool message(const Advert &ad, uint8_t out[MESSAGE_LEN]) {
  auto m = ad.manufacturer();
  if (!m || ad.count(Advert::AD_MANUFACTURER) != 1 || m->data.size() != MESSAGE_LEN - 2)
    return false;
  out[0] = static_cast<uint8_t>(m->company_id);
  out[1] = static_cast<uint8_t>(m->company_id >> 8);
  for (size_t i = 0; i < m->data.size(); i++)
    out[2 + i] = m->data[i];
  return true;
}

}  // namespace

bool looks_like(const Advert &ad) {
  // The name is the only reliable sign: plenty of other devices send 7 bytes of manufacturer data.
  auto name = ad.name();
  return name == "sps" || name == "tps";
}

std::optional<Reading> decode(const Advert &ad) {
  uint8_t m[MESSAGE_LEN];
  if (!message(ad, m))
    return std::nullopt;
  int16_t temp = static_cast<int16_t>(m[0] | (m[1] << 8));
  uint16_t hum = static_cast<uint16_t>(m[2] | (m[3] << 8));
  uint8_t battery = m[7];

  // The IBS-P01B sends 0 or 0xFFFF for "no humidity sensor"; otherwise >100 % or a battery
  // above 100 % marks a corrupt packet, and the whole reading is dropped.
  bool has_humidity = hum != 0 && hum != 0xFFFF;
  if ((has_humidity && hum > 10000) || battery > 100)
    return std::nullopt;

  return Reading{
      .temperature_c = temp / 100.0f,
      .humidity_pct = has_humidity ? std::optional<float>(hum / 100.0f) : std::nullopt,
      .battery_pct = battery,
  };
}

}  // namespace openrv::inkbird
