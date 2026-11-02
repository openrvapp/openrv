#pragma once

#include <string>

/// The setup code the web flasher wrote into the "setup" partition (also in its QR code), which
/// lets the first phone claim the gateway; empty when there is none. A factory reset leaves it, as
/// reflashing would. Block: "ORVS", version 1, length, the code (A-Z, 2-9), CRC-32 of all that,
/// little-endian.
std::string load_setup_code();
