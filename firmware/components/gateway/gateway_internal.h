#pragma once

// Shared by the gateway core's source files.
#include <cstddef>
#include <cstdint>
#include <string>

namespace openrv {

constexpr size_t MAX_NAME = 32;

std::string to_hex(const uint8_t *b, size_t n);
/// HMAC-SHA256(key, message = nonce), first 16 bytes: proves knowing a PIN or setup code.
bool pin_proof(const std::string &key, const uint8_t *nonce, size_t nonce_len, uint8_t out[16]);

}  // namespace openrv
