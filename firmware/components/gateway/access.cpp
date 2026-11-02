// Who may use the gateway. Phones pair with it over Bluetooth (bonded and encrypted) and the
// gateway keeps a list of the ones it knows, with a role each. A new gateway has no owner: the
// first phone claims it with the setup code the web flasher wrote (from its QR code), or by
// pairing while the BOOT button's pairing window is open. Owners then let more phones in.
#include <algorithm>
#include <cstring>

#include "esp_log.h"
#include "gateway_internal.h"
#include "openrv/gateway.h"

namespace openrv {

namespace {

const char *const TAG = "access";
constexpr int MAX_PAIRING_S = 300;
constexpr const char *ROLE_NAMES[] = {"none", "guest", "owner"};

std::optional<Role> parse_role(const char *s) {
  for (int i = 0; i < 3; i++)
    if (s && !std::strcmp(s, ROLE_NAMES[i]))
      return static_cast<Role>(i);
  return std::nullopt;
}

}  // namespace

const char *role_name(Role r) { return ROLE_NAMES[static_cast<int>(r)]; }

// ---- state ----

bool Gateway::claimed_() const {
  return std::any_of(known_phones_.begin(), known_phones_.end(), [](const KnownPhone &k) { return k.role == Role::OWNER; });
}

Gateway::KnownPhone *Gateway::known_(const std::string &addr) {
  for (auto &k : known_phones_)
    if (k.addr == addr)
      return &k;
  return nullptr;
}

Json Gateway::access_json_(const Phone &p) const {
  Json a = json_object();
  cJSON_AddStringToObject(a.get(), "role", role_name(p.role));
  cJSON_AddBoolToObject(a.get(), "paired", p.secured);
  cJSON_AddBoolToObject(a.get(), "claimed", claimed_());
  cJSON_AddBoolToObject(a.get(), "pairing", pairing_open_());
  cJSON_AddBoolToObject(a.get(), "setup_code", !p_.setup_code.empty());
  return a;
}

void Gateway::send_access_(const Phone &p) {
  Json e = json_object();
  cJSON_AddStringToObject(e.get(), "ev", "access");
  cJSON_AddItemToObject(e.get(), "data", access_json_(p).release());
  p_.send(p.conn, json_print(e.get()));
}

GatewayStatus Gateway::status() const {
  std::lock_guard lock(mutex_);
  GatewayStatus s;
  s.claimed = claimed_();
  s.pairing = p_.now_us() < pairing_until_us_;
  s.phone_connected =
      std::any_of(phones_.begin(), phones_.end(), [](const Phone &p) { return p.conn != NO_CONN && p.role != Role::NONE; });
  for (const auto &e : rules_) {
    if (e.status.state == AlarmState::NORMAL)
      continue;
    if (e.rule.severity == Severity::CRITICAL)
      s.criticals++;
    else if (e.rule.severity == Severity::WARNING)
      s.warnings++;
  }
  return s;
}

// ---- persistence ----

void Gateway::load_phones_(const cJSON *cfg) {
  const cJSON *k;
  cJSON_ArrayForEach(k, cJSON_GetObjectItem(cfg, "phones")) {
    const char *addr = json_string(k, "addr");
    auto role = parse_role(json_string(k, "role"));
    if (addr && role && *role != Role::NONE && known_phones_.size() < MAX_KNOWN_PHONES)
      known_phones_.push_back({addr, json_string(k, "name") ? json_string(k, "name") : "", *role});
  }
  // Bonds of phones that never finished claiming, or were removed, go.
  std::vector<std::string> keep;
  for (const auto &kp : known_phones_)
    keep.push_back(kp.addr);
  if (p_.prune_bonds)
    p_.prune_bonds(keep);
}

void Gateway::save_phones_(cJSON *cfg) const {
  cJSON *arr = cJSON_AddArrayToObject(cfg, "phones");
  for (const auto &k : known_phones_) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "addr", k.addr.c_str());
    cJSON_AddStringToObject(o, "name", k.name.c_str());
    cJSON_AddStringToObject(o, "role", role_name(k.role));
    cJSON_AddItemToArray(arr, o);
  }
}

