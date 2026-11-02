#include "gopower_pwm.h"

namespace openrv::gopower {

namespace {
constexpr int FRAME_MARKER = 0x50;
constexpr size_t MAX_BUFFER = 512;

int hex_digit(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;
  return -1;
}

/// Tokens of one or two hex digits, separated by ';', CR or LF; anything else is skipped.
std::vector<int> tokens(const std::string &s) {
  std::vector<int> values;
  size_t start = 0;
  while (start <= s.size()) {
    size_t end = s.find_first_of(";\r\n", start);
    if (end == std::string::npos)
      end = s.size();
    size_t len = end - start;
    if (len == 1 || len == 2) {
      int hi = hex_digit(s[start]);
      int lo = len == 2 ? hex_digit(s[start + 1]) : 0;
      if (hi >= 0 && lo >= 0)
        values.push_back(len == 2 ? hi * 16 + lo : hi);
    }
    start = end + 1;
  }
  return values;
}
}  // namespace

uint16_t modbus_crc16(Bytes data) {
  uint16_t crc = 0xFFFF;
  for (uint8_t b : data) {
    crc ^= b;
    for (int i = 0; i < 8; i++)
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

std::array<uint8_t, 8> build_poll(uint8_t slave) {
  std::array<uint8_t, 8> r{slave, 0x03, 0x01, 0x00, 0x00, 0x21, 0, 0};
  uint16_t crc = modbus_crc16({r.data(), 6});
  r[6] = static_cast<uint8_t>(crc);
  r[7] = static_cast<uint8_t>(crc >> 8);
  return r;
}

std::optional<Reading> Parser::feed(Bytes notification) {
  buffer_.append(reinterpret_cast<const char *>(notification.data()), notification.size());
  if (buffer_.size() > MAX_BUFFER)
    buffer_.erase(0, buffer_.size() - MAX_BUFFER / 2);

  auto v = tokens(buffer_);
  // Search from the newest data backwards for a frame that passes sanity checks.
  for (int i = static_cast<int>(v.size()) - static_cast<int>(FRAME_LEN); i >= 0; i--) {
    if (v[i] != FRAME_MARKER)
      continue;
    float battery_v = v[i + 3] * 0.1f;
    float charge_a = v[i + 9] * 0.01f;
    float solar_v = static_cast<float>(v[i + 13]);
    if (battery_v < 10.0f || battery_v > 16.5f || charge_a > 60 || solar_v > 30)
      continue;

    Reading r{
        .battery_pct = static_cast<uint8_t>(v[i]),
        .battery_v = battery_v,
        .charge_a = charge_a,
        .solar_v = solar_v,
        .solar_w = solar_v * charge_a,
        .charge_state = static_cast<uint8_t>(v[i + 14]),
        .raw = {},
    };
    for (size_t k = 0; k < FRAME_LEN; k++)
      r.raw[k] = static_cast<uint8_t>(v[i + k]);
    buffer_.clear();
    return r;
  }
  return std::nullopt;
}

}  // namespace openrv::gopower
