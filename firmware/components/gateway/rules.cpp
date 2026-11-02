#include "openrv/rules.h"

#include <cstring>

namespace openrv {

namespace {

constexpr const char *SEVERITIES[] = {"info", "warning", "critical"};
constexpr const char *STATES[] = {"normal", "low", "high"};
constexpr size_t MAX_ID = 24;
constexpr size_t MAX_LABEL = 24;

bool slug(const char *s) {
  if (!s || !*s || std::strlen(s) > MAX_ID)
    return false;
  for (const char *p = s; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-'))
      return false;
  return true;
}

/// A number, or nullopt for null/absent; false when present but not a number.
bool optional_number(const cJSON *j, const char *key, std::optional<float> &out) {
  const cJSON *v = cJSON_GetObjectItemCaseSensitive(j, key);
  if (!v || cJSON_IsNull(v)) {
    out.reset();
    return true;
  }
  if (!cJSON_IsNumber(v))
    return false;
  out = static_cast<float>(v->valuedouble);
  return true;
}

AlarmState target(const Rule &r, AlarmState current, float v) {
  // Stay in an alarm until the value is back past the threshold by the hysteresis.
  if (current == AlarmState::LOW && r.below && v < *r.below + r.hysteresis)
    return AlarmState::LOW;
  if (current == AlarmState::HIGH && r.above && v > *r.above - r.hysteresis)
    return AlarmState::HIGH;
  if (r.below && v < *r.below)
    return AlarmState::LOW;
  if (r.above && v > *r.above)
    return AlarmState::HIGH;
  return AlarmState::NORMAL;
}

}  // namespace

const char *severity_name(Severity s) { return SEVERITIES[static_cast<int>(s)]; }

std::optional<Rule> parse_rule(const cJSON *j) {
  Rule r;
  const char *id = json_string(j, "id"), *device = json_string(j, "device"), *value = json_string(j, "value"),
             *label = json_string(j, "label"), *severity = json_string(j, "severity");
  if (!slug(id) || !slug(device) || !value || !label || !*label || std::strlen(label) > MAX_LABEL || !severity)
    return std::nullopt;
  r.id = id;
  r.device = device;
  r.value = value;
  r.label = label;
  bool found = false;
  for (size_t i = 0; i < std::size(SEVERITIES); i++)
    if (!std::strcmp(severity, SEVERITIES[i])) {
      r.severity = static_cast<Severity>(i);
      found = true;
    }
  if (!found || !optional_number(j, "below", r.below) || !optional_number(j, "above", r.above) || (!r.below && !r.above))
    return std::nullopt;
  if (r.below && r.above && *r.below >= *r.above)
    return std::nullopt;

  const cJSON *h = cJSON_GetObjectItemCaseSensitive(j, "hysteresis");
  const cJSON *hold = cJSON_GetObjectItemCaseSensitive(j, "hold_s");
  const cJSON *enabled = cJSON_GetObjectItemCaseSensitive(j, "enabled");
  if (cJSON_IsNumber(h) && h->valuedouble >= 0)
    r.hysteresis = static_cast<float>(h->valuedouble);
  if (cJSON_IsNumber(hold) && hold->valuedouble >= 0 && hold->valuedouble <= 3600)
    r.hold_s = static_cast<uint32_t>(hold->valuedouble);
  if (cJSON_IsBool(enabled))
    r.enabled = cJSON_IsTrue(enabled);
  return r;
}

Json rule_json(const Rule &r) {
  Json j = json_object();
  cJSON_AddStringToObject(j.get(), "id", r.id.c_str());
  cJSON_AddStringToObject(j.get(), "device", r.device.c_str());
  cJSON_AddStringToObject(j.get(), "value", r.value.c_str());
  json_number_or_null(j.get(), "below", r.below ? &*r.below : nullptr);
  json_number_or_null(j.get(), "above", r.above ? &*r.above : nullptr);
  cJSON_AddNumberToObject(j.get(), "hysteresis", r.hysteresis);
  cJSON_AddNumberToObject(j.get(), "hold_s", r.hold_s);
  cJSON_AddStringToObject(j.get(), "label", r.label.c_str());
  cJSON_AddStringToObject(j.get(), "severity", severity_name(r.severity));
  cJSON_AddBoolToObject(j.get(), "enabled", r.enabled);
  return j;
}

bool evaluate(const Rule &r, RuleStatus &s, float value, int64_t now_us) {
  s.value = value;
  AlarmState t = r.enabled ? target(r, s.state, value) : AlarmState::NORMAL;
  if (t == s.state) {
    s.pending = t;
    return false;
  }
  if (t != s.pending) {
    s.pending = t;
    s.pending_since_us = now_us;
  }
  // A disabled rule clears at once; otherwise the new state has to hold.
  if (r.enabled && now_us - s.pending_since_us < static_cast<int64_t>(r.hold_s) * 1000000)
    return false;
  s.state = t;
  s.since_us = now_us;
  return true;
}

Json alarm_json(const Rule &r, const RuleStatus &s, int64_t now_us) {
  Json j = json_object();
  cJSON_AddStringToObject(j.get(), "rule", r.id.c_str());
  cJSON_AddStringToObject(j.get(), "device", r.device.c_str());
  cJSON_AddStringToObject(j.get(), "key", r.value.c_str());
  cJSON_AddStringToObject(j.get(), "state", STATES[static_cast<int>(s.state)]);
  cJSON_AddStringToObject(j.get(), "severity", severity_name(r.severity));
  cJSON_AddStringToObject(j.get(), "label", r.label.c_str());
  json_number_or_null(j.get(), "value", s.value ? &*s.value : nullptr);
  cJSON_AddNumberToObject(j.get(), "since_s", static_cast<double>((now_us - s.since_us) / 1000000));
  return j;
}

}  // namespace openrv
