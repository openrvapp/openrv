// Firmware updates over Bluetooth: an owner's phone sends the image in base64 pieces over the
// encrypted link (ota.send.*). Slower than the Wi-Fi window (ota.begin), but it needs nothing but
// the connection the phone already has, so it works the same everywhere. Writing, checking and
// switching to the new image is the platform's (components/ota), which validates the image and
// rolls back if it fails to start, as for Wi-Fi.
#include <cstring>

#include "esp_log.h"
#include "openrv/gateway.h"

namespace openrv {

namespace {

const char *const TAG = "transfer";

int base64_value(char c) {
  if (c >= 'A' && c <= 'Z')
    return c - 'A';
  if (c >= 'a' && c <= 'z')
    return c - 'a' + 26;
  if (c >= '0' && c <= '9')
    return c - '0' + 52;
  if (c == '+')
    return 62;
  if (c == '/')
    return 63;
  return -1;
}

/// Standard base64 (with padding); false on anything else.
bool base64_decode(const char *in, std::string &out) {
  size_t len = std::strlen(in);
  if (len % 4)
    return false;
  out.clear();
  out.reserve(len / 4 * 3);
  for (size_t i = 0; i < len; i += 4) {
    int v[4];
    for (int k = 0; k < 4; k++)
      v[k] = in[i + k] == '=' ? 0 : base64_value(in[i + k]);
    if (v[0] < 0 || v[1] < 0 || v[2] < 0 || v[3] < 0)
      return false;
    uint32_t n = v[0] << 18 | v[1] << 12 | v[2] << 6 | v[3];
    out += static_cast<char>(n >> 16);
    if (in[i + 2] != '=')
      out += static_cast<char>(n >> 8 & 0xFF);
    if (in[i + 3] != '=')
      out += static_cast<char>(n & 0xFF);
  }
  return true;
}

}  // namespace

Json Gateway::op_ota_send_begin_(Phone &phone, const cJSON *args, const char *&error) {
  const cJSON *size = cJSON_GetObjectItem(args, "size");
  if (!cJSON_IsNumber(size) || size->valuedouble <= 0 || !p_.ota_begin) {
    error = p_.ota_begin ? "bad_request" : "unsupported";
    return nullptr;
  }
  if (transfer_.conn != NO_CONN && transfer_.conn != phone.conn) {
    error = "busy";  // another phone is sending one
    return nullptr;
  }
  if (const char *err = p_.ota_begin(static_cast<size_t>(size->valuedouble))) {
    ESP_LOGW(TAG, "Can't start: %s", err);
    error = "refused";
    return nullptr;
  }
  transfer_ = {phone.conn, static_cast<size_t>(size->valuedouble), 0};
  ESP_LOGI(TAG, "Receiving %u bytes over Bluetooth", static_cast<unsigned>(transfer_.size));
  Json r = json_object();
  cJSON_AddNumberToObject(r.get(), "chunk", OTA_CHUNK);
  return r;
}

Json Gateway::op_ota_send_data_(Phone &phone, const cJSON *args, const char *&error) {
  const cJSON *offset = cJSON_GetObjectItem(args, "offset");
  const char *data = json_string(args, "data");
  std::string bytes;
  if (transfer_.conn != phone.conn) {
    error = "not_found";  // no transfer from this phone
    return nullptr;
  }
  if (!cJSON_IsNumber(offset) || !data || !base64_decode(data, bytes) || bytes.empty() ||
      bytes.size() > OTA_CHUNK) {
    error = "bad_request";
    return nullptr;
  }
  // Pieces arrive in order; a repeat of the last one (the phone retrying after a lost answer) is fine.
  size_t at = static_cast<size_t>(offset->valuedouble);
  if (at + bytes.size() == transfer_.received)
    return nullptr;
  if (at != transfer_.received || at + bytes.size() > transfer_.size) {
    error = "bad_request";
    return nullptr;
  }
  if (const char *err = p_.ota_write(reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size())) {
    ESP_LOGW(TAG, "Write failed at %u: %s", static_cast<unsigned>(at), err);
    p_.ota_abort();
    transfer_ = {};
    error = "internal";
    return nullptr;
  }
  transfer_.received += bytes.size();
  return nullptr;
}

Json Gateway::op_ota_send_end_(Phone &phone, const cJSON *, const char *&error) {
  if (transfer_.conn != phone.conn || transfer_.received != transfer_.size) {
    error = transfer_.conn == phone.conn ? "bad_request" : "not_found";
    return nullptr;
  }
  const char *err = p_.ota_finish();  // checks the image, switches to it, restarts in a moment
  transfer_ = {};
  if (err) {
    ESP_LOGW(TAG, "Image rejected: %s", err);
    error = "refused";
    return nullptr;
  }
  ESP_LOGI(TAG, "Update written; restarting");
  return nullptr;
}

Json Gateway::op_ota_send_abort_(Phone &phone, const cJSON *, const char *&) {
  if (transfer_.conn == phone.conn)
    abort_transfer_();
  return nullptr;
}

void Gateway::abort_transfer_() {
  if (transfer_.conn == NO_CONN)
    return;
  ESP_LOGI(TAG, "Transfer stopped after %u of %u bytes", static_cast<unsigned>(transfer_.received),
           static_cast<unsigned>(transfer_.size));
  if (p_.ota_abort)
    p_.ota_abort();
  transfer_ = {};
}

}  // namespace openrv
