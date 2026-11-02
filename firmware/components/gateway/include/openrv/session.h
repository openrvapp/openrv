#pragma once

#include <deque>
#include <memory>
#include <string>

#include "openrv/device.h"

/// Connected devices (cooler, lock, solar controller): the gateway connects for short sessions,
/// on a schedule or when a command is waiting, so the device's own phone app can still use it
/// in between. The device's driver speaks its protocol during a session (Handler, driver.h).
namespace openrv {

constexpr int MAX_LINKS = 3;

/// The radio side of device connections (NimBLE, in components/ble). Results come back through
/// Gateway::on_link_open / on_link_data / on_link_closed.
class LinkIo {
 public:
  virtual ~LinkIo() = default;
  /// Starts connecting `slot`; false when the radio can't start one now (try again later).
  virtual bool open(int slot, const LinkSpec &spec) = 0;
  virtual bool write(int slot, Bytes data) = 0;
  virtual void close(int slot) = 0;
};

struct Session {
  enum class State : uint8_t { IDLE, OPENING, OPEN, CLOSING };

  std::string device;  // device id
  Handler *handler = nullptr;  // the device's driver; the device outlives its session
  State state = State::IDLE;
  int slot = -1;
  bool scheduled = false;
  bool got_data = false;
  int64_t next_us = 0;      // next scheduled session; 0 = as soon as possible
  int64_t deadline_us = 0;  // the current step gives up at this time
  std::deque<Command> commands;
};

}  // namespace openrv
