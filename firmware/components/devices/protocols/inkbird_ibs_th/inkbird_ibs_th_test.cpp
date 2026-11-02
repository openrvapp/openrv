// Host tests: Inkbird IBS-TH. Run with firmware/test/host (see its CMakeLists.txt).
#include <cmath>
#include <string>

#include "inkbird_ibs_th.h"
#include "device_testing.h"

using namespace openrv;
using testing::hex;

// ---- Decoder ----

TEST(inkbird_decodes_ibs_th2) {
  // 23.45 C in the company-id bytes, 45.67 % humidity, internal sensor, 100 % battery, name "sps".
  auto raw = hex("0A FF 29 09 D7 11 00 00 00 64 08 04 09 73 70 73");
  Advert ad(raw);
  EXPECT_TRUE(ad.name() == "sps");
  EXPECT_TRUE(inkbird::looks_like(ad));
  auto r = inkbird::decode(ad);
  EXPECT_NEAR(r->temperature_c, 23.45, 1e-4);
  EXPECT_NEAR(*r->humidity_pct, 45.67, 1e-4);
  EXPECT_EQ(r->battery_pct, 100);
}

TEST(inkbird_without_humidity_sensor_reports_temperature_only) {
  auto r = inkbird::decode(Advert(hex("0A FF 29 09 FF FF 00 00 00 64 08")));
  EXPECT_TRUE(r.has_value());
  EXPECT_TRUE(!r->humidity_pct.has_value());
}

TEST(inkbird_drops_corrupt_battery) {
  EXPECT_TRUE(!inkbird::decode(Advert(hex("0A FF 29 09 D7 11 00 00 00 FF 08"))).has_value());
}

TEST(inkbird_decodes_negative_temperature) {
  EXPECT_NEAR(inkbird::decode(Advert(hex("0A FF 0C FE 10 27 00 00 00 50 08")))->temperature_c, -5.0, 1e-4);
}

// ---- Driver ----

TEST(inkbird_driver_is_a_temperature_sensor) {
  auto d = testing::make("inkbird_ibs_th2");
  EXPECT_TRUE(testing::advert(*d, "0A FF 29 09 D7 11 00 00 00 64 08 04 09 73 70 73"));
  auto j = testing::json(*d);
  EXPECT_EQ(std::string(json_string(j.get(), "class")), "temperature_sensor");
  EXPECT_NEAR(testing::number(*d, "temp"), 23.45, 1e-4);
  EXPECT_NEAR(testing::number(*d, "humidity"), 45.67, 1e-4);
  EXPECT_NEAR(testing::number(*d, "battery"), 100, 1e-6);
  EXPECT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(testing::item(*d, "values", "temp"), "primary")));
}

TEST(inkbird_driver_ignores_other_adverts) {
  auto d = testing::make("inkbird_ibs_th2");
  EXPECT_TRUE(!testing::advert(*d, "04 09 73 70 73"));  // the scan response alone
}
