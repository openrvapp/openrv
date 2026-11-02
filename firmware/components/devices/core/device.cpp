// Devices in protocol terms (protocol/schema.json): the parts that are the same for every model.
// What differs per model comes from its driver.
#include "openrv/device.h"

#include <cstdio>
#include <cstring>

namespace openrv {

namespace {

constexpr const char *LINK_NAMES[] = {"advert", "connected", "idle", "connecting", "unreachable", "error"};
/// A device not heard for this long shows as offline.
constexpr int64_t OFFLINE_AFTER_US = 10LL * 60 * 1000 * 1000;

}  // namespace

std::string mac_to_string(const Mac &m) {
  char s[18];
  std::snprintf(s, sizeof s, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
  return s;
}

bool parse_mac(const char *text, Mac &out) {
  unsigned b[6];
  if (!text || std::sscanf(text, "%2x:%2x:%2x:%2x:%2x:%2x", &b[0], &b[1], &b[2], &b[3], &b[4], &b[5]) != 6 ||
      std::strlen(text) != 17)
    return false;
  for (int i = 0; i < 6; i++)
    out[i] = static_cast<uint8_t>(b[i]);
  return true;
}

const DriverInfo *find_driver(const char *type) {
  if (!type)
    return nullptr;
  for (const DriverInfo *info : drivers())
    if (!std::strcmp(type, info->type))
      return info;
  return nullptr;
}

const DriverInfo *guess_driver(const Advert &ad, const Mac &mac) {
  for (const DriverInfo *info : drivers())
    if (info->looks_like && info->looks_like(ad, mac))
      return info;
  return nullptr;
}

std::unique_ptr<Device> make_device(const DriverInfo &info, std::string id, std::string name, const Mac &mac) {
  auto d = std::make_unique<Device>();
  d->id = std::move(id);
  d->name = std::move(name);
  d->info = &info;
  d->driver = info.create();
  d->mac = mac;
  d->settings = json_object();
  d->driver->default_settings(d->settings.get());
  d->link = info.transport == Transport::ADVERT ? Link::ADVERT : Link::IDLE;
  return d;
}

Json public_settings(const Device &d) {
  Json s = json_object();
  const cJSON *item;
  cJSON_ArrayForEach(item, d.settings.get()) {
    if (!d.driver->secret_setting(item->string))
      cJSON_AddItemToObject(s.get(), item->string, cJSON_Duplicate(item, true));
  }
  return s;
}

Json device_config_json(const Device &d) {
  Json j = json_object();
  cJSON_AddStringToObject(j.get(), "id", d.id.c_str());
  cJSON_AddStringToObject(j.get(), "type", d.info->type);
  cJSON_AddStringToObject(j.get(), "name", d.name.c_str());
  cJSON_AddStringToObject(j.get(), "mac", mac_to_string(d.mac).c_str());
  cJSON_AddItemToObject(j.get(), "settings", cJSON_Duplicate(d.settings.get(), true));
  return j;
}

Json device_json(const Device &d, int64_t now_us) {
  Json j = device_config_json(d);
  cJSON_AddStringToObject(j.get(), "class", class_name(d.info->device_class));
  cJSON_AddStringToObject(j.get(), "model", d.info->model);
  cJSON *traits = cJSON_CreateObject();
  d.driver->traits(traits);
  if (cJSON_GetArraySize(traits))
    cJSON_AddItemToObject(j.get(), "traits", traits);
  else
    cJSON_Delete(traits);
  cJSON_ReplaceItemInObjectCaseSensitive(j.get(), "settings", public_settings(d).release());
  Controls setting_defs(cJSON_AddArrayToObject(j.get(), "setting_defs"));
  d.driver->setting_defs(d, setting_defs);

  cJSON *status = cJSON_AddObjectToObject(j.get(), "status");
  bool heard = d.heard_us != 0;
  int64_t age_s = heard ? (now_us - d.heard_us) / 1000000 : 0;
  bool online = d.link == Link::CONNECTED || (heard && now_us - d.heard_us < OFFLINE_AFTER_US &&
                                               d.link != Link::UNREACHABLE && d.link != Link::ERROR);
  cJSON_AddBoolToObject(status, "online", online);
  if (d.rssi)
    cJSON_AddNumberToObject(status, "rssi", d.rssi);
  if (heard)
    cJSON_AddNumberToObject(status, "age_s", static_cast<double>(age_s));
  else
    cJSON_AddNullToObject(status, "age_s");
  cJSON_AddStringToObject(status, "link", LINK_NAMES[static_cast<int>(d.link)]);
  if (d.busy)
    cJSON_AddTrueToObject(status, "busy");

  Values values(cJSON_AddArrayToObject(j.get(), "values"));
  d.driver->values(d, values);
  Controls controls(cJSON_AddArrayToObject(j.get(), "controls"));
  d.driver->controls(d, controls);
  return j;
}

std::optional<float> device_value(const Device &d, const std::string &key) {
  Json arr(cJSON_CreateArray());
  Values values(arr.get());
  d.driver->values(d, values);
  const cJSON *v;
  cJSON_ArrayForEach(v, arr.get()) {
    const char *k = json_string(v, "key");
    const cJSON *value = cJSON_GetObjectItem(v, "value");
    if (k && key == k && cJSON_IsNumber(value))
      return static_cast<float>(value->valuedouble);
  }
  return std::nullopt;
}

bool apply_settings(Device &d, const cJSON *patch) {
  if (!cJSON_IsObject(patch))
    return false;
  const cJSON *item;
  cJSON_ArrayForEach(item, patch) {
    if (!d.driver->valid_setting(item->string, item))
      return false;
  }
  cJSON_ArrayForEach(item, patch) {
    cJSON_DeleteItemFromObjectCaseSensitive(d.settings.get(), item->string);
    cJSON_AddItemToObject(d.settings.get(), item->string, cJSON_Duplicate(item, true));
  }
  return true;
}

Json models_json() {
  Json arr(cJSON_CreateArray());
  for (const DriverInfo *info : drivers()) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", info->type);
    cJSON_AddStringToObject(m, "model", info->model);
    cJSON_AddStringToObject(m, "class", class_name(info->device_class));
    cJSON_AddItemToArray(arr.get(), m);
  }
  return arr;
}

}  // namespace openrv
