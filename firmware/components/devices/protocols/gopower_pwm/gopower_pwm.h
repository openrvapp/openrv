#pragma once

#include <array>
#include <optional>
#include <string>
#include <vector>

#include "openrv/advert.h"

/// Go Power GP-SB-PWM-30-BT / GP-PWM-30-SB solar controller.
///
/// EXPERIMENTAL and not yet tested with OpenRV: reverse-engineered from one unit by
/// bigthrilla/camper-ble-bridge (MIT, see THIRD_PARTY_NOTICES.md). The gateway sends a
/// Modbus-style read and the controller answers with ASCII, semicolon-separated hex values
/// spread over several notifications.
namespace openrv::gopower {

constexpr uint16_t SERVICE_UUID16 = 0xFFF0;
constexpr uint16_t NOTIFY_UUID16 = 0xFFF1;
constexpr uint16_t WRITE_UUID16 = 0xFFF2;
constexpr uint16_t DEFAULT_POLL_S = 60;
constexpr size_t FRAME_LEN = 16;

struct Reading {
  uint8_t battery_pct;
  float battery_v;
  float charge_a;
  float solar_v;
  float solar_w;
  uint8_t charge_state;
  std::array<uint8_t, FRAME_LEN> raw;
};

uint16_t modbus_crc16(Bytes data);
/// The "read home screen" request for a Modbus slave address (1-8).
std::array<uint8_t, 8> build_poll(uint8_t slave = 1);

class Parser {
 public:
  /// Feed one notification; returns a reading once a plausible frame is complete.
  std::optional<Reading> feed(Bytes notification);
  void reset() { buffer_.clear(); }

 private:
  std::string buffer_;
};

}  // namespace openrv::gopower
