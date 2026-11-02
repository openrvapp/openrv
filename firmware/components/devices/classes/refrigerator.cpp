// Refrigerators and coolers: one or two zones, each with its temperature and settable target.
#include <cstring>

#include "openrv/device.h"
#include "openrv/device_classes.h"

namespace openrv {

void Refrigerator::values(const Device &, Values &out) const {
  const FridgeState *s = state_ ? &*state_ : nullptr;
  auto zone = [&](const char *key, const char *label, const FridgeZone *z) {
    out.number(key, label, "C", z ? std::optional(z->current_c) : std::nullopt, s ? s->decimals : 0);
    if (s)
      out.range(s->min_c, s->max_c);
  };
  if (s && s->right) {
    zone("left.current", "Left", &s->left);
    out.primary();
    zone("right.current", "Right", &*s->right);
  } else {
    zone("temp", "Temperature", s ? &s->left : nullptr);
    out.primary();
  }
  out.number("battery_v", "Supply", "V", s ? s->supply_v : std::nullopt, 1);
  if (s && s->battery_pct)
    out.number("battery", "Battery", "%", s->battery_pct);
}

void Refrigerator::controls(const Device &, Controls &out) const {
  if (!state_)
    return;  // nothing to edit until the fridge has been read
  const FridgeState &s = *state_;
  out.toggle("power", "Power", s.powered_on);
  if (s.right) {
    out.number("left.target", "Left target", "C", s.min_c, s.max_c, s.step_c, s.left.target_c);
    out.number("right.target", "Right target", "C", s.min_c, s.max_c, s.step_c, s.right->target_c);
  } else {
    out.number("target", "Target", "C", s.min_c, s.max_c, s.step_c, s.left.target_c);
  }
  if (s.eco)
    out.choice("mode", "Mode", *s.eco ? "eco" : "max", {"max", "eco"});
  if (s.panel_locked)
    out.toggle("locked", "Panel lock", *s.panel_locked);
}

const char *Refrigerator::validate(const Device &, const Command &c) const {
  if (c.action != "set" || !cJSON_IsObject(c.values.get()))
    return "unsupported";
  if (!state_)
    return "refused";  // every write needs the fridge's current state
  const cJSON *v;
  cJSON_ArrayForEach(v, c.values.get()) {
    const char *k = v->string;
    bool ok = !std::strcmp(k, "power")                                       ? cJSON_IsBool(v)
              : !std::strcmp(k, "locked")                                    ? cJSON_IsBool(v) && state_->panel_locked
              : !std::strcmp(k, "mode")                                      ? cJSON_IsString(v) && state_->eco &&
                                          (!std::strcmp(v->valuestring, "max") || !std::strcmp(v->valuestring, "eco"))
              : !std::strcmp(k, "target") || !std::strcmp(k, "left.target") ? cJSON_IsNumber(v)
              : !std::strcmp(k, "right.target")                              ? cJSON_IsNumber(v) && state_->right
                                                                             : false;
    if (!ok)
      return "bad_request";
  }
  return nullptr;
}

FridgeChange Refrigerator::change_from(const Command &c) const {
  FridgeChange out;
  auto clamp = [this](double t) {
    float lo = state_ ? state_->min_c : -40, hi = state_ ? state_->max_c : 100;
    return static_cast<float>(t < lo ? lo : t > hi ? hi : t);
  };
  const cJSON *v;
  cJSON_ArrayForEach(v, c.values.get()) {
    const char *k = v->string;
    if (!std::strcmp(k, "power"))
      out.powered_on = cJSON_IsTrue(v);
    else if (!std::strcmp(k, "locked"))
      out.panel_locked = cJSON_IsTrue(v);
    else if (!std::strcmp(k, "mode") && cJSON_IsString(v))
      out.eco = !std::strcmp(v->valuestring, "eco");
    else if ((!std::strcmp(k, "target") || !std::strcmp(k, "left.target")) && cJSON_IsNumber(v))
      out.left_target_c = clamp(v->valuedouble);
    else if (!std::strcmp(k, "right.target") && cJSON_IsNumber(v))
      out.right_target_c = clamp(v->valuedouble);
  }
  return out;
}

}  // namespace openrv
