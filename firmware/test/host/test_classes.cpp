// Host tests for the device classes: the standard values each one reports, whatever the driver.
#include <cmath>
#include <string>

#include "device_testing.h"
#include "openrv/device_classes.h"

using namespace openrv;

namespace {

/// Drivers with no protocol, so a test can hand the class a reading directly.
class TestBattery : public BatteryMonitor {
 public:
  TestBattery() : BatteryMonitor({.current = true, .power = true, .remaining = true, .time_left = true}) {}
  using BatteryMonitor::set_reading;
};

class TestSurge : public SurgeProtector {
 public:
  explicit TestSurge(bool two_legs) : SurgeProtector({.two_legs = two_legs, .frequency = true}) {}
  using SurgeProtector::set_reading;
};

class TestFridge : public Refrigerator {
 public:
  using Refrigerator::change_from;
  using Refrigerator::set_state;
  LinkSpec spec(const Device &d) const override { return {d.mac, 0, 0, 0}; }
  uint32_t interval_s(const Device &) const override { return 0; }
  void begin(Device &, SessionIo &, std::deque<Command> &, bool) override {}
  void data(Device &, SessionIo &, Bytes, std::deque<Command> &) override {}
};

template <typename D, typename... Args> std::unique_ptr<Device> device_with(DeviceClass c, Args... args) {
  static DriverInfo info{"test", "Test", c, Transport::ADVERT, nullptr, nullptr};
  info.device_class = c;
  auto d = std::make_unique<Device>();
  d->id = "test";
  d->info = &info;
  d->driver = std::make_unique<D>(args...);
  d->settings = json_object();
  d->driver->default_settings(d->settings.get());
  return d;
}

const char *str(const cJSON *v, const char *key) { return v ? json_string(v, key) : nullptr; }

}  // namespace

TEST(battery_monitor_reports_charge_first) {
  auto d = device_with<TestBattery>(DeviceClass::BATTERY_MONITOR);
  static_cast<TestBattery &>(*d->driver).set_reading({.soc_pct = 87.0f, .voltage_v = 13.21f, .current_a = -4.2f, .power_w = -55.0f});
  EXPECT_EQ(std::string(str(testing::json(*d).get(), "class")), "battery_monitor");
  EXPECT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(testing::item(*d, "values", "soc"), "primary")));
  EXPECT_NEAR(testing::number(*d, "soc"), 87, 1e-6);
  EXPECT_NEAR(testing::number(*d, "battery_v"), 13.21, 1e-4);
  EXPECT_NEAR(testing::number(*d, "current_a"), -4.2, 1e-4);
  EXPECT_TRUE(std::isnan(testing::number(*d, "remaining_ah")));  // a feature with no data yet
  EXPECT_TRUE(testing::item(*d, "values", "temp") == nullptr);  // a feature it doesn't have
}

TEST(surge_protector_one_leg_uses_plain_keys) {
  auto d = device_with<TestSurge>(DeviceClass::SURGE_PROTECTOR, false);
  static_cast<TestSurge &>(*d->driver).set_reading({.l1 = {120.4f, 12.5f, 1500.0f}, .frequency_hz = 60.0f});
  EXPECT_NEAR(testing::number(*d, "voltage_v"), 120.4, 1e-4);
  EXPECT_NEAR(testing::number(*d, "frequency_hz"), 60, 1e-6);
  EXPECT_TRUE(cJSON_IsNull(cJSON_GetObjectItem(testing::item(*d, "values", "fault"), "value")));
}

TEST(surge_protector_two_legs_and_a_fault) {
  auto d = device_with<TestSurge>(DeviceClass::SURGE_PROTECTOR, true);
  static_cast<TestSurge &>(*d->driver).set_reading({.l1 = {121.0f, 20.0f, 2400.0f}, .l2 = SurgeLeg{118.0f, 5.0f, 590.0f}, .fault = "Open ground"});
  EXPECT_NEAR(testing::number(*d, "l1.voltage_v"), 121, 1e-6);
  EXPECT_NEAR(testing::number(*d, "l2.current_a"), 5, 1e-6);
  EXPECT_TRUE(cJSON_IsTrue(cJSON_GetObjectItem(testing::item(*d, "values", "l1.voltage_v"), "primary")));
  EXPECT_EQ(std::string(str(testing::item(*d, "values", "fault"), "value")), "Open ground");
}

TEST(refrigerator_dual_zone_has_left_and_right) {
  auto d = device_with<TestFridge>(DeviceClass::REFRIGERATOR);
  auto &f = static_cast<TestFridge &>(*d->driver);
  f.set_state({.left = {2, 1}, .right = FridgeZone{-16, -18}, .min_c = -20, .max_c = 20, .eco = true});
  EXPECT_NEAR(testing::number(*d, "left.current"), 2, 1e-6);
  EXPECT_NEAR(testing::number(*d, "right.current"), -16, 1e-6);
  EXPECT_TRUE(testing::item(*d, "controls", "right.target") != nullptr);
  EXPECT_TRUE(testing::item(*d, "controls", "locked") == nullptr);  // no panel lock reported

  Command set = testing::command("set", R"({"right.target": -30, "mode": "max"})");
  EXPECT_TRUE(f.validate(*d, set) == nullptr);
  FridgeChange c = f.change_from(set);
  EXPECT_NEAR(*c.right_target_c, -20, 1e-6);  // held to the fridge's range
  EXPECT_TRUE(c.eco == false);
  EXPECT_EQ(std::string(f.validate(*d, testing::command("set", R"({"locked": true})"))), "bad_request");
}

TEST(every_registered_model_has_a_unique_type) {
  auto all = drivers();
  for (size_t i = 0; i < all.size(); i++) {
    EXPECT_TRUE(all[i]->create != nullptr);
    for (size_t j = i + 1; j < all.size(); j++)
      EXPECT_TRUE(std::string(all[i]->type) != all[j]->type);
  }
}
