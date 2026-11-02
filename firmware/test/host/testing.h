// A minimal test harness for host tests, so they build with any C++20 compiler and no packages.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <string_view>
#include <vector>

namespace testing {

struct Case {
  const char *name;
  std::function<void()> fn;
};

inline std::vector<Case> &cases() {
  static std::vector<Case> all;
  return all;
}

inline int &failures() {
  static int n = 0;
  return n;
}

struct Register {
  Register(const char *name, std::function<void()> fn) { cases().push_back({name, std::move(fn)}); }
};

inline void fail(const char *file, int line, const char *expr) {
  std::printf("  %s:%d: failed: %s\n", file, line, expr);
  failures()++;
}

/// Bytes from hex text such as "fe fe 03"; spaces are ignored.
inline std::vector<uint8_t> hex(std::string_view s) {
  std::vector<uint8_t> out;
  int hi = -1;
  for (char c : s) {
    int v = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    if (v < 0)
      continue;
    if (hi < 0) {
      hi = v;
    } else {
      out.push_back(static_cast<uint8_t>(hi << 4 | v));
      hi = -1;
    }
  }
  return out;
}

inline int run_all() {
  int failed_cases = 0;
  for (auto &c : cases()) {
    int before = failures();
    c.fn();
    bool ok = failures() == before;
    failed_cases += !ok;
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", c.name);
  }
  std::printf("\n%zu tests, %d failed\n", cases().size(), failed_cases);
  return failed_cases ? 1 : 0;
}

}  // namespace testing

#define TEST(name)                                                   \
  static void name();                                                \
  static testing::Register name##_reg(#name, name);                  \
  static void name()

#define EXPECT_TRUE(x) \
  do {                 \
    if (!(x))          \
      testing::fail(__FILE__, __LINE__, #x); \
  } while (0)

#define EXPECT_EQ(a, b) EXPECT_TRUE((a) == (b))
#define EXPECT_NEAR(a, b, eps) EXPECT_TRUE(std::fabs(static_cast<double>(a) - static_cast<double>(b)) <= (eps))
