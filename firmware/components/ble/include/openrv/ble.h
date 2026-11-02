#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace openrv {

class Gateway;
class LinkIo;

/// NimBLE: the scanner that feeds adverts to the gateway, and the OpenRV GATT service for phones
/// (RX write / TX notify, one JSON message per line).
namespace ble {

void start(Gateway &gateway);
/// Queues one protocol line for a phone; safe from any task.
void send(uint16_t conn, const std::string &line);
/// Device connections for the gateway's sessions.
LinkIo &links();

// Pairing with phones, for the gateway's Platform.
/// Asks a phone to pair (or, when it already has a bond, just to encrypt).
void pair(uint16_t conn);
/// Disconnects a phone.
void drop(uint16_t conn);
/// Deletes every bond except these identity addresses (AA:BB:...).
void prune_bonds(const std::vector<std::string> &keep);

}  // namespace ble
}  // namespace openrv
