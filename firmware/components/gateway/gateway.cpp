#include "openrv/gateway.h"

#include <algorithm>
#include <cstring>

#include "esp_log.h"
#include "gateway_internal.h"
#include "psa/crypto.h"

namespace openrv {

namespace {

const char *const TAG = "gateway";
constexpr int CONFIG_VERSION = 1;
constexpr size_t MAX_PIN = 16;
/// New readings reach phones at most this often per device...
constexpr int64_t EVENT_MIN_US = 5LL * 1000 * 1000;
/// ...and every device is re-sent this often so ages stay fresh.
constexpr int64_t EVENT_REFRESH_US = 30LL * 1000 * 1000;
constexpr int64_t DISCOVERY_REPEAT_US = 2LL * 1000 * 1000;
constexpr int MAX_DISCOVERY_S = 120;

/// A slug for a device id: lower case letters, digits and dashes.
std::string slugify(const std::string &name) {
  std::string s;
  for (char c : name) {
    if (c >= 'A' && c <= 'Z')
      c = static_cast<char>(c - 'A' + 'a');
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
      s += c;
    else if (!s.empty() && s.back() != '-')
      s += '-';
    if (s.size() >= 20)
      break;
  }
  while (!s.empty() && s.back() == '-')
    s.pop_back();
  return s.empty() ? "device" : s;
}

}  // namespace

std::string to_hex(const uint8_t *b, size_t n) {
  static const char HEX[] = "0123456789abcdef";
  std::string s(n * 2, '0');
  for (size_t i = 0; i < n; i++) {
    s[2 * i] = HEX[b[i] >> 4];
    s[2 * i + 1] = HEX[b[i] & 15];
  }
  return s;
}

/// HMAC-SHA256(key = PIN, message = nonce), first 16 bytes.
bool pin_proof(const std::string &pin, const uint8_t *nonce, size_t nonce_len, uint8_t out[16]) {
  if (psa_crypto_init() != PSA_SUCCESS)
    return false;
  psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_type(&attr, PSA_KEY_TYPE_HMAC);
  psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_SIGN_MESSAGE);
  psa_set_key_algorithm(&attr, PSA_ALG_HMAC(PSA_ALG_SHA_256));
  psa_key_id_t key;
  if (psa_import_key(&attr, reinterpret_cast<const uint8_t *>(pin.data()), pin.size(), &key) != PSA_SUCCESS)
    return false;
  uint8_t mac[32];
  size_t len = 0;
  psa_status_t st = psa_mac_compute(key, PSA_ALG_HMAC(PSA_ALG_SHA_256), nonce, nonce_len, mac, sizeof mac, &len);
  psa_destroy_key(key);
  if (st != PSA_SUCCESS || len < 16)
    return false;
  std::memcpy(out, mac, 16);
  return true;
}

// ---- persistence ----

void Gateway::load() {
  std::lock_guard lock(mutex_);
  Json cfg = json_parse(p_.load_config());
  if (!cfg) {
    ESP_LOGI(TAG, "No stored configuration; starting empty");
    return;
  }
  if (const char *n = json_string(cfg.get(), "name"))
    name_ = n;
  if (const char *pin = json_string(cfg.get(), "pin"))
    pin_ = pin;
  load_phones_(cfg.get());
  const cJSON *d;
  cJSON_ArrayForEach(d, cJSON_GetObjectItem(cfg.get(), "devices")) {
    const DriverInfo *info = find_driver(json_string(d, "type"));
    Mac mac;
    const char *id = json_string(d, "id");
    if (!info || !id || !parse_mac(json_string(d, "mac"), mac)) {
      ESP_LOGW(TAG, "Skipping stored device %s: unknown type or bad address", id ? id : "?");
      continue;
    }
    auto dev = make_device(*info, id, json_string(d, "name") ? json_string(d, "name") : id, mac);
    // Setting by setting, so one a newer driver no longer accepts doesn't lose the rest.
    const cJSON *s;
    cJSON_ArrayForEach(s, cJSON_GetObjectItem(d, "settings")) {
      Json one = json_object();
      cJSON_AddItemToObject(one.get(), s->string, cJSON_Duplicate(s, true));
      apply_settings(*dev, one.get());
    }
    add_session_(*dev);
    devices_.push_back(std::move(dev));
  }
  const cJSON *r;
  cJSON_ArrayForEach(r, cJSON_GetObjectItem(cfg.get(), "rules")) {
    if (auto rule = parse_rule(r); rule && find_(rule->device) && rules_.size() < MAX_RULES)
      rules_.push_back({*rule, {}});
  }
  ESP_LOGI(TAG, "Loaded %u devices and %u rules", static_cast<unsigned>(devices_.size()),
           static_cast<unsigned>(rules_.size()));
}

