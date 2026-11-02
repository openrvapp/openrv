#include "alpicool.h"

#include <cstdio>

namespace openrv::alpicool {

namespace {
uint32_t sum(Bytes b) {
  uint32_t s = 0;
  for (uint8_t v : b)
    s += v;
  return s;
}

int find_header(const std::vector<uint8_t> &buf) {
  for (size_t i = 0; i + 1 < buf.size(); i++)
    if (buf[i] == 0xFE && buf[i + 1] == 0xFE)
      return static_cast<int>(i);
  return -1;
}

Zone zone_at(Bytes d, size_t target, size_t hysteresis, size_t corrections, size_t current) {
  return Zone{
      .target = static_cast<int8_t>(d[target]),
      .hysteresis = static_cast<int8_t>(d[hysteresis]),
      .correction_hot = static_cast<int8_t>(d[corrections]),
      .correction_mid = static_cast<int8_t>(d[corrections + 1]),
      .correction_cold = static_cast<int8_t>(d[corrections + 2]),
      .correction_halt = static_cast<int8_t>(d[corrections + 3]),
      .current = static_cast<int8_t>(d[current]),
  };
}
}  // namespace

std::vector<uint8_t> build_frame(uint8_t command, Bytes data) {
  std::vector<uint8_t> f{0xFE, 0xFE, static_cast<uint8_t>(1 + data.size() + 2), command};
  f.insert(f.end(), data.begin(), data.end());
  uint32_t s = sum(f);
  f.push_back(static_cast<uint8_t>(s >> 8));
  f.push_back(static_cast<uint8_t>(s));
  return f;
}

std::vector<uint8_t> build_set(const Status &s) {
  const Zone &l = s.left;
  std::vector<uint8_t> d{
      s.locked, s.powered_on, static_cast<uint8_t>(s.run_mode), static_cast<uint8_t>(s.battery_saver),
      static_cast<uint8_t>(l.target), static_cast<uint8_t>(s.max_temp), static_cast<uint8_t>(s.min_temp),
      static_cast<uint8_t>(l.hysteresis), s.start_delay_min, static_cast<uint8_t>(s.unit),
      static_cast<uint8_t>(l.correction_hot), static_cast<uint8_t>(l.correction_mid),
      static_cast<uint8_t>(l.correction_cold), static_cast<uint8_t>(l.correction_halt),
  };
  if (s.right) {
    const Zone &r = *s.right;
    // Right zone: target, 2 unused, hysteresis, 4 corrections, 3 unused.
    d.insert(d.end(), {static_cast<uint8_t>(r.target), 0, 0, static_cast<uint8_t>(r.hysteresis),
                       static_cast<uint8_t>(r.correction_hot), static_cast<uint8_t>(r.correction_mid),
                       static_cast<uint8_t>(r.correction_cold), static_cast<uint8_t>(r.correction_halt), 0, 0, 0});
  }
  return build_frame(CMD_SET, d);
}

std::optional<Frame> parse_frame(Bytes f) {
  if (f.size() < 6 || f[0] != 0xFE || f[1] != 0xFE || f[2] != f.size() - 3)
    return std::nullopt;
  uint32_t s = sum(f.first(f.size() - 2));
  uint16_t checksum = static_cast<uint16_t>((f[f.size() - 2] << 8) | f[f.size() - 1]);
  // Some firmware doubles the sum; the reference implementation accepts both.
  if (checksum != (s & 0xFFFF) && checksum != ((s * 2) & 0xFFFF))
    return std::nullopt;
  auto data = f.subspan(4, f.size() - 6);
  return Frame{f[3], {data.begin(), data.end()}};
}

std::optional<Status> decode_status(Bytes d) {
  if (d.size() < 18)
    return std::nullopt;
  Status s{
      .locked = d[0] != 0,
      .powered_on = d[1] != 0,
      .run_mode = static_cast<RunMode>(d[2]),
      .battery_saver = static_cast<BatterySaver>(d[3]),
      .max_temp = static_cast<int8_t>(d[5]),
      .min_temp = static_cast<int8_t>(d[6]),
      .start_delay_min = d[8],
      .unit = static_cast<Unit>(d[9]),
      .left = zone_at(d, 4, 7, 10, 14),
      .battery_pct = d[15] == 0x7F ? std::nullopt : std::optional<uint8_t>(d[15]),
      .battery_v = d[16] + d[17] / 10.0f,
      .right = std::nullopt,
  };
  // Dual-zone coolers append the right zone at 0x12 (0x13 and 0x14 unused).
  if (d.size() >= 27)
    s.right = zone_at(d, 18, 21, 22, 26);
  return s;
}

bool looks_like(const Advert &ad, const uint8_t mac[6]) {
  auto name = ad.name();
  if (name.size() != 15 || name.substr(0, 3) != "A1-")
    return false;
  char expected[13];
  snprintf(expected, sizeof expected, "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  for (size_t i = 0; i < 12; i++) {
    char c = name[3 + i];
    if (c >= 'a' && c <= 'f')
      c -= 'a' - 'A';
    if (c != expected[i])
      return false;
  }
  return true;
}

std::vector<Frame> Assembler::feed(Bytes notification) {
  pending_.insert(pending_.end(), notification.begin(), notification.end());
  std::vector<Frame> frames;
  while (true) {
    int start = find_header(pending_);
    if (start < 0) {
      // Keep a trailing FE: it may be the first half of the next header.
      bool keep_last = !pending_.empty() && pending_.back() == 0xFE;
      pending_.clear();
      if (keep_last)
        pending_.push_back(0xFE);
      break;
    }
    pending_.erase(pending_.begin(), pending_.begin() + start);
    if (pending_.size() < 3)
      break;
    size_t total = pending_[2] + 3u;
    if (pending_.size() < total)
      break;
    if (auto f = parse_frame({pending_.data(), total})) {
      frames.push_back(std::move(*f));
      pending_.erase(pending_.begin(), pending_.begin() + total);
    } else {
      pending_.erase(pending_.begin(), pending_.begin() + 2);  // bad frame: resynchronize
    }
  }
  return frames;
}

}  // namespace openrv::alpicool
