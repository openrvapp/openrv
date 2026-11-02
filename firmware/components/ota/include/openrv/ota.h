#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

/// Firmware updates without internet: the gateway opens its own Wi-Fi access point for a few
/// minutes, the phone joins it and POSTs the image. Every window gets a fresh Wi-Fi password and a
/// one-time upload token, both handed out only over the PIN-checked Bluetooth link.
namespace openrv::ota {

struct Window {
  std::string ssid;
  std::string password;
  std::string url;    // POST the raw .bin here
  std::string token;  // as "Authorization: Bearer <token>"
  int seconds_left;
};

/// Opens the window (or extends an open one) for `minutes`; nullopt if Wi-Fi failed to start.
std::optional<Window> begin(int minutes);
/// Closes the window and turns Wi-Fi off.
void end();
/// Whether an update is under way, by Wi-Fi or Bluetooth (the status LED shows it).
bool active();

/// Firmware over Bluetooth: the gateway's ota.send.* ops pass the image on piece by piece. Each
/// returns an error message, or null. Finishing checks the image, switches to it and restarts.
const char *receive_begin(size_t size);
const char *receive_write(const uint8_t *data, size_t len);
const char *receive_finish();
void receive_abort();

}  // namespace openrv::ota