void Gateway::save_() {
  Json cfg = json_object();
  cJSON_AddNumberToObject(cfg.get(), "version", CONFIG_VERSION);
  cJSON_AddStringToObject(cfg.get(), "name", name_.c_str());
  if (!pin_.empty())
    cJSON_AddStringToObject(cfg.get(), "pin", pin_.c_str());
  save_phones_(cfg.get());
  cJSON *arr = cJSON_AddArrayToObject(cfg.get(), "devices");
  for (const auto &d : devices_)
    cJSON_AddItemToArray(arr, device_config_json(*d).release());
  cJSON *rules = cJSON_AddArrayToObject(cfg.get(), "rules");
  for (const auto &e : rules_)
    cJSON_AddItemToArray(rules, rule_json(e.rule).release());
  p_.save_config(json_print(cfg.get()));
}

std::string Gateway::name() const {
  std::lock_guard lock(mutex_);
  return name_;
}

// ---- lookups ----

Device *Gateway::find_(std::string_view id) {
  for (auto &d : devices_)
    if (d->id == id)
      return d.get();
  return nullptr;
}

Device *Gateway::find_mac_(const Mac &mac) {
  for (auto &d : devices_)
    if (d->mac == mac)
      return d.get();
  return nullptr;
}

Gateway::Phone *Gateway::phone_(uint16_t conn) {
  for (auto &p : phones_)
    if (p.conn == conn)
      return &p;
  return nullptr;
}

// ---- phones ----

void Gateway::on_phone_connect(uint16_t conn) {
  std::lock_guard lock(mutex_);
  if (Phone *p = phone_(NO_CONN)) {
    *p = Phone{};
    p->conn = conn;
  }
}

void Gateway::on_phone_disconnect(uint16_t conn) {
  std::lock_guard lock(mutex_);
  if (transfer_.conn == conn)
    abort_transfer_();  // the phone went away mid-update; the old firmware stays
  if (Phone *p = phone_(conn))
    *p = Phone{};
  if (std::none_of(phones_.begin(), phones_.end(), [](const Phone &p) { return p.conn != NO_CONN; }))
    discovery_until_us_ = 0;
}

void Gateway::emit_(const char *ev, Json data) {
  Json e = json_object();
  cJSON_AddStringToObject(e.get(), "ev", ev);
  cJSON_AddItemToObject(e.get(), "data", data.release());
  std::string line = json_print(e.get());
  for (const auto &p : phones_)
    if (p.conn != NO_CONN && p.subscribed)
      p_.send(p.conn, line);
}

Json Gateway::device_event_json_(const Device &d, int64_t now) {
  Json j = device_json(d, now);
  cJSON *alarms = cJSON_AddArrayToObject(j.get(), "alarms");
  for (const auto &e : rules_)
    if (e.rule.device == d.id && e.status.state != AlarmState::NORMAL)
      cJSON_AddItemToArray(alarms, alarm_json(e.rule, e.status, now).release());
  return j;
}

void Gateway::emit_device_(Device &d) {
  int64_t now = p_.now_us();
  d.sent_us = now;
  emit_("device", device_event_json_(d, now));
}

