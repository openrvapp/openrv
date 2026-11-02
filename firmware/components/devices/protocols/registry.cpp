// Every supported device model. Adding a protocol: add its folder next to this file, then one
// line below (see CONTRIBUTING.md, "Adding a device"). Discovery asks each model in this order
// whether it recognizes an advert, so put models with a precise check before vague ones.
#include "openrv/device.h"

namespace openrv {

extern const DriverInfo ALPICOOL_COOLER;
extern const DriverInfo GOPOWER_PWM;
extern const DriverInfo INKBIRD_IBS_TH;
extern const DriverInfo MOPEKA_PRO;
extern const DriverInfo RVLOCK_TREK;

namespace {

const DriverInfo *const DRIVERS[] = {
    &MOPEKA_PRO,
    &ALPICOOL_COOLER,
    &INKBIRD_IBS_TH,
    &GOPOWER_PWM,
    &RVLOCK_TREK,
};

}  // namespace

std::span<const DriverInfo *const> drivers() { return DRIVERS; }

}  // namespace openrv
