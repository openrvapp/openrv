#pragma once

#include <array>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include "openrv/device.h"
#include "openrv/rules.h"
#include "openrv/session.h"

namespace openrv {

constexpr int PROTOCOL_VERSION = 1;
constexpr size_t MAX_DEVICES = 24;
constexpr size_t MAX_PHONES = 2;
constexpr size_t MAX_RULES = 32;
constexpr uint16_t NO_CONN = 0xFFFF;
constexpr size_t MAX_KNOWN_PHONES = 8;
/// Bytes of firmware per ota.send.data piece: 2,732 characters of base64, well inside one line.
constexpr size_t OTA_CHUNK = 2048;

/// What a phone may do. None: say hello, pair and claim. Guest: watch and operate devices.
/// Owner: everything, including settings, firmware and which phones get in.
enum class Role : uint8_t { NONE, GUEST, OWNER };
const char *role_name(Role r);

/// What the gateway core needs from the platform, so it stays free of BLE and NVS details.
struct Platform {
  /// Sends one protocol line (without newline) to a phone.
  std::function<void(uint16_t conn, const std::string &line)> send;
  std::function<int64_t()> now_us;
  std::function<void(uint8_t *buf, size_t len)> random;
  std::function<std::string()> load_config;
  std::function<void(const std::string &json)> save_config;
  std::function<void()> reboot;
  LinkIo *links = nullptr;
  /// Opens the firmware-update Wi-Fi window for `minutes` (0 closes it); returns the
  /// ota.begin result (schema #/$defs/otaBegin), or null when Wi-Fi couldn't start.
  std::function<Json(int minutes)> ota_window;

  // Firmware over Bluetooth (ota.send.*): each returns an error message, or null when it worked.
  /// Starts writing an image of `size` bytes to the spare app slot.
  std::function<const char *(size_t size)> ota_begin;
  /// Writes the next piece.
  std::function<const char *(const uint8_t *data, size_t len)> ota_write;
  /// Checks the image, makes it the one to start, and restarts shortly.
  std::function<const char *()> ota_finish;
  /// Drops a partly written image.
  std::function<void()> ota_abort;
  std::string firmware_version;
  /// The gateway's Bluetooth address (AA:BB:...), so phones can keep a dashboard per gateway.
  std::string mac;

  // Pairing (components/ble). Only phones the gateway knows, over an encrypted, bonded link, get
  // past hello; a phone is known by its Bluetooth identity address.
  /// Starts pairing with a phone (the phone shows its pairing prompt).
  std::function<void(uint16_t conn)> pair;
  /// Disconnects a phone.
  std::function<void(uint16_t conn)> drop;
  /// Deletes every stored bond except these identity addresses.
  std::function<void(const std::vector<std::string> &keep)> prune_bonds;
  /// The one-time setup code the web flasher wrote with the firmware; empty when there is none.
  std::string setup_code;
};

/// What the status LED shows (components/board).
struct GatewayStatus {
  bool claimed = false;
  bool pairing = false;
  bool phone_connected = false;
  int warnings = 0;
  int criticals = 0;
};

/// The gateway's state: configured devices with their latest readings, phones, and the JSON API.
/// Every public method may be called from any task.
class Gateway {
 public:
  explicit Gateway(Platform platform) : p_(std::move(platform)) {}

  void load();
  /// Handles one request line from a phone; replies through Platform::send.
  void handle(uint16_t conn, std::string_view line);
  void on_advert(const Mac &mac, int8_t rssi, Bytes data);
  void on_phone_connect(uint16_t conn);
  void on_phone_disconnect(uint16_t conn);
  /// The link to a phone is encrypted and bonded; `addr` is its identity address, and `new_bond`
  /// says it has only just paired. Returns false when the gateway doesn't accept it (the caller then
  /// deletes a new bond and disconnects).
  bool on_phone_secured(uint16_t conn, const std::string &addr, bool new_bond);
  /// Lets new phones pair for `seconds`, joining as `role` (the BOOT button, or an owner's app).
  /// On a gateway without an owner, a phone that pairs while it's open may claim it.
  void open_pairing(int seconds, Role role);
  GatewayStatus status() const;
  /// Call about every 100 ms: runs device sessions, keeps ages fresh on phones, ends discovery.
  void tick();

  // From the radio, for connected devices (LinkIo).
  void on_link_open(int slot);
  void on_link_data(int slot, Bytes data);
  /// `failed` = the link never came up (out of range, or another app holds the device).
  void on_link_closed(int slot, bool failed);
  std::string name() const;
  /// Number of active alarms, for the advertisement.
  uint8_t alarm_count() const;