void Gateway::evaluate_rules_(Device &d) {
  int64_t now = p_.now_us();
  bool changed = false;
  for (auto &e : rules_) {
    if (e.rule.device != d.id)
      continue;
    auto v = device_value(d, e.rule.value);
    if (v && evaluate(e.rule, e.status, *v, now)) {
      ESP_LOGI(TAG, "Rule %s is now %d (value %.1f)", e.rule.id.c_str(), static_cast<int>(e.status.state), *v);
      emit_("alarm", alarm_json(e.rule, e.status, now));
      changed = true;
    }
  }
  if (changed)
    emit_device_(d);
}

uint8_t Gateway::alarm_count() const {
  std::lock_guard lock(mutex_);
  return static_cast<uint8_t>(
      std::count_if(rules_.begin(), rules_.end(), [](const RuleEntry &e) { return e.status.state != AlarmState::NORMAL; }));
}

void Gateway::handle(uint16_t conn, std::string_view line) {
  static const struct {
    const char *name;
    Role role;  // the least role allowed
    Handler fn;
  } OPS[] = {
      {"hello", Role::NONE, &Gateway::op_hello_},
      {"pair", Role::NONE, &Gateway::op_pair_},
      {"claim", Role::NONE, &Gateway::op_claim_},
      {"auth.challenge", Role::NONE, &Gateway::op_auth_challenge_},
      {"auth.prove", Role::GUEST, &Gateway::op_auth_prove_},
      {"snapshot", Role::GUEST, &Gateway::op_snapshot_},
      {"subscribe", Role::GUEST, &Gateway::op_subscribe_},
      {"config.get", Role::GUEST, &Gateway::op_config_get_},
      {"device.command", Role::GUEST, &Gateway::op_device_command_},  // and the PIN, per action
      {"device.add", Role::OWNER, &Gateway::op_device_add_},
      {"device.update", Role::OWNER, &Gateway::op_device_update_},
      {"device.remove", Role::OWNER, &Gateway::op_device_remove_},
      {"rule.put", Role::OWNER, &Gateway::op_rule_put_},
      {"rule.remove", Role::OWNER, &Gateway::op_rule_remove_},
      {"gateway.update", Role::OWNER, &Gateway::op_gateway_update_},
      {"discovery.start", Role::OWNER, &Gateway::op_discovery_start_},
      {"discovery.stop", Role::OWNER, &Gateway::op_discovery_stop_},
      {"ota.begin", Role::OWNER, &Gateway::op_ota_begin_},
      {"ota.send.begin", Role::OWNER, &Gateway::op_ota_send_begin_},
      {"ota.send.data", Role::OWNER, &Gateway::op_ota_send_data_},
      {"ota.send.end", Role::OWNER, &Gateway::op_ota_send_end_},
      {"ota.send.abort", Role::OWNER, &Gateway::op_ota_send_abort_},
      {"gateway.reboot", Role::OWNER, &Gateway::op_reboot_},
      {"gateway.reset", Role::OWNER, &Gateway::op_reset_},
      {"phones.list", Role::OWNER, &Gateway::op_phones_list_},
      {"phones.update", Role::OWNER, &Gateway::op_phones_update_},
      {"phones.remove", Role::OWNER, &Gateway::op_phones_remove_},
      {"pairing.open", Role::OWNER, &Gateway::op_pairing_open_},
  };

  std::lock_guard lock(mutex_);
  Phone *phone = phone_(conn);
  Json req = json_parse(line);
  const cJSON *id = cJSON_GetObjectItem(req.get(), "id");
  if (!phone || !req || !cJSON_IsNumber(id))
    return;  // nothing to answer to

  const char *op = json_string(req.get(), "op");
  const cJSON *args = cJSON_GetObjectItem(req.get(), "args");
  const char *error = "unsupported";
  Json result;
  for (const auto &entry : OPS) {
    if (!op || std::strcmp(op, entry.name))
      continue;
    error = nullptr;
    if (phone->role < entry.role)
      error = "not_authorized";
    else
      result = (this->*entry.fn)(*phone, args, error);
    break;
  }

  Json res = json_object();
  cJSON_AddNumberToObject(res.get(), "id", id->valuedouble);
  cJSON_AddBoolToObject(res.get(), "ok", error == nullptr);
  if (error) {
    cJSON_AddObjectToObject(res.get(), "error");
    cJSON_AddStringToObject(cJSON_GetObjectItem(res.get(), "error"), "code", error);
  } else {
    cJSON_AddItemToObject(res.get(), "result", result ? result.release() : cJSON_CreateObject());
  }
  p_.send(conn, json_print(res.get()));

  if (reboot_pending_)
    p_.reboot();
}

