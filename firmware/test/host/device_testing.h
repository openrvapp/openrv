// Helpers for testing a driver end to end on a PC: make a device of a model, feed it adverts or
// session data, and read back the values and controls phones would get.
#pragma once

#include <deque>
#include <string>
#include <vector>

#include "openrv/device.h"
#include "testing.h"

namespace testing {

/// A device of a registered model, with its default settings.
inline std::unique_ptr<openrv::Device> make(const char *type) {
  const openrv::DriverInfo *info = openrv::find_driver(type);
  if (!info) {
    std::printf("  no driver registered for %s\n", type);
    std::abort();
  }
  return openrv::make_device(*info, "test", "Test", {1, 2, 3, 4, 5, 6});
}

/// Feeds an advertisement (hex) to an advert device; true when it decoded a reading.
inline bool advert(openrv::Device &d, std::string_view ad_hex) {
  auto raw = hex(ad_hex);
  return d.driver->on_advert(d, openrv::Advert(raw));
}

/// The device as phones see it.
inline openrv::Json json(const openrv::Device &d) { return openrv::device_json(d, 0); }

/// An entry of the device's "values", "controls" or "setting_defs" by key, or nullptr.
inline const cJSON *item(const openrv::Device &d, const char *array, const char *key) {
  static openrv::Json last;
  last = json(d);
  const cJSON *v;
  cJSON_ArrayForEach(v, cJSON_GetObjectItem(last.get(), array)) {
    if (const char *k = openrv::json_string(v, "key"); k && std::string_view(k) == key)
      return v;
  }
  return nullptr;
}

/// A value's number; NaN when missing or null.
inline double number(const openrv::Device &d, const char *key) {
  const cJSON *v = item(d, "values", key);
  const cJSON *n = v ? cJSON_GetObjectItem(v, "value") : nullptr;
  return cJSON_IsNumber(n) ? n->valuedouble : std::nan("");
}

/// Applies a settings patch given as JSON text.
inline bool settings(openrv::Device &d, const char *patch) {
  openrv::Json p = openrv::json_parse(patch);
  return openrv::apply_settings(d, p.get());
}

/// A command as a phone sends it, e.g. command("set", R"({"target": 3})").
inline openrv::Command command(const char *action, const char *values = "{}") {
  return {action, openrv::json_parse(values)};
}

/// Plays the radio side of a connected device's session.
class FakeSession : public openrv::SessionIo {
 public:
  void write(openrv::Bytes data) override { written.emplace_back(data.begin(), data.end()); }
  void updated() override { updates++; }
  void done() override { finished = true; }
  int64_t now_us() override { return now; }

  std::vector<std::vector<uint8_t>> written;
  int updates = 0;
  bool finished = false;
  int64_t now = 0;
};

}  // namespace testing