 private:
  struct Phone {
    uint16_t conn = NO_CONN;  // NO_CONN = free slot
    bool subscribed = false;
    bool secured = false;  // encrypted and bonded
    std::string addr;      // identity address, once secured
    std::string name;      // what the phone calls itself, from hello
    Role role = Role::NONE;
    bool authenticated = false;  // proved the PIN (for actions that ask for it)
    bool nonce_valid = false;
    std::array<uint8_t, 16> nonce{};
  };
  struct RuleEntry {
    Rule rule;
    RuleStatus status;
  };
  struct Discovered {
    Mac mac;
    int64_t sent_us;
  };

  /// A phone allowed in, by identity address.
  struct KnownPhone {
    std::string addr;
    std::string name;
    Role role;
  };

  using Handler = Json (Gateway::*)(Phone &, const cJSON *args, const char *&error);

  Device *find_(std::string_view id);
  Device *find_mac_(const Mac &mac);
  Phone *phone_(uint16_t conn);
  void save_();
  void emit_device_(Device &d);
  /// The device as phones see it, with its active alarms.
  Json device_event_json_(const Device &d, int64_t now);
  void evaluate_rules_(Device &d);
  void emit_(const char *ev, Json data);
  void discovery_advert_(const Mac &mac, int8_t rssi, const Advert &ad);

  // Access (access.cpp).
  bool claimed_() const;
  KnownPhone *known_(const std::string &addr);
  bool pairing_open_() const { return p_.now_us() < pairing_until_us_; }
  Json access_json_(const Phone &p) const;
  /// Tells one phone what it may now do (an "access" event).
  void send_access_(const Phone &p);
  /// Tells a phone it isn't let in, before it's disconnected.
  void refuse_(const Phone &p, const char *reason);
  void load_phones_(const cJSON *cfg);
  void save_phones_(cJSON *cfg) const;

  // Sessions with connected devices (sessions.cpp).
  class Io;
  void add_session_(const Device &d);
  void remove_session_(const std::string &device_id);
  Session *session_(const std::string &device_id);
  Session *session_for_slot_(int slot);
  void run_sessions_(int64_t now);
  void end_session_(Session &s, Device &d, bool failed);

  Json op_hello_(Phone &, const cJSON *, const char *&);
  Json op_pair_(Phone &, const cJSON *, const char *&);
  Json op_claim_(Phone &, const cJSON *, const char *&);
  Json op_phones_list_(Phone &, const cJSON *, const char *&);
  Json op_phones_update_(Phone &, const cJSON *, const char *&);
  Json op_phones_remove_(Phone &, const cJSON *, const char *&);
  Json op_pairing_open_(Phone &, const cJSON *, const char *&);
  Json op_auth_challenge_(Phone &, const cJSON *, const char *&);
  Json op_auth_prove_(Phone &, const cJSON *, const char *&);
  Json op_snapshot_(Phone &, const cJSON *, const char *&);
  Json op_subscribe_(Phone &, const cJSON *, const char *&);
  Json op_config_get_(Phone &, const cJSON *, const char *&);
  Json op_device_add_(Phone &, const cJSON *, const char *&);
  Json op_device_update_(Phone &, const cJSON *, const char *&);
  Json op_device_remove_(Phone &, const cJSON *, const char *&);
  Json op_device_command_(Phone &, const cJSON *, const char *&);
  Json op_rule_put_(Phone &, const cJSON *, const char *&);
  Json op_rule_remove_(Phone &, const cJSON *, const char *&);
  Json op_gateway_update_(Phone &, const cJSON *, const char *&);
  Json op_discovery_start_(Phone &, const cJSON *, const char *&);
  Json op_discovery_stop_(Phone &, const cJSON *, const char *&);
  Json op_ota_begin_(Phone &, const cJSON *, const char *&);
  Json op_ota_send_begin_(Phone &, const cJSON *, const char *&);
  Json op_ota_send_data_(Phone &, const cJSON *, const char *&);
  Json op_ota_send_end_(Phone &, const cJSON *, const char *&);
  Json op_ota_send_abort_(Phone &, const cJSON *, const char *&);
  void abort_transfer_();
  Json op_reboot_(Phone &, const cJSON *, const char *&);
  Json op_reset_(Phone &, const cJSON *, const char *&);

  Platform p_;
  mutable std::recursive_mutex mutex_;
  std::string name_ = "OpenRV";
  std::string pin_;
  std::vector<std::unique_ptr<Device>> devices_;
  std::vector<RuleEntry> rules_;
  std::vector<std::unique_ptr<Session>> sessions_;
  int64_t last_refresh_us_ = 0;
  std::array<Phone, MAX_PHONES> phones_{};
  /// A firmware image coming over Bluetooth, and from which phone.
  struct Transfer {
    uint16_t conn = NO_CONN;
    size_t size = 0;
    size_t received = 0;
  } transfer_;
  std::vector<KnownPhone> known_phones_;
  int64_t pairing_until_us_ = 0;
  Role pairing_role_ = Role::GUEST;
  int64_t discovery_until_us_ = 0;
  std::vector<Discovered> discovered_;
  bool reboot_pending_ = false;
};

}  // namespace openrv
