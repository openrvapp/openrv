#include "rvlock_trek.h"

#include <algorithm>

namespace openrv::rvlock {

namespace {
constexpr uint8_t START = 0x7E;
constexpr uint8_t ACTION_HEADER[] = {0x7E, 0x06, 0x01, 0x03, 0x03};

uint8_t sum(Bytes b) {
  unsigned s = 0;
  for (uint8_t v : b)
    s += v;
  return static_cast<uint8_t>(s);
}
}  // namespace

std::vector<uint8_t> build_action(Action a) {
  std::vector<uint8_t> f(std::begin(ACTION_HEADER), std::end(ACTION_HEADER));
  f.push_back(static_cast<uint8_t>(a));
  f.push_back(0x00);
  f.push_back(sum(f));
  return f;
}

std::optional<Action> decode_action(Bytes f) {
  if (f.size() != 8 || !std::equal(std::begin(ACTION_HEADER), std::end(ACTION_HEADER), f.begin()) || f[6] != 0 ||
      f[7] != sum(f.first(7)) || f[5] > 1)
    return std::nullopt;
  return static_cast<Action>(f[5]);
}

bool is_frame(Bytes f) {
  return f.size() >= 3 && f[0] == START && f[1] + 2u == f.size() && f.back() == sum(f.first(f.size() - 1));
}

bool valid_password(Bytes f) {
  return f.size() >= 3 && f.size() <= MAX_PASSWORD_LEN && f[0] == START && f[1] + 2u == f.size();
}

}  // namespace openrv::rvlock
