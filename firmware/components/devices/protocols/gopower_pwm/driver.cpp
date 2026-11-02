// Go Power PWM solar controllers (EXPERIMENTAL): each session sends the poll request and reads
// one reply.
#include <cstring>

#include "gopower_pwm.h"
#include "openrv/device.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

class GoPowerPwm : public SolarController, public Handler {
 public:
  GoPowerPwm() : SolarController({.battery_pct = true, .solar_v = true, .load = false}) {}

  Handler *handler() override { return this; }

  // ---- settings ----

  void default_settings(cJSON *out) const override { cJSON_AddNumberToObject(out, "poll_s", gopower::DEFAULT_POLL_S); }

  void setting_defs(const Device &d, Controls &out) const override {
    out.number("poll_s", "Read every (seconds)", nullptr, 5, 300, 5, setting_number(d, "poll_s", gopower::DEFAULT_POLL_S));
  }

  bool valid_setting(const char *key, const cJSON *v) const override {
    return !std::strcmp(key, "poll_s") && cJSON_IsNumber(v) && v->valuedouble >= 5 && v->valuedouble <= 300;
  }

  // ---- session ----

  LinkSpec spec(const Device &d) const override {
    return {d.mac, gopower::SERVICE_UUID16, gopower::WRITE_UUID16, gopower::NOTIFY_UUID16};
  }

  uint32_t interval_s(const Device &d) const override {
    return static_cast<uint32_t>(setting_number(d, "poll_s", gopower::DEFAULT_POLL_S));
  }

  const char *validate(const Device &, const Command &) const override { return "unsupported"; }

  void begin(Device &, SessionIo &io, std::deque<Command> &, bool) override {
    parser_.reset();
    auto poll = gopower::build_poll(1);
    io.write(poll);
  }

  void data(Device &, SessionIo &io, Bytes bytes, std::deque<Command> &) override {
    if (auto r = parser_.feed(bytes)) {
      set_reading({
          .battery_v = r->battery_v,
          .battery_pct = r->battery_pct,
          .solar_w = r->solar_w,
          .solar_v = r->solar_v,
          .charge_a = r->charge_a,
          .load_a = std::nullopt,
      });
      io.updated();
      io.done();
    }
  }

 private:
  gopower::Parser parser_;
};

}  // namespace

extern const DriverInfo GOPOWER_PWM = {
    .type = "gopower_pwm",
    .model = "Go Power PWM solar controller",
    .device_class = DeviceClass::SOLAR_CONTROLLER,
    .transport = Transport::CONNECTED,
    .looks_like = nullptr,
    .create = []() -> std::unique_ptr<Driver> { return std::make_unique<GoPowerPwm>(); },
};

}  // namespace openrv
