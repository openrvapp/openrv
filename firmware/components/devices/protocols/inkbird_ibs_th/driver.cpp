// Inkbird IBS-TH and IBS-TH2 thermometers (with humidity on the models that have it).
#include "inkbird_ibs_th.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

class InkbirdIbsTh : public TemperatureSensor {
 public:
  InkbirdIbsTh() : TemperatureSensor({.humidity = true, .battery = true, .decimals = 1}) {}

  bool on_advert(const Device &, const Advert &ad) override {
    auto r = inkbird::decode(ad);
    if (!r)
      return false;
    set_reading({.temperature_c = r->temperature_c, .humidity_pct = r->humidity_pct, .battery_pct = r->battery_pct});
    return true;
  }
};

}  // namespace

// The type id predates the IBS-TH support; it stays for existing configurations.
extern const DriverInfo INKBIRD_IBS_TH = {
    .type = "inkbird_ibs_th2",
    .model = "Inkbird IBS-TH / IBS-TH2",
    .device_class = DeviceClass::TEMPERATURE_SENSOR,
    .transport = Transport::ADVERT,
    .looks_like = [](const Advert &ad, const Mac &) { return inkbird::looks_like(ad); },
    .create = []() -> std::unique_ptr<Driver> { return std::make_unique<InkbirdIbsTh>(); },
};

}  // namespace openrv