// ---- ops ----

Json Gateway::op_hello_(Phone &phone, const cJSON *args, const char *&) {
  if (const char *n = json_string(args, "phone"); n && std::strlen(n) <= MAX_NAME)
    phone.name = n;
  Json r = json_object();
  cJSON_AddNumberToObject(r.get(), "proto", PROTOCOL_VERSION);
  cJSON_AddStringToObject(r.get(), "fw", p_.firmware_version.c_str());
  if (!p_.mac.empty())
    cJSON_AddStringToObject(r.get(), "mac", p_.mac.c_str());
  cJSON_AddStringToObject(r.get(), "name", name_.c_str());
  cJSON *auth = cJSON_AddObjectToObject(r.get(), "auth");
  cJSON_AddBoolToObject(auth, "pin_set", !pin_.empty());
  cJSON_AddBoolToObject(auth, "ok", pin_.empty() || phone.authenticated);
  cJSON_AddItemToObject(r.get(), "access", access_json_(phone).release());
  cJSON *caps = cJSON_AddObjectToObject(r.get(), "caps");
  cJSON_AddFalseToObject(caps, "display");
  cJSON_AddNumberToObject(caps, "max_devices", MAX_DEVICES);
  cJSON_AddNumberToObject(caps, "max_links", 3);
  return r;
}

Json Gateway::op_auth_challenge_(Phone &phone, const cJSON *, const char *&) {
  p_.random(phone.nonce.data(), phone.nonce.size());
  phone.nonce_valid = true;
  Json r = json_object();
  cJSON_AddStringToObject(r.get(), "nonce", to_hex(phone.nonce.data(), phone.nonce.size()).c_str());
  return r;
}

Json Gateway::op_auth_prove_(Phone &phone, const cJSON *args, const char *&error) {
  const char *proof = json_string(args, "proof");
  bool had_nonce = phone.nonce_valid;
  phone.nonce_valid = false;  // a nonce is good for one try
  uint8_t expected[16];
  if (pin_.empty()) {
    phone.authenticated = true;
  } else if (!proof || !had_nonce || !pin_proof(pin_, phone.nonce.data(), phone.nonce.size(), expected) ||
             to_hex(expected, sizeof expected) != proof) {
    error = "auth_failed";
  } else {
    phone.authenticated = true;
  }
  return nullptr;
}

Json Gateway::op_snapshot_(Phone &, const cJSON *, const char *&) {
  int64_t now = p_.now_us();
  Json r = json_object();
  cJSON *gw = cJSON_AddObjectToObject(r.get(), "gateway");
  cJSON_AddStringToObject(gw, "name", name_.c_str());
  cJSON_AddStringToObject(gw, "fw", p_.firmware_version.c_str());
  cJSON_AddNumberToObject(gw, "uptime_s", static_cast<double>(now / 1000000));
  cJSON_AddNumberToObject(gw, "alarms", alarm_count());
  cJSON *arr = cJSON_AddArrayToObject(r.get(), "devices");
  for (auto &d : devices_)
    cJSON_AddItemToArray(arr, device_event_json_(*d, now).release());
  cJSON *alarms = cJSON_AddArrayToObject(r.get(), "alarms");
  for (const auto &e : rules_)
    if (e.status.state != AlarmState::NORMAL)
      cJSON_AddItemToArray(alarms, alarm_json(e.rule, e.status, now).release());
  return r;
}

