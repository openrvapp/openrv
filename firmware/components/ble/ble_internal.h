#pragma once

#include <cstdint>

#include "host/ble_hs.h"

namespace openrv {
class Gateway;
}

/// Shared between ble.cpp (scanner, phone service) and links.cpp (device connections).
namespace openrv::ble::detail {

extern Gateway *g_gateway;
extern uint8_t g_own_addr_type;
/// (Re)starts the scanner; connecting to a device pauses it.
void start_scan();
/// Remembers a device's address type from its adverts, for connecting to it later.
void note_addr(const ble_addr_t &addr);

}  // namespace openrv::ble::detail
