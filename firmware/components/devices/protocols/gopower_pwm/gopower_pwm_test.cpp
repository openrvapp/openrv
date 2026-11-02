// Host tests: Go Power PWM. Run with firmware/test/host (see its CMakeLists.txt).
#include <cmath>
#include <string>

#include "gopower_pwm.h"
#include "device_testing.h"

using namespace openrv;
using testing::hex;

// ---- Decoder ----

static std::vector<uint8_t> ascii(const std::string &s) { return {s.begin(), s.end()}; }

TEST(gopower_crc_matches_standard_modbus_vector) { EXPECT_EQ(gopower::modbus_crc16(hex("01 03 00 00 00 0A")), 0xCDC5); }

TEST(gopower_poll_appends_crc_low_byte_first) {
  auto p = gopower::build_poll(1);
  EXPECT_EQ(std::vector<uint8_t>(p.begin(), p.end()), hex("01 03 01 00 00 21 84 2e"));
}

TEST(gopower_decodes_frame_split_across_notifications) {
  auto bytes = ascii("50;00;00;7D;00;00;00;00;00;64;00;00;00;12;02;00\r\n");
  gopower::Parser p;
  EXPECT_TRUE(!p.feed(Bytes(bytes).first(20)).has_value());
  auto r = p.feed(Bytes(bytes).subspan(20));
  EXPECT_TRUE(r.has_value());
  EXPECT_NEAR(r->battery_v, 12.5, 1e-4);
  EXPECT_NEAR(r->charge_a, 1.0, 1e-4);
  EXPECT_NEAR(r->solar_v, 18, 1e-4);
  EXPECT_NEAR(r->solar_w, 18, 1e-4);
  EXPECT_EQ(r->charge_state, 2);
}

TEST(gopower_ignores_implausible_frames) {
  gopower::Parser p;
  EXPECT_TRUE(!p.feed(ascii("50;00;00;01;00;00;00;00;00;64;00;00;00;12;02;00;")).has_value());
}

// ---- Driver ----

TEST(gopower_driver_is_a_solar_controller) {
  auto d = testing::make("gopower_pwm");
  Handler *h = d->driver->handler();
  testing::FakeSession io;
  std::deque<Command> commands;
  h->begin(*d, io, commands, true);
  EXPECT_EQ(io.written.at(0), hex("01 03 01 00 00 21 84 2e"));
  h->data(*d, io, ascii("50;00;00;7D;00;00;00;00;00;64;00;00;00;12;02;00\r\n"), commands);
  EXPECT_TRUE(io.finished);
  EXPECT_EQ(std::string(json_string(testing::json(*d).get(), "class")), "solar_controller");
  EXPECT_NEAR(testing::number(*d, "battery_v"), 12.5, 1e-4);
  EXPECT_NEAR(testing::number(*d, "solar_w"), 18, 1e-4);
}