Json Gateway::op_subscribe_(Phone &phone, const cJSON *, const char *&) {
  phone.subscribed = true;
  return nullptr;
}

Json Gateway::op_config_get_(Phone &, const cJSON *, const char *&) {
  Json r = json_object();
  cJSON *gw = cJSON_AddObjectToObject(r.get(), "gateway");
  cJSON_AddStringToObject(gw, "name", name_.c_str());
  cJSON_AddBoolToObject(gw, "pin_set", !pin_.empty());
  cJSON *arr = cJSON_AddArrayToObject(r.get(), "devices");
  for (auto &d : devices_) {
    Json c = device_config_json(*d);
    cJSON_ReplaceItemInObjectCaseSensitive(c.get(), "settings", public_settings(*d).release());
    cJSON_AddItemToArray(arr, c.release());
  }
  cJSON *rules = cJSON_AddArrayToObject(r.get(), "rules");
  for (const auto &e : rules_)
    cJSON_AddItemToArray(rules, rule_json(e.rule).release());
  cJSON_AddItemToObject(r.get(), "models", models_json().release());
  return r;
}

Json Gateway::op_device_add_(Phone &, const cJSON *args, const char *&error) {
  const DriverInfo *info = find_driver(json_string(args, "type"));
  Mac mac;
  const char *name = json_string(args, "name");
  if (!info || !parse_mac(json_string(args, "mac"), mac) || !name || !*name || std::strlen(name) > MAX_NAME) {
    error = "bad_request";
    return nullptr;
  }
  if (devices_.size() >= MAX_DEVICES || find_mac_(mac)) {
    error = "refused";
    return nullptr;
  }
  std::string base = slugify(name), id = base;
  for (int n = 2; find_(id); n++)
    id = base + "-" + std::to_string(n);
  auto d = make_device(*info, id, name, mac);
  const cJSON *settings = cJSON_GetObjectItem(args, "settings");
  if (settings && !apply_settings(*d, settings)) {
    error = "bad_request";
    return nullptr;
  }
  Device &added = *d;
  add_session_(added);
  devices_.push_back(std::move(d));
  save_();
  emit_device_(added);
  Json r = json_object();
  cJSON_AddStringToObject(r.get(), "id", added.id.c_str());
  return r;
}

Json Gateway::op_device_update_(Phone &, const cJSON *args, const char *&error) {
  Device *d = find_(json_string(args, "id") ? json_string(args, "id") : "");
  if (!d) {
    error = "not_found";
    return nullptr;
  }
  const char *name = json_string(args, "name");
  const cJSON *settings = cJSON_GetObjectItem(args, "settings");
  if ((name && (!*name || std::strlen(name) > MAX_NAME)) || (settings && !apply_settings(*d, settings))) {
    error = "bad_request";
    return nullptr;
  }
  if (name)
    d->name = name;
  save_();
  emit_device_(*d);
  return nullptr;
}

Json Gateway::op_device_remove_(Phone &, const cJSON *args, const char *&error) {
  const char *id = json_string(args, "id");
  auto it = std::find_if(devices_.begin(), devices_.end(), [&](const auto &d) { return id && d->id == id; });
  if (it == devices_.end()) {
    error = "not_found";
    return nullptr;
  }
  remove_session_((*it)->id);
  devices_.erase(it);
  std::erase_if(rules_, [&](const RuleEntry &e) { return e.rule.device == id; });
  save_();
  Json data = json_object();
  cJSON_AddStringToObject(data.get(), "id", id);
  emit_("device.removed", std::move(data));
  return nullptr;
}

