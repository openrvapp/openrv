// Host tests: Alpicool cooler, from BrassMonkeyFridgeMonitor captures. Run with firmware/test/host (see its CMakeLists.txt).
#include <cmath>
#include <string>

#include "alpicool.h"
#include "device_testing.h"

using namespace openrv;
using testing::hex;

// ---- Decoder ----

static const auto COOLER_QUERY_RESPONSE = hex("fe fe 15 01 00 01 00 00 f1 14 ec 02 00 00 00 00 00 00 f3 64 0c 03 05 6c");

TEST(alpicool_query_frame_matches_capture) { EXPECT_EQ(alpicool::build_query(), hex("fe fe 03 01 02 00")); }

TEST(alpicool_set_left_matches_reference_encoder) {
  uint8_t target = static_cast<uint8_t>(-20);
  EXPECT_EQ(alpicool::build_frame(alpicool::CMD_SET_LEFT, {&target, 1}), hex("fe fe 04 05 ec 02 f1"));
}

TEST(alpicool_query_response_decodes) {
  auto f = alpicool::parse_frame(COOLER_QUERY_RESPONSE);
  EXPECT_TRUE(f.has_value());
  EXPECT_EQ(f->command, alpicool::CMD_QUERY);
  auto s = alpicool::decode_status(f->data);
  EXPECT_TRUE(s.has_value());
  EXPECT_TRUE(!s->locked);
  EXPECT_TRUE(s->powered_on);
  EXPECT_TRUE(s->run_mode == alpicool::RunMode::MAX);
  EXPECT_EQ(s->left.target, -15);
  EXPECT_EQ(s->max_temp, 20);
  EXPECT_EQ(s->min_temp, -20);
  EXPECT_EQ(s->left.current, -13);
  EXPECT_EQ(*s->battery_pct, 100);
  EXPECT_NEAR(s->battery_v, 12.3, 1e-4);
  EXPECT_TRUE(s->unit == alpicool::Unit::C);
  EXPECT_TRUE(!s->right.has_value());
}

TEST(alpicool_unknown_battery_percent_is_unset) {
  auto f = alpicool::parse_frame(hex("fe fe 15 01 00 01 00 00 ec 14 ec 02 00 00 00 00 00 00 f7 7f 0b 01 05 83"));
  auto s = alpicool::decode_status(f->data);
  EXPECT_TRUE(!s->battery_pct.has_value());
  EXPECT_NEAR(s->battery_v, 11.1, 1e-4);
}

TEST(alpicool_set_frame_matches_capture) {
  alpicool::Status s{};
  s.powered_on = true;
  s.run_mode = alpicool::RunMode::MAX;
  s.battery_saver = alpicool::BatterySaver::HIGH;
  s.left.target = -20;
  s.max_temp = 20;
  s.min_temp = -20;
  s.left.hysteresis = 2;
  EXPECT_EQ(alpicool::build_set(s), hex("fe fe 11 02 00 01 00 02 ec 14 ec 02 00 00 00 00 00 00 04 00"));
}

TEST(alpicool_dual_zone_round_trips) {
  auto data = hex(
      "00 01 00 02 f1 14 ec 02 00 00 00 00 00 00 f3 64 0c 03 "
      "f6 00 00 03 01 02 03 04 f8 00");
  auto s = alpicool::decode_status(alpicool::parse_frame(alpicool::build_frame(alpicool::CMD_QUERY, data))->data);
  EXPECT_TRUE(s->right.has_value());
  EXPECT_EQ(s->right->target, -10);
  EXPECT_EQ(s->right->current, -8);
  EXPECT_EQ(s->right->hysteresis, 3);
  auto set = alpicool::parse_frame(alpicool::build_set(*s))->data;
  EXPECT_EQ(set.size(), 25u);
  EXPECT_EQ(std::vector<uint8_t>(set.begin() + 14, set.end()), hex("f6 00 00 03 01 02 03 04 00 00 00"));
}

TEST(alpicool_rejects_bad_checksum) { EXPECT_TRUE(!alpicool::parse_frame(hex("fe fe 03 01 02 01")).has_value()); }

TEST(alpicool_assembler_joins_split_notifications) {
  alpicool::Assembler a;
  Bytes all = COOLER_QUERY_RESPONSE;
  EXPECT_EQ(a.feed(all.first(10)).size(), 0u);
  auto frames = a.feed(all.subspan(10));
  EXPECT_EQ(frames.size(), 1u);
  EXPECT_EQ(frames[0].command, alpicool::CMD_QUERY);
}

