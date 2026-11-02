#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>

#include "openrv/driver.h"
#include "openrv/json.h"

namespace openrv {

std::string mac_to_string(const Mac &mac);
bool parse_mac(const char *text, Mac &out);

enum class Link : uint8_t { ADVERT, CONNECTED, IDLE, CONNECTING, UNREACHABLE, ERROR };

/// A configured device: what the gateway stores, plus its driver with the latest reading.
struct Device {
  std::string id;  // stable slug chosen when added
  std::string name;
  const DriverInfo *info = nullptr;
  std::unique_ptr<Driver> driver;
  Mac mac{};
  Json settings;  // object; see the driver's setting_defs

  Link link = Link::ADVERT;
  int8_t rssi = 0;
  int64_t heard_us = 0;  // 0 = never
  int64_t sent_us = 0;   // last time a device event went to phones
  bool busy = false;     // a connected device has commands waiting or in flight
};

/// The supported models, in discovery order (protocols/registry.cpp).
std::span<const DriverInfo *const> drivers();
const DriverInfo *find_driver(const char *type);
/// The model an advert comes from, for discovery; nullptr when none recognizes it.
const DriverInfo *guess_driver(const Advert &ad, const Mac &mac);

/// A new device of a model, with its default settings and an empty reading.
std::unique_ptr<Device> make_device(const DriverInfo &info, std::string id, std::string name, const Mac &mac);

/// The full device object for the protocol (schema.json #/$defs/device).
Json device_json(const Device &d, int64_t now_us);
/// The stored form: id, name, type, mac, settings (secrets included).
Json device_config_json(const Device &d);
/// Settings as phones see them: secrets removed.
Json public_settings(const Device &d);
/// A numeric value by key (as in the device's "values"), or nullopt when unknown or not a number.
std::optional<float> device_value(const Device &d, const std::string &key);
/// Validates and merges a settings patch; false (and no change) when any field is invalid.
bool apply_settings(Device &d, const cJSON *patch);
/// The supported models, for phones choosing one by hand (schema.json #/$defs/model).
Json models_json();

}  // namespace openrv