Json Gateway::op_device_command_(Phone &phone, const cJSON *args, const char *&error) {
  Device *d = find_(json_string(args, "device") ? json_string(args, "device") : "");
  const char *action = json_string(args, "action");
  if (!d || !action) {
    error = d ? "bad_request" : "not_found";
    return nullptr;
  }
  Session *s = session_(d->id);
  if (!std::strcmp(action, "refresh")) {
    if (s && s->state == Session::State::IDLE)
      s->next_us = 0;  // read it now
    emit_device_(*d);
    return nullptr;
  }
  if (d->driver->action_needs_pin(*d, action) && !pin_.empty() && !phone.authenticated) {
    error = "not_authorized";
    return nullptr;
  }
  if (!s) {
    error = "unsupported";
    return nullptr;
  }
  Command c{action, Json(cJSON_Duplicate(cJSON_GetObjectItem(args, "values"), true))};
  if ((error = s->handler->validate(*d, c)))
    return nullptr;
  if (s->commands.size() >= 4) {
    error = "busy";
    return nullptr;
  }
  // Accepted: the device hears it in its next session (started right away), and phones see the result.
  s->commands.push_back(std::move(c));
  d->busy = true;
  emit_device_(*d);
  return nullptr;
}

Json Gateway::op_rule_put_(Phone &, const cJSON *args, const char *&error) {
  auto rule = parse_rule(args);
  Device *d = rule ? find_(rule->device) : nullptr;
  if (!rule || !d) {
    error = rule ? "not_found" : "bad_request";
    return nullptr;
  }
  auto it = std::find_if(rules_.begin(), rules_.end(), [&](const RuleEntry &e) { return e.rule.id == rule->id; });
  if (it == rules_.end()) {
    if (rules_.size() >= MAX_RULES) {
      error = "refused";
      return nullptr;
    }
    rules_.push_back({*rule, {}});
  } else {
    // A changed rule starts again from normal; if it was alarming, phones hear it clear.
    if (it->status.state != AlarmState::NORMAL) {
      it->status.state = AlarmState::NORMAL;
      emit_("alarm", alarm_json(it->rule, it->status, p_.now_us()));
    }
    *it = {*rule, {}};
  }
  save_();
  evaluate_rules_(*d);
  return nullptr;
}

Json Gateway::op_rule_remove_(Phone &, const cJSON *args, const char *&error) {
  const char *id = json_string(args, "id");
  auto it = std::find_if(rules_.begin(), rules_.end(), [&](const RuleEntry &e) { return id && e.rule.id == id; });
  if (it == rules_.end()) {
    error = "not_found";
    return nullptr;
  }
  RuleEntry removed = std::move(*it);
  rules_.erase(it);
  save_();
  if (removed.status.state != AlarmState::NORMAL) {
    removed.status.state = AlarmState::NORMAL;
    emit_("alarm", alarm_json(removed.rule, removed.status, p_.now_us()));
  }
  return nullptr;
}

Json Gateway::op_gateway_update_(Phone &phone, const cJSON *args, const char *&error) {
  const char *name = json_string(args, "name");
  const cJSON *pin = cJSON_GetObjectItem(args, "pin");
  if ((name && (!*name || std::strlen(name) > MAX_NAME)) ||
      (pin && !(cJSON_IsNull(pin) || (cJSON_IsString(pin) && std::strlen(pin->valuestring) <= MAX_PIN)))) {
    error = "bad_request";
    return nullptr;
  }
  if (name)
    name_ = name;
  if (pin) {
    pin_ = cJSON_IsString(pin) ? pin->valuestring : "";
    // Everyone else must prove the new PIN; this phone set it, so it stays trusted.
    for (auto &p : phones_)
      p.authenticated = false;
    phone.authenticated = true;
  }
  save_();
  return nullptr;
}

Json Gateway::op_discovery_start_(Phone &, const cJSON *args, const char *&) {
  const cJSON *s = cJSON_GetObjectItem(args, "seconds");
  int seconds = cJSON_IsNumber(s) ? std::min(std::max(s->valueint, 5), MAX_DISCOVERY_S) : 60;
  discovery_until_us_ = p_.now_us() + seconds * 1000000LL;
  discovered_.clear();
  return nullptr;
}

