#pragma once

#include <optional>
#include <vector>

#include "openrv/advert.h"

/// Alpicool-protocol coolers (Renogy, Brass Monkey, Alpicool and others).
/// Protocol from klightspeed/BrassMonkeyFridgeMonitor (MIT), see THIRD_PARTY_NOTICES.md.
/// Frame: FE FE [len] [cmd] [data...] [sum hi] [sum lo]; len counts cmd + data + checksum,
/// and the checksum is the 16-bit sum of every byte before it.
namespace openrv::alpicool {

constexpr uint16_t SERVICE_UUID16 = 0x1234;
constexpr uint16_t WRITE_UUID16 = 0x1235;
constexpr uint16_t NOTIFY_UUID16 = 0x1236;

enum Command : uint8_t { CMD_BIND = 0x00, CMD_QUERY = 0x01, CMD_SET = 0x02, CMD_RESET = 0x04, CMD_SET_LEFT = 0x05, CMD_SET_RIGHT = 0x06 };
enum class RunMode : uint8_t { MAX = 0, ECO = 1 };
enum class BatterySaver : uint8_t { LOW = 0, MID = 1, HIGH = 2 };
enum class Unit : uint8_t { C = 0, F = 1 };

struct Zone {
  int8_t target;
  int8_t hysteresis;
  int8_t correction_hot, correction_mid, correction_cold, correction_halt;
  int8_t current;
};

/// Settings and status from a query. Temperatures are in the cooler's own unit.
struct Status {
  bool locked;
  bool powered_on;
  RunMode run_mode;
  BatterySaver battery_saver;
  int8_t max_temp, min_temp;
  uint8_t start_delay_min;
  Unit unit;
  Zone left;
  std::optional<uint8_t> battery_pct;  // unset when the cooler reports 0x7F
  float battery_v;
  std::optional<Zone> right;  // dual-zone coolers only
};

/// The gateway reports and stores temperatures in Celsius; these convert to and from the cooler's unit.
inline float to_celsius(const Status &s, float t) { return s.unit == Unit::F ? (t - 32) * 5 / 9 : t; }
/// A Celsius setpoint in the cooler's unit, rounded to its whole degrees and kept within its range.
inline int8_t from_celsius(const Status &s, double c) {
  double t = s.unit == Unit::F ? c * 9 / 5 + 32 : c;
  t = t < s.min_temp ? s.min_temp : t > s.max_temp ? s.max_temp : t;
  return static_cast<int8_t>(t < 0 ? t - 0.5 : t + 0.5);
}

struct Frame {
  uint8_t command;
  std::vector<uint8_t> data;
};

std::vector<uint8_t> build_frame(uint8_t command, Bytes data);
inline std::vector<uint8_t> build_query() { return build_frame(CMD_QUERY, {}); }
/// Full settings write; build it from the latest status with the fields to change edited.
std::vector<uint8_t> build_set(const Status &s);
std::optional<Frame> parse_frame(Bytes frame);
/// Decodes the data of a query, set or reset response.
std::optional<Status> decode_status(Bytes data);

/// These coolers advertise "A1-" followed by their own address, e.g. A1-9477F22E28EE.
bool looks_like(const Advert &ad, const uint8_t mac[6]);

/// Reassembles frames that the cooler splits across notifications.
class Assembler {
 public:
  std::vector<Frame> feed(Bytes notification);
  void reset() { pending_.clear(); }

 private:
  std::vector<uint8_t> pending_;
};

}  // namespace openrv::alpicool
