// Host tests: Mopeka Pro. Run with firmware/test/host (see its CMakeLists.txt).
#include <cmath>
#include <string>

#include "mopeka_pro.h"
#include "device_testing.h"

using namespace openrv;
using testing::hex;

// ---- Decoder ----

TEST(mopeka_decodes_pro_check_advert) {
  // flags + manufacturer data: type 0x03, 3.0 V, 20 C (raw 60), raw level 1000, quality high.
  auto ad = hex("02 01 06 0D FF 59 00 03 60 3C E8 C3 AA BB CC 00 00");
  EXPECT_TRUE(mopeka::looks_like(Advert(ad)));
  auto r = mopeka::decode(Advert(ad));
  EXPECT_TRUE(r.has_value());
  EXPECT_EQ(r->temperature_c, 20);
  EXPECT_EQ(r->battery_pct, 100);
  EXPECT_TRUE(r->quality == mopeka::Quality::HIGH);
  EXPECT_NEAR(r->distance_mm, 384, 1e-4);
  EXPECT_NEAR(mopeka::level_pct(r->distance_mm, {38, 508}), 100.0 * (384 - 38) / (508 - 38), 1e-3);
  EXPECT_NEAR(mopeka::level_pct(r->distance_mm, mopeka::find_tank_preset("lb20_vertical")->tank), 100, 1e-6);
}

TEST(mopeka_rejects_unsupported_sensor_type) {
  EXPECT_TRUE(!mopeka::decode(Advert(hex("0D FF 59 00 07 60 3C E8 C3 00 00 00 00 00"))).has_value());
}

// ---- Driver ----

static constexpr const char *PRO_CHECK_ADVERT = "02 01 06 0D FF 59 00 03 60 3C E8 C3 AA BB CC 00 00";

TEST(mopeka_driver_is_a_propane_level_sensor) {
  auto d = testing::make("mopeka_pro");
  auto j = testing::json(*d);
  EXPECT_EQ(std::string(json_string(j.get(), "class")), "liquid_level_sensor");
  EXPECT_EQ(std::string(json_string(cJSON_GetObjectItem(j.get(), "traits"), "fluid")), "propane");
  EXPECT_TRUE(std::isnan(testing::number(*d, "level")));  // nothing heard yet
}

TEST(mopeka_driver_reports_level_for_the_chosen_tank) {
  auto d = testing::make("mopeka_pro");
  EXPECT_TRUE(testing::advert(*d, PRO_CHECK_ADVERT));
  EXPECT_NEAR(testing::number(*d, "level"), 100, 1e-6);  // 384 mm is above full in a 20 lb tank
  EXPECT_TRUE(testing::settings(*d, R"({"tank": "lb40_vertical"})"));
  EXPECT_NEAR(testing::number(*d, "level"), 100.0 * (384 - 38) / (508 - 38), 1e-3);
  EXPECT_NEAR(testing::number(*d, "height"), 384, 1e-6);
  EXPECT_NEAR(testing::number(*d, "temp"), 20, 1e-6);
  EXPECT_EQ(std::string(json_string(testing::item(*d, "values", "quality"), "value")), "high");
}

TEST(mopeka_driver_shows_height_only_until_a_custom_tank_is_calibrated) {
  auto d = testing::make("mopeka_pro");
  testing::advert(*d, PRO_CHECK_ADVERT);
  EXPECT_TRUE(testing::settings(*d, R"({"tank": "custom"})"));
  EXPECT_TRUE(std::isnan(testing::number(*d, "level")));
  EXPECT_TRUE(testing::item(*d, "setting_defs", "full_mm") != nullptr);
  EXPECT_TRUE(testing::settings(*d, R"({"empty_mm": 38, "full_mm": 508})"));
  EXPECT_NEAR(testing::number(*d, "level"), 100.0 * (384 - 38) / (508 - 38), 1e-3);
  EXPECT_TRUE(!testing::settings(*d, R"({"tank": "lb1000"})"));
}
