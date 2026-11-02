#pragma once

#include <optional>

#include "openrv/advert.h"

namespace openrv::inkbird {

struct Reading {
  float temperature_c;
  std::optional<float> humidity_pct;  // unset on models without a humidity sensor
  uint8_t battery_pct;
};

/// Inkbird IBS-TH / IBS-TH2: nine-byte manufacturer data where the temperature sits in the
/// "company ID" bytes. They advertise the name "sps" (IBS-TH) or "tps" (IBS-TH2) in the scan response.
bool looks_like(const Advert &ad);
std::optional<Reading> decode(const Advert &ad);

}  // namespace openrv::inkbird
