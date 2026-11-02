// Reads the setup code the web flasher wrote (website/assets/setup.js writes the same block).
#include "setup_code.h"

#include <cstdint>
#include <cstring>

#include "esp_log.h"
#include "esp_partition.h"

namespace {

const char *const TAG = "setup";

uint32_t crc32(const uint8_t *data, size_t len) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++)
      crc = (crc >> 1) ^ (0xEDB88320 & (0 - (crc & 1)));
  }
  return ~crc;
}

}  // namespace

std::string load_setup_code() {
  const esp_partition_t *part =
      esp_partition_find_first(ESP_PARTITION_TYPE_DATA, static_cast<esp_partition_subtype_t>(0x40), "setup");
  uint8_t b[64];
  if (!part || esp_partition_read(part, 0, b, sizeof b) != ESP_OK)
    return {};
  size_t len = b[5];
  if (std::memcmp(b, "ORVS", 4) != 0 || b[4] != 1 || len < 6 || len > 32)
    return {};
  uint32_t stored = b[6 + len] | b[7 + len] << 8 | b[8 + len] << 16 | static_cast<uint32_t>(b[9 + len]) << 24;
  if (crc32(b, 6 + len) != stored) {
    ESP_LOGW(TAG, "Setup code is damaged; claim the gateway with its button instead");
    return {};
  }
  return std::string(reinterpret_cast<const char *>(b + 6), len);
}
