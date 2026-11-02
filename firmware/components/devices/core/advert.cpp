#include "openrv/advert.h"

namespace openrv {

template <typename F> void Advert::each_(F &&f) const {
  size_t i = 0;
  while (i < raw_.size()) {
    uint8_t len = raw_[i];
    if (len == 0 || i + 1 + len > raw_.size())
      return;
    if (!f(raw_[i + 1], raw_.subspan(i + 2, len - 1)))
      return;
    i += 1 + len;
  }
}

std::optional<Bytes> Advert::find(uint8_t type) const {
  std::optional<Bytes> found;
  each_([&](uint8_t t, Bytes data) {
    if (t != type)
      return true;
    found = data;
    return false;
  });
  return found;
}

int Advert::count(uint8_t type) const {
  int n = 0;
  each_([&](uint8_t t, Bytes) {
    n += t == type;
    return true;
  });
  return n;
}

std::optional<ManufacturerData> Advert::manufacturer() const {
  auto data = find(AD_MANUFACTURER);
  if (!data || data->size() < 2)
    return std::nullopt;
  return ManufacturerData{static_cast<uint16_t>((*data)[0] | ((*data)[1] << 8)), data->subspan(2)};
}

std::string_view Advert::name() const {
  auto data = find(AD_COMPLETE_NAME);
  if (!data)
    data = find(AD_SHORT_NAME);
  if (!data)
    return {};
  return {reinterpret_cast<const char *>(data->data()), data->size()};
}

}  // namespace openrv
