#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <string_view>

namespace openrv {

using Bytes = std::span<const uint8_t>;

/// One manufacturer-specific AD structure: the company ID and the bytes after it.
struct ManufacturerData {
  uint16_t company_id;
  Bytes data;
};

/// Walks the AD structures ([len][type][data...]) of an advertisement plus scan response.
class Advert {
 public:
  static constexpr uint8_t AD_SHORT_NAME = 0x08;
  static constexpr uint8_t AD_COMPLETE_NAME = 0x09;
  static constexpr uint8_t AD_SERVICE_DATA_16 = 0x16;
  static constexpr uint8_t AD_MANUFACTURER = 0xFF;

  explicit Advert(Bytes raw) : raw_(raw) {}

  /// The data of the first structure of this type, if any.
  std::optional<Bytes> find(uint8_t type) const;
  /// How many structures of this type there are.
  int count(uint8_t type) const;
  std::optional<ManufacturerData> manufacturer() const;
  std::string_view name() const;

 private:
  template <typename F> void each_(F &&f) const;
  Bytes raw_;
};

}  // namespace openrv
