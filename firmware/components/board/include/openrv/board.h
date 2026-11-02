#pragma once

namespace openrv {

class Gateway;

/// The gateway's own button and status LED.
///
/// Button (BOOT on most boards):
///   - a short press shows the status brightly for a few seconds;
///   - held 3 s: a phone may pair for 2 minutes (on a new gateway, that phone becomes its owner);
///   - held 10 s: factory reset, back to how it was when flashed (devices, alerts, phones, PIN).
///
/// LED, kept dim: breathing green idle, steady green with a phone connected, breathing cyan when no
/// one owns it yet, blinking blue while pairing, amber with a warning, blinking red with a critical
/// alert, purple during a firmware update.
namespace board {

void start(Gateway &gateway);

}  // namespace board
}  // namespace openrv
