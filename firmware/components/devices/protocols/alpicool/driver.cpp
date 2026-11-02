// Alpicool-protocol coolers (Alpicool, Renogy, Brass Monkey and others), as refrigerators.
//
// Each session queries the status, applies waiting commands as one full settings write each, and
// on scheduled sessions only, corrects power and panel lock (Keep On, Auto-Lock). A change made from
// a phone therefore stays until the next scheduled check.
#include <cstring>

#include "alpicool.h"
#include "esp_log.h"
#include "openrv/device.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

const char *const TAG = "alpicool";

class AlpicoolCooler : public Refrigerator {
 public:
  // ---- settings ----

  void default_settings(cJSON *out) const override {
    cJSON_AddNumberToObject(out, "check_min", 10);
    cJSON_AddTrueToObject(out, "keep_on");
    cJSON_AddTrueToObject(out, "auto_lock");
  }

  void setting_defs(const Device &d, Controls &out) const override {
    out.number("check_min", "Check every (minutes)", nullptr, 1, 60, 1, setting_number(d, "check_min", 10));
    out.toggle("keep_on", "Keep on: turn it back on if found off", setting_bool(d, "keep_on"));
    out.toggle("auto_lock", "Auto-lock the panel", setting_bool(d, "auto_lock"));
  }

  bool valid_setting(const char *key, const cJSON *v) const override {
    if (!std::strcmp(key, "check_min"))
      return cJSON_IsNumber(v) && v->valuedouble >= 1 && v->valuedouble <= 60;
    return (!std::strcmp(key, "keep_on") || !std::strcmp(key, "auto_lock")) && cJSON_IsBool(v);
  }

  // ---- session ----

  LinkSpec spec(const Device &d) const override {
    return {d.mac, alpicool::SERVICE_UUID16, alpicool::WRITE_UUID16, alpicool::NOTIFY_UUID16};
  }

  uint32_t interval_s(const Device &d) const override {
    return static_cast<uint32_t>(setting_number(d, "check_min", 10) * 60);
  }

  void begin(Device &, SessionIo &io, std::deque<Command> &, bool scheduled) override {
    frames_.reset();
    may_enforce_ = scheduled;
    enforced_ = false;
    query(io);
  }

  void data(Device &d, SessionIo &io, Bytes bytes, std::deque<Command> &commands) override {
    for (auto &f : frames_.feed(bytes)) {
      auto status = (f.command == alpicool::CMD_QUERY || f.command == alpicool::CMD_SET || f.command == alpicool::CMD_RESET)
                        ? alpicool::decode_status(f.data)
                        : std::nullopt;
      if (!status) {
        query_at_us_ = io.now_us() + 300 * 1000;  // some other reply: ask for the status it led to
        continue;
      }
      query_at_us_ = 0;
      status_ = *status;
      set_state(fridge_state(*status));
      io.updated();
      next_step(d, io, commands);
    }
  }

  void poll(Device &, SessionIo &io, std::deque<Command> &) override {
    if (query_at_us_ && io.now_us() >= query_at_us_)
      query(io);
  }

 private:
  /// The cooler works in its own unit; the class wants Celsius.
  static FridgeState fridge_state(const alpicool::Status &s) {
    auto c = [&s](float t) { return alpicool::to_celsius(s, t); };
    FridgeState f{
        .left = {c(s.left.current), c(s.left.target)},
        .right = std::nullopt,
        .min_c = c(s.min_temp),
        .max_c = c(s.max_temp),
        .step_c = s.unit == alpicool::Unit::F ? 5.0f / 9 : 1.0f,
        .decimals = s.unit == alpicool::Unit::F ? 1 : 0,  // whole °F need a decimal in °C
        .powered_on = s.powered_on,
        .eco = s.run_mode == alpicool::RunMode::ECO,
        .panel_locked = s.locked,
        .supply_v = s.battery_v,
        .battery_pct = s.battery_pct ? std::optional<float>(*s.battery_pct) : std::nullopt,
    };
    if (s.right)
      f.right = FridgeZone{c(s.right->current), c(s.right->target)};
    return f;
  }

  void query(SessionIo &io) {
    auto q = alpicool::build_query();
    io.write(q);
    query_at_us_ = io.now_us() + 1500 * 1000;  // asks again if the cooler doesn't answer
  }

  void write_settings(SessionIo &io, const alpicool::Status &s) {
    auto frame = alpicool::build_set(s);
    io.write(frame);
    query_at_us_ = io.now_us() + 1000 * 1000;  // most coolers answer a set with their status; if not, ask
  }

  void next_step(Device &d, SessionIo &io, std::deque<Command> &commands) {
    alpicool::Status s = status_;
    if (!commands.empty()) {
      FridgeChange c = change_from(commands.front());
      if (c.powered_on)
        s.powered_on = *c.powered_on;
      if (c.panel_locked)
        s.locked = *c.panel_locked;
      if (c.eco)
        s.run_mode = *c.eco ? alpicool::RunMode::ECO : alpicool::RunMode::MAX;
      if (c.left_target_c)
        s.left.target = alpicool::from_celsius(s, *c.left_target_c);
      if (c.right_target_c && s.right)
        s.right->target = alpicool::from_celsius(s, *c.right_target_c);
      commands.pop_front();
      may_enforce_ = false;  // someone changed it on purpose
      write_settings(io, s);
      return;
    }
    if (may_enforce_ && !enforced_) {
      bool keep_on = setting_bool(d, "keep_on") && !s.powered_on;
      bool auto_lock = setting_bool(d, "auto_lock") && !s.locked;
      if (keep_on || auto_lock) {
        ESP_LOGI(TAG, "%s: %s", d.id.c_str(), keep_on && auto_lock ? "turning on and locking" : keep_on ? "turning on" : "locking");
        s.powered_on = s.powered_on || keep_on;
        s.locked = s.locked || auto_lock;
        enforced_ = true;  // once per session, so a cooler that refuses can't loop
        write_settings(io, s);
        return;
      }
    }
    io.done();
  }

  alpicool::Status status_{};
  alpicool::Assembler frames_;
  bool may_enforce_ = false;
  bool enforced_ = false;
  int64_t query_at_us_ = 0;
};

}  // namespace

extern const DriverInfo ALPICOOL_COOLER = {
    .type = "alpicool_cooler",
    .model = "Alpicool-protocol cooler",
    .device_class = DeviceClass::REFRIGERATOR,
    .transport = Transport::CONNECTED,
    .looks_like = [](const Advert &ad, const Mac &mac) { return alpicool::looks_like(ad, mac.data()); },
    .create = []() -> std::unique_ptr<Driver> { return std::make_unique<AlpicoolCooler>(); },
};

}  // namespace openrv