Json Gateway::op_discovery_stop_(Phone &, const cJSON *, const char *&) {
  discovery_until_us_ = 0;
  return nullptr;
}

Json Gateway::op_ota_begin_(Phone &, const cJSON *args, const char *&error) {
  const cJSON *m = cJSON_GetObjectItem(args, "minutes");
  int minutes = cJSON_IsNumber(m) ? std::clamp(m->valueint, 0, 30) : 10;
  Json r = p_.ota_window(minutes);
  if (minutes > 0 && !r)
    error = "internal";
  Json state = json_object();
  cJSON_AddBoolToObject(state.get(), "on", minutes > 0 && r);
  cJSON_AddNumberToObject(state.get(), "seconds_left", minutes > 0 && r ? minutes * 60 : 0);
  emit_("wifi", std::move(state));
  return r;
}

Json Gateway::op_reboot_(Phone &, const cJSON *, const char *&) {
  reboot_pending_ = true;
  return nullptr;
}

Json Gateway::op_reset_(Phone &, const cJSON *, const char *&) {
  for (auto &s : sessions_)
    if (s->state != Session::State::IDLE)
      p_.links->close(s->slot);
  sessions_.clear();
  devices_.clear();
  rules_.clear();
  pin_.clear();
  name_ = "OpenRV";
  save_();
  reboot_pending_ = true;
  return nullptr;
}

// ---- radio input ----

void Gateway::on_advert(const Mac &mac, int8_t rssi, Bytes data) {
  std::lock_guard lock(mutex_);
  Advert ad(data);
  if (discovery_until_us_)
    discovery_advert_(mac, rssi, ad);

  Device *d = find_mac_(mac);
  if (!d)
    return;
  // Connected devices advertise between sessions: keep their signal strength current too.
  d->rssi = rssi;
  if (d->info->transport != Transport::ADVERT || !d->driver->on_advert(*d, ad))
    return;
  int64_t now = p_.now_us();
  d->heard_us = now;
  evaluate_rules_(*d);
  if (now - d->sent_us >= EVENT_MIN_US)
    emit_device_(*d);
}

void Gateway::discovery_advert_(const Mac &mac, int8_t rssi, const Advert &ad) {
  const DriverInfo *info = guess_driver(ad, mac);
  auto name = ad.name();
  if (!info && name.empty())
    return;  // nameless and unrecognized: noise
  int64_t now = p_.now_us();
  auto seen = std::find_if(discovered_.begin(), discovered_.end(), [&](const Discovered &x) { return x.mac == mac; });
  if (seen != discovered_.end() && now - seen->sent_us < DISCOVERY_REPEAT_US)
    return;
  if (seen == discovered_.end()) {
    if (discovered_.size() >= 64)
      return;
    discovered_.push_back({mac, now});
  } else {
    seen->sent_us = now;
  }

  Json data = json_object();
  cJSON_AddStringToObject(data.get(), "mac", mac_to_string(mac).c_str());
  cJSON_AddNumberToObject(data.get(), "rssi", rssi);
  if (!name.empty())
    cJSON_AddStringToObject(data.get(), "name", std::string(name).c_str());
  if (info) {
    cJSON_AddStringToObject(data.get(), "type", info->type);
    cJSON_AddStringToObject(data.get(), "class", class_name(info->device_class));
    cJSON_AddStringToObject(data.get(), "model", info->model);
  }
  cJSON_AddBoolToObject(data.get(), "added", find_mac_(mac) != nullptr);
  emit_("discovery", std::move(data));
}

void Gateway::tick() {
  std::lock_guard lock(mutex_);
  int64_t now = p_.now_us();
  run_sessions_(now);
  if (now - last_refresh_us_ < 1000000)
    return;
  last_refresh_us_ = now;
  if (discovery_until_us_ && now >= discovery_until_us_)
    discovery_until_us_ = 0;
  for (auto &d : devices_)
    if (now - d->sent_us >= EVENT_REFRESH_US)
      emit_device_(*d);
}

}  // namespace openrv
