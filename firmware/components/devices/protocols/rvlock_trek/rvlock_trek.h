#pragma once

#include <optional>
#include <vector>

#include "openrv/advert.h"

/// RVLock Trek keyless entry lock (docs/devices/rvlock-trek.md). Frames are
/// 7E [len] [payload...] [sum]; len counts the bytes after it (sum included) and sum is the low
/// byte of the sum of everything before it. Each connection starts with the password frame
/// captured from the RVLock app, kept as an opaque blob (its last byte breaks the sum rule).
namespace openrv::rvlock {

constexpr uint16_t SERVICE_UUID16 = 0x1000;
constexpr uint16_t WRITE_UUID16 = 0x1001;
constexpr uint16_t NOTIFY_UUID16 = 0x1002;
constexpr size_t MAX_PASSWORD_LEN = 32;

enum class Action : uint8_t { LOCK = 0x00, UNLOCK = 0x01 };  // confirmed on a real lock 2026-10-26

/// 7E 06 01 03 03 [action] 00 [sum].
std::vector<uint8_t> build_action(Action a);
/// The action an echoed action frame confirms; nullopt for any other frame.
std::optional<Action> decode_action(Bytes frame);
/// True for a well-formed frame from the lock, such as its answer to the password.
bool is_frame(Bytes frame);
/// Checks a password frame (start byte and length only).
bool valid_password(Bytes frame);

}  // namespace openrv::rvlock
