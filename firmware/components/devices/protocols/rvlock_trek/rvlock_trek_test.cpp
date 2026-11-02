// Host tests: RVLock Trek, frames from the 2026-10-16 capture. Run with firmware/test/host (see its CMakeLists.txt).
#include <cmath>
#include <string>

#include "rvlock_trek.h"
#include "device_testing.h"

using namespace openrv;
using testing::hex;

// ---- Decoder ----

TEST(rvlock_action_frames_match_capture) {
  EXPECT_EQ(rvlock::build_action(rvlock::Action::LOCK), hex("7E 06 01 03 03 00 00 8B"));
  EXPECT_EQ(rvlock::build_action(rvlock::Action::UNLOCK), hex("7E 06 01 03 03 01 00 8C"));
}

TEST(rvlock_decodes_echoed_action) {
  EXPECT_TRUE(rvlock::decode_action(hex("7E 06 01 03 03 01 00 8C")) == rvlock::Action::UNLOCK);
  EXPECT_TRUE(!rvlock::decode_action(hex("7E 05 01 21 03 00 A8")).has_value());
}

TEST(rvlock_recognizes_auth_reply_and_password) {
  EXPECT_TRUE(rvlock::is_frame(hex("7E 05 01 21 03 00 A8")));
  EXPECT_TRUE(rvlock::valid_password(hex("7E 08 01 21 A1 B2 C3 D4 01 45")));
  EXPECT_TRUE(!rvlock::valid_password(hex("7E 09 01 21")));
}

// ---- Driver ----

static constexpr const char *PASSWORD = "7E 08 01 21 A1 B2 C3 D4 01 45";

static void store_password(Device &d, const char *extra = "") {
  std::string patch = std::string(R"({"password": ")") + PASSWORD + "\"" + extra + "}";
  EXPECT_TRUE(testing::settings(d, patch.c_str()));
}

TEST(rvlock_driver_needs_a_password_before_it_runs_commands) {
  auto d = testing::make("rvlock_trek");
  Handler *h = d->driver->handler();
  EXPECT_TRUE(h != nullptr);
  EXPECT_EQ(std::string(h->validate(*d, testing::command("lock"))), "refused");
  EXPECT_TRUE(testing::settings(*d, R"({"password": "7E:08:01:21:A1:B2:C3:D4:01:45"})"));
  EXPECT_TRUE(h->validate(*d, testing::command("lock")) == nullptr);
  EXPECT_TRUE(!testing::settings(*d, R"({"password": "12 34"})"));
}

TEST(rvlock_driver_keeps_the_password_from_phones) {
  auto d = testing::make("rvlock_trek");
  store_password(*d);
  auto j = testing::json(*d);
  EXPECT_TRUE(cJSON_GetObjectItem(cJSON_GetObjectItem(j.get(), "settings"), "password") == nullptr);
  EXPECT_EQ(std::string(json_string(testing::item(*d, "setting_defs", "password"), "placeholder")), "Stored");
}

TEST(rvlock_driver_unlock_pin_follows_the_setting) {
  auto d = testing::make("rvlock_trek");
  EXPECT_TRUE(d->driver->action_needs_pin(*d, "unlock"));
  EXPECT_TRUE(!d->driver->action_needs_pin(*d, "lock"));
  EXPECT_TRUE(cJSON_GetObjectItem(testing::item(*d, "controls", "lock"), "pin") != nullptr);
  testing::settings(*d, R"({"unlock_pin": false})");
  EXPECT_TRUE(!d->driver->action_needs_pin(*d, "unlock"));
  EXPECT_TRUE(cJSON_GetObjectItem(testing::item(*d, "controls", "lock"), "pin") == nullptr);
}

TEST(rvlock_driver_session_sends_password_then_command) {
  auto d = testing::make("rvlock_trek");
  store_password(*d);
  Handler *h = d->driver->handler();
  testing::FakeSession io;
  std::deque<Command> commands;
  commands.push_back(testing::command("unlock"));
  h->begin(*d, io, commands, false);
  EXPECT_EQ(io.written.at(0), hex(PASSWORD));
  h->data(*d, io, hex("7E 05 01 21 03 00 A8"), commands);  // the lock answers the password
  EXPECT_EQ(io.written.at(1), rvlock::build_action(rvlock::Action::UNLOCK));
  h->data(*d, io, hex("7E 06 01 03 03 01 00 8C"), commands);  // and echoes the unlock
  EXPECT_TRUE(io.finished);
  EXPECT_EQ(std::string(json_string(testing::item(*d, "values", "last_action"), "value")), "unlock");
}

TEST(rvlock_driver_lock_only_refuses_unlock) {
  auto d = testing::make("rvlock_trek");
  store_password(*d, R"(, "lock_only": true)");
  EXPECT_EQ(std::string(d->driver->handler()->validate(*d, testing::command("unlock"))), "refused");
}
