// The helpers drivers build their protocol output with (driver.h).
#include "openrv/driver.h"

#include "openrv/device.h"

namespace openrv {

namespace {

constexpr const char *CLASS_NAMES[] = {
    "temperature_sensor", "liquid_level_sensor", "battery_monitor", "solar_controller",
    "refrigerator",       "lock",                "surge_protector",
};

void add_strings(cJSON *obj, const char *key, std::initializer_list<const char *> items) {
  cJSON *a = cJSON_AddArrayToObject(obj, key);
  for (const char *s : items)
    cJSON_AddItemToArray(a, cJSON_CreateString(s));
}

}  // namespace

const char *class_name(DeviceClass c) { return CLASS_NAMES[static_cast<int>(c)]; }

// ---- Values ----

cJSON *Values::add_(const char *key, const char *label) {
  last_ = cJSON_CreateObject();
  cJSON_AddStringToObject(last_, "key", key);
  cJSON_AddStringToObject(last_, "label", label);
  cJSON_AddItemToArray(array_, last_);
  return last_;
}

Values &Values::number(const char *key, const char *label, const char *unit, std::optional<float> value, int decimals) {
  cJSON *v = add_(key, label);
  if (unit)
    cJSON_AddStringToObject(v, "unit", unit);
  cJSON_AddNumberToObject(v, "decimals", decimals);
  json_number_or_null(v, "value", value ? &*value : nullptr);
  return *this;
}

Values &Values::choice(const char *key, const char *label, const char *value, std::initializer_list<const char *> options) {
  cJSON *v = add_(key, label);
  if (value)
    cJSON_AddStringToObject(v, "value", value);
  else
    cJSON_AddNullToObject(v, "value");
  add_strings(v, "enum", options);
  return *this;
}

Values &Values::text(const char *key, const char *label, const char *value) {
  cJSON *v = add_(key, label);
  if (value)
    cJSON_AddStringToObject(v, "value", value);
  else
    cJSON_AddNullToObject(v, "value");
  return *this;
}

Values &Values::primary() {
  if (last_)
    cJSON_AddTrueToObject(last_, "primary");
  return *this;
}

Values &Values::range(float min, float max) {
  if (last_) {
    cJSON_AddNumberToObject(last_, "min", min);
    cJSON_AddNumberToObject(last_, "max", max);
  }
  return *this;
}

// ---- Controls ----

cJSON *Controls::add_(const char *key, const char *label, const char *kind) {
  last_ = cJSON_CreateObject();
  cJSON_AddStringToObject(last_, "key", key);
  cJSON_AddStringToObject(last_, "label", label);
  cJSON_AddStringToObject(last_, "kind", kind);
  cJSON_AddItemToArray(array_, last_);
  return last_;
}

Controls &Controls::toggle(const char *key, const char *label, bool value) {
  cJSON_AddBoolToObject(add_(key, label, "toggle"), "value", value);
  return *this;
}

Controls &Controls::number(const char *key, const char *label, const char *unit, double min, double max, double step,
                           double value) {
  cJSON *c = add_(key, label, "number");
  if (unit)
    cJSON_AddStringToObject(c, "unit", unit);
  cJSON_AddNumberToObject(c, "min", min);
  cJSON_AddNumberToObject(c, "max", max);
  cJSON_AddNumberToObject(c, "step", step);
  cJSON_AddNumberToObject(c, "value", value);
  return *this;
}

Controls &Controls::choice(const char *key, const char *label, const char *value, std::initializer_list<const char *> options,
                           std::initializer_list<const char *> labels) {
  cJSON *c = add_(key, label, "choice");
  cJSON_AddStringToObject(c, "value", value);
  add_strings(c, "options", options);
  if (labels.size())
    add_strings(c, "labels", labels);
  return *this;
}

Controls &Controls::option(const char *id, const char *label) {
  if (!last_)
    return *this;
  cJSON *options = cJSON_GetObjectItem(last_, "options");
  cJSON *labels = cJSON_GetObjectItem(last_, "labels");
  if (label && !labels) {
    // Earlier options had no labels: they show as their ids.
    labels = cJSON_AddArrayToObject(last_, "labels");
    cJSON *o;
    cJSON_ArrayForEach(o, options) cJSON_AddItemToArray(labels, cJSON_CreateString(o->valuestring));
  }
  cJSON_AddItemToArray(options, cJSON_CreateString(id));
  if (labels)
    cJSON_AddItemToArray(labels, cJSON_CreateString(label ? label : id));
  return *this;
}

Controls &Controls::text(const char *key, const char *label, const char *value, bool secret, const char *placeholder) {
  cJSON *c = add_(key, label, "text");
  cJSON_AddStringToObject(c, "value", secret ? "" : (value ? value : ""));
  if (secret)
    cJSON_AddTrueToObject(c, "secret");
  if (placeholder)
    cJSON_AddStringToObject(c, "placeholder", placeholder);
  return *this;
}

Controls &Controls::action(const char *key, const char *label, std::initializer_list<const char *> actions,
                           std::initializer_list<const char *> pin) {
  cJSON *c = add_(key, label, "action");
  add_strings(c, "actions", actions);
  if (pin.size())
    add_strings(c, "pin", pin);
  return *this;
}

// ---- Settings ----

bool setting_bool(const Device &d, const char *key, bool fallback) {
  const cJSON *v = cJSON_GetObjectItemCaseSensitive(d.settings.get(), key);
  return cJSON_IsBool(v) ? cJSON_IsTrue(v) : fallback;
}

double setting_number(const Device &d, const char *key, double fallback) {
  const cJSON *v = cJSON_GetObjectItemCaseSensitive(d.settings.get(), key);
  return cJSON_IsNumber(v) ? v->valuedouble : fallback;
}

const char *setting_string(const Device &d, const char *key) { return json_string(d.settings.get(), key); }

}  // namespace openrv