TEST(alpicool_assembler_skips_garbage_and_reads_two_frames) {
  alpicool::Assembler a;
  auto frames = a.feed(hex("00 11 fe fe 03 01 02 00 fe fe 04 05 ec 02 f1"));
  EXPECT_EQ(frames.size(), 2u);
  EXPECT_EQ(frames[1].command, alpicool::CMD_SET_LEFT);
  EXPECT_EQ(frames[1].data[0], 0xEC);
}

TEST(alpicool_recognizes_its_advertised_name) {
  const uint8_t mac[6] = {0x94, 0x77, 0xF2, 0x2E, 0x28, 0xEE};
  auto ad = hex("10 09 41 31 2D 39 34 37 37 46 32 32 65 32 38 45 45");  // "A1-9477F22e28EE"
  EXPECT_TRUE(alpicool::looks_like(Advert(ad), mac));
  const uint8_t other[6] = {0x94, 0x77, 0xF2, 0x2E, 0x28, 0xEF};
  EXPECT_TRUE(!alpicool::looks_like(Advert(ad), other));
}

// ---- Driver ----

/// The captured status, changed to a cooler set to Fahrenheit.
static std::vector<uint8_t> fahrenheit_status() {
  auto f = alpicool::parse_frame(COOLER_QUERY_RESPONSE);
  std::vector<uint8_t> data(f->data.begin(), f->data.end());
  data[9] = 1;                          // unit: F
  data[4] = 34;                         // left target
  data[5] = 68;                         // max
  data[6] = static_cast<uint8_t>(-4);   // min
  data[14] = 35;                        // left current
  return alpicool::build_frame(alpicool::CMD_QUERY, data);
}

static void read_status(Device &d, std::vector<uint8_t> frame, std::deque<Command> &commands,
                        testing::FakeSession &io, bool scheduled = false) {
  Handler *h = d.driver->handler();
  io.finished = false;
  h->begin(d, io, commands, scheduled);
  h->data(d, io, frame, commands);
}

TEST(alpicool_driver_reports_a_celsius_cooler) {
  auto d = testing::make("alpicool_cooler");
  testing::FakeSession io;
  std::deque<Command> commands;
  read_status(*d, COOLER_QUERY_RESPONSE, commands, io);
  EXPECT_TRUE(io.finished);
  EXPECT_EQ(std::string(json_string(testing::json(*d).get(), "class")), "refrigerator");
  EXPECT_NEAR(testing::number(*d, "temp"), -13, 1e-6);
  EXPECT_NEAR(cJSON_GetObjectItem(testing::item(*d, "controls", "target"), "value")->valuedouble, -15, 1e-6);
  EXPECT_NEAR(testing::number(*d, "battery_v"), 12.3, 1e-4);
}

TEST(alpicool_driver_converts_a_fahrenheit_cooler) {
  auto d = testing::make("alpicool_cooler");
  testing::FakeSession io;
  std::deque<Command> commands;
  read_status(*d, fahrenheit_status(), commands, io);
  EXPECT_NEAR(testing::number(*d, "temp"), (35 - 32) * 5.0 / 9, 1e-4);
  const cJSON *target = testing::item(*d, "controls", "target");
  EXPECT_NEAR(cJSON_GetObjectItem(target, "step")->valuedouble, 5.0 / 9, 1e-4);

  // One step up from 34 F, sent in Celsius, reaches the cooler as 35 F.
  double up = cJSON_GetObjectItem(target, "value")->valuedouble + 5.0 / 9;
  commands.push_back(testing::command("set", ("{\"target\": " + std::to_string(up) + "}").c_str()));
  EXPECT_TRUE(d->driver->handler()->validate(*d, commands.front()) == nullptr);
  read_status(*d, fahrenheit_status(), commands, io);
  auto set = alpicool::parse_frame(io.written.back());
  EXPECT_EQ(set->command, alpicool::CMD_SET);
  EXPECT_EQ(static_cast<int8_t>(set->data[4]), 35);
}

TEST(alpicool_driver_scheduled_check_turns_it_on_and_locks_it) {
  auto d = testing::make("alpicool_cooler");
  auto f = alpicool::parse_frame(COOLER_QUERY_RESPONSE);
  std::vector<uint8_t> off(f->data.begin(), f->data.end());
  off[1] = 0;  // powered off
  testing::FakeSession io;
  std::deque<Command> commands;
  read_status(*d, alpicool::build_frame(alpicool::CMD_QUERY, off), commands, io, true);
  auto set = alpicool::parse_frame(io.written.back());
  EXPECT_EQ(set->command, alpicool::CMD_SET);
  EXPECT_EQ(set->data[0], 1);  // panel locked
  EXPECT_EQ(set->data[1], 1);  // powered on
}
