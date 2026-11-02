// RVLock Trek keyless entry locks (docs/devices/rvlock-trek.md).
//
// Command-only: each session sends the captured password, waits for the lock to answer it (or
// 2 s), then sends the waiting lock/unlock commands and reads their echoes.
#include <cstdio>
#include <cstring>
#include <vector>

#include "openrv/device.h"
#include "openrv/device_classes.h"
#include "rvlock_trek.h"

namespace openrv {

namespace {

/// The stored password: hex bytes, optionally separated by spaces, colons or dashes. Empty when
/// unset or malformed.
std::vector<uint8_t> parse_password(const char *s) {
  std::vector<uint8_t> out;
  for (const char *p = s ? s : ""; *p;) {
    unsigned v;
    if (*p == ' ' || *p == ':' || *p == '-') {
      p++;
    } else if (out.size() < rvlock::MAX_PASSWORD_LEN && std::sscanf(p, "%2x", &v) == 1 && p[1]) {
      out.push_back(static_cast<uint8_t>(v));
      p += 2;
    } else {
      return {};
    }
  }
  return out;
}

class RvlockTrek : public Lock {
 public:
  // ---- settings: the lock's password on top of the standard lock settings ----

  void setting_defs(const Device &d, Controls &out) const override {
    // Write-only: phones only learn whether a password is stored.
    out.text("password", "Lock password (hex, from the RVLock app capture)", nullptr, true,
             setting_string(d, "password") ? "Stored" : "Not set");
    Lock::setting_defs(d, out);
  }

  bool valid_setting(const char *key, const cJSON *v) const override {
    if (!std::strcmp(key, "password"))
      return cJSON_IsString(v) && rvlock::valid_password(parse_password(v->valuestring));
    return Lock::valid_setting(key, v);
  }

  bool secret_setting(const char *key) const override { return !std::strcmp(key, "password"); }

  // ---- session ----

  LinkSpec spec(const Device &d) const override {
    return {d.mac, rvlock::SERVICE_UUID16, rvlock::WRITE_UUID16, rvlock::NOTIFY_UUID16};
  }

  uint32_t interval_s(const Device &) const override { return 0; }

  void begin(Device &d, SessionIo &io, std::deque<Command> &, bool) override {
    authed_ = false;
    auth_deadline_us_ = io.now_us() + 2000 * 1000;
    auto pw = parse_password(setting_string(d, "password"));
    io.write(pw);
  }

  void data(Device &, SessionIo &io, Bytes bytes, std::deque<Command> &commands) override {
    if (auto action = rvlock::decode_action(bytes)) {
      set_last_action(*action == rvlock::Action::LOCK ? LockAction::LOCK : LockAction::UNLOCK);
      io.updated();
      if (!commands.empty())
        commands.pop_front();
      send_next(io, commands);
    } else if (!authed_ && rvlock::is_frame(bytes)) {
      authed_ = true;
      send_next(io, commands);
    }
  }

  void poll(Device &, SessionIo &io, std::deque<Command> &commands) override {
    if (!authed_ && io.now_us() >= auth_deadline_us_) {
      authed_ = true;  // some locks don't answer the password; go ahead anyway
      send_next(io, commands);
    }
  }

 protected:
  const char *ready(const Device &d) const override {
    return parse_password(setting_string(d, "password")).empty() ? "refused" : nullptr;  // no password stored yet
  }

 private:
  void send_next(SessionIo &io, std::deque<Command> &commands) {
    if (commands.empty()) {
      io.done();
      return;
    }
    auto frame = rvlock::build_action(commands.front().action == "lock" ? rvlock::Action::LOCK : rvlock::Action::UNLOCK);
    io.write(frame);
  }

  bool authed_ = false;
  int64_t auth_deadline_us_ = 0;
};

}  // namespace

extern const DriverInfo RVLOCK_TREK = {
    .type = "rvlock_trek",
    .model = "RVLock Trek",
    .device_class = DeviceClass::LOCK,
    .transport = Transport::CONNECTED,
    .looks_like = nullptr,  // its adverts carry nothing to tell it by; added by hand
    .create = []() -> std::unique_ptr<Driver> { return std::make_unique<RvlockTrek>(); },
};

}  // namespace openrv
