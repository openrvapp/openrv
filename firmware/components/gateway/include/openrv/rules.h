#pragma once

#include <cstdint>
#include <optional>
#include <string>

#include "openrv/json.h"

namespace openrv {

enum class Severity : uint8_t { INFO, WARNING, CRITICAL };
enum class AlarmState : uint8_t { NORMAL, LOW, HIGH };

/// An alert rule on one value of one device (protocol/schema.json #/$defs/rule).
struct Rule {
  std::string id;
  std::string device;
  std::string value;
  std::string label;
  std::optional<float> below;
  std::optional<float> above;
  float hysteresis = 0;
  uint32_t hold_s = 30;
  Severity severity = Severity::WARNING;
  bool enabled = true;
};

struct RuleStatus {
  AlarmState state = AlarmState::NORMAL;
  AlarmState pending = AlarmState::NORMAL;  // where readings point, not yet held long enough
  int64_t pending_since_us = 0;
  int64_t since_us = 0;  // when `state` began
  std::optional<float> value;
};

/// Parses a rule from a request; nullopt when anything is missing or out of range.
std::optional<Rule> parse_rule(const cJSON *j);
Json rule_json(const Rule &r);

/// Feeds one reading. A new state must hold for hold_s before it is taken, so one odd reading
/// neither raises nor clears an alarm; an alarm clears only once the value is back past its
/// threshold by the hysteresis. Returns true when the state changed.
bool evaluate(const Rule &r, RuleStatus &s, float value, int64_t now_us);

/// The alarm as phones see it (schema #/$defs/alarm).
Json alarm_json(const Rule &r, const RuleStatus &s, int64_t now_us);
const char *severity_name(Severity s);

}  // namespace openrv