// ---- pairing ----

bool Gateway::on_phone_secured(uint16_t conn, const std::string &addr, bool new_bond) {
  std::lock_guard lock(mutex_);
  Phone *p = phone_(conn);
  if (!p)
    return false;
  KnownPhone *k = known_(addr);
  if (k && !new_bond) {
    p->role = k->role;  // coming back with the bond it had
  } else if (pairing_open_() && claimed_()) {
    if (k) {
      p->role = k->role;  // a known phone that forgot the gateway and paired again
    } else if (known_phones_.size() >= MAX_KNOWN_PHONES) {
      ESP_LOGW(TAG, "Refusing %s: already %u phones", addr.c_str(), static_cast<unsigned>(MAX_KNOWN_PHONES));
      refuse_(*p, "full");
      return false;
    } else {
      known_phones_.push_back({addr, p->name, pairing_role_});
      p->role = pairing_role_;
    }
    pairing_until_us_ = 0;  // one phone per window
    save_();
    ESP_LOGI(TAG, "Paired %s as %s", addr.c_str(), role_name(p->role));
  } else if (!claimed_()) {
    p->role = Role::NONE;  // paired, and may now claim the gateway
  } else {
    // A new bond for a known address, outside a pairing window, could be someone posing as that
    // phone, so it's refused like a stranger.
    ESP_LOGI(TAG, "Refusing %s: pairing isn't open", addr.c_str());
    refuse_(*p, "pairing_closed");
    return false;
  }
  p->secured = true;
  p->addr = addr;
  send_access_(*p);
  return true;
}

void Gateway::refuse_(const Phone &p, const char *reason) {
  Json e = json_object();
  cJSON_AddStringToObject(e.get(), "ev", "access");
  Json a = access_json_(p);
  cJSON_AddStringToObject(a.get(), "refused", reason);
  cJSON_AddItemToObject(e.get(), "data", a.release());
  p_.send(p.conn, json_print(e.get()));
}

void Gateway::open_pairing(int seconds, Role role) {
  std::lock_guard lock(mutex_);
  pairing_until_us_ = p_.now_us() + std::clamp(seconds, 10, MAX_PAIRING_S) * 1000000LL;
  pairing_role_ = role;
  ESP_LOGI(TAG, "Pairing open for %d s", seconds);
  for (auto &p : phones_)
    if (p.conn != NO_CONN)
      send_access_(p);
}

Json Gateway::op_pair_(Phone &phone, const cJSON *, const char *&error) {
  if (phone.secured)
    return access_json_(phone);
  // Even with pairing closed: a known phone may be reconnecting with a bond the gateway couldn't
  // match when it connected. A stranger pairs, is told why it isn't let in, and is disconnected.
  if (p_.pair)
    p_.pair(phone.conn);
  return access_json_(phone);
}

Json Gateway::op_claim_(Phone &phone, const cJSON *args, const char *&error) {
  bool had_nonce = phone.nonce_valid;
  phone.nonce_valid = false;
  if (claimed_()) {
    error = "refused";
    return nullptr;
  }
  if (!phone.secured) {
    error = "not_authorized";  // pair first
    return nullptr;
  }
  // Either the setup code (proved against a challenge nonce) or the BOOT button's pairing window.
  const char *proof = json_string(args, "proof");
  uint8_t expected[16];
  bool code_ok = proof && had_nonce && !p_.setup_code.empty() &&
                 pin_proof(p_.setup_code, phone.nonce.data(), phone.nonce.size(), expected) &&
                 to_hex(expected, sizeof expected) == proof;
  if (!code_ok && !pairing_open_()) {
    error = "auth_failed";
    return nullptr;
  }
  known_phones_.clear();
  known_phones_.push_back({phone.addr, phone.name, Role::OWNER});
  phone.role = Role::OWNER;
  pairing_until_us_ = 0;
  save_();
  if (p_.prune_bonds)
    p_.prune_bonds({phone.addr});
  // Anyone else who paired while it was unclaimed has to go.
  for (auto &p : phones_)
    if (p.conn != NO_CONN && p.conn != phone.conn && p.secured && p_.drop)
      p_.drop(p.conn);
  ESP_LOGI(TAG, "Claimed by %s", phone.addr.c_str());
  return access_json_(phone);
}

