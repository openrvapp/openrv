// Locks: the last command sent, the lock/unlock action, and the standard lock settings.
#include <cstring>

#include "openrv/device.h"
#include "openrv/device_classes.h"

namespace openrv {

namespace {

/// Unlocking asks for the PIN unless turned off; locks saved before the setting existed still ask.
bool unlock_needs_pin(const Device &d) { return setting_bool(d, "unlock_pin", true); }

}  // namespace

void Lock::values(const Device &, Values &out) const {
  const char *last = last_action_ ? (*last_action_ == LockAction::LOCK ? "lock" : "unlock") : nullptr;
  out.choice("last_action", "Last command", last, {"lock", "unlock"}).primary();
}

void Lock::controls(const Device &d, Controls &out) const {
  if (setting_bool(d, "lock_only"))
    out.action("lock", "Lock", {"lock"});
  else if (unlock_needs_pin(d))
    out.action("lock", "Lock", {"lock", "unlock"}, {"unlock"});
  else
    out.action("lock", "Lock", {"lock", "unlock"});
}

void Lock::default_settings(cJSON *out) const {
  cJSON_AddFalseToObject(out, "lock_only");
  cJSON_AddTrueToObject(out, "unlock_pin");
}

void Lock::setting_defs(const Device &d, Controls &out) const {
  out.toggle("lock_only", "Lock only (refuse unlock)", setting_bool(d, "lock_only"));
  out.toggle("unlock_pin", "Ask for the gateway PIN to unlock", unlock_needs_pin(d));
}

bool Lock::valid_setting(const char *key, const cJSON *value) const {
  return (!std::strcmp(key, "lock_only") || !std::strcmp(key, "unlock_pin")) && cJSON_IsBool(value);
}

bool Lock::action_needs_pin(const Device &d, const std::string &action) const {
  if (action == "lock" || action == "refresh")
    return false;
  if (action == "unlock")
    return unlock_needs_pin(d);
  return true;
}

const char *Lock::validate(const Device &d, const Command &c) const {
  if (c.action != "lock" && c.action != "unlock")
    return "unsupported";
  if (c.action == "unlock" && setting_bool(d, "lock_only"))
    return "refused";
  return ready(d);
}

}  // namespace openrv