// ---- managing phones (owners) ----

Json Gateway::op_phones_list_(Phone &phone, const cJSON *, const char *&) {
  Json arr(cJSON_CreateArray());
  for (const auto &k : known_phones_) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "addr", k.addr.c_str());
    cJSON_AddStringToObject(o, "name", k.name.c_str());
    cJSON_AddStringToObject(o, "role", role_name(k.role));
    cJSON_AddBoolToObject(o, "you", k.addr == phone.addr);
    cJSON_AddBoolToObject(o, "connected", std::any_of(phones_.begin(), phones_.end(), [&](const Phone &p) {
                            return p.conn != NO_CONN && p.addr == k.addr;
                          }));
    cJSON_AddItemToArray(arr.get(), o);
  }
  Json r = json_object();
  cJSON_AddItemToObject(r.get(), "phones", arr.release());
  return r;
}

Json Gateway::op_phones_update_(Phone &, const cJSON *args, const char *&error) {
  KnownPhone *k = known_(json_string(args, "addr") ? json_string(args, "addr") : "");
  auto role = parse_role(json_string(args, "role"));
  const char *name = json_string(args, "name");
  if (!k || (role && *role == Role::NONE) || (name && std::strlen(name) > MAX_NAME)) {
    error = k ? "bad_request" : "not_found";
    return nullptr;
  }
  int owners = std::count_if(known_phones_.begin(), known_phones_.end(), [](const KnownPhone &x) { return x.role == Role::OWNER; });
  if (role && k->role == Role::OWNER && *role != Role::OWNER && owners == 1) {
    error = "refused";  // the gateway always keeps an owner
    return nullptr;
  }
  if (role)
    k->role = *role;
  if (name)
    k->name = name;
  for (auto &p : phones_)
    if (p.conn != NO_CONN && p.addr == k->addr) {
      p.role = k->role;
      send_access_(p);
    }
  save_();
  return nullptr;
}

Json Gateway::op_phones_remove_(Phone &, const cJSON *args, const char *&error) {
  std::string addr = json_string(args, "addr") ? json_string(args, "addr") : "";
  KnownPhone *k = known_(addr);
  if (!k) {
    error = "not_found";
    return nullptr;
  }
  int owners = std::count_if(known_phones_.begin(), known_phones_.end(), [](const KnownPhone &x) { return x.role == Role::OWNER; });
  if (k->role == Role::OWNER && owners == 1) {
    error = "refused";  // the last owner stays; a factory reset (hold BOOT 10 s) starts over
    return nullptr;
  }
  std::erase_if(known_phones_, [&](const KnownPhone &x) { return x.addr == addr; });
  save_();
  std::vector<std::string> keep;
  for (const auto &kp : known_phones_)
    keep.push_back(kp.addr);
  if (p_.prune_bonds)
    p_.prune_bonds(keep);
  for (auto &p : phones_)
    if (p.conn != NO_CONN && p.addr == addr && p_.drop)
      p_.drop(p.conn);
  return nullptr;
}

Json Gateway::op_pairing_open_(Phone &, const cJSON *args, const char *&error) {
  auto role = parse_role(json_string(args, "role"));
  const cJSON *s = cJSON_GetObjectItem(args, "seconds");
  if (role == Role::NONE) {
    error = "bad_request";
    return nullptr;
  }
  if (known_phones_.size() >= MAX_KNOWN_PHONES) {
    error = "refused";
    return nullptr;
  }
  pairing_until_us_ = p_.now_us() + std::clamp(cJSON_IsNumber(s) ? s->valueint : 120, 10, MAX_PAIRING_S) * 1000000LL;
  pairing_role_ = role.value_or(Role::GUEST);
  return nullptr;
}

}  // namespace openrv
