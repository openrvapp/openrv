#include "openrv/ota.h"

#include <cstring>
#include <mutex>

#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_ota_ops.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"

namespace openrv::ota {

namespace {

const char *const TAG = "ota";
constexpr char ADDRESS[] = "192.168.4.1";
constexpr size_t PASSWORD_LEN = 12;
constexpr size_t TOKEN_BYTES = 16;

std::mutex g_mutex;
bool g_wifi_ready = false;
httpd_handle_t g_server = nullptr;
esp_timer_handle_t g_close_timer = nullptr;
esp_timer_handle_t g_restart_timer = nullptr;
Window g_window;
int64_t g_until_us = 0;

std::string random_text(size_t len, const char *alphabet) {
  size_t n = std::strlen(alphabet);
  std::string s(len, ' ');
  for (auto &c : s)
    c = alphabet[esp_random() % n];
  return s;
}

std::string random_hex(size_t bytes) {
  uint8_t b[32];
  esp_fill_random(b, bytes);
  static const char HEX[] = "0123456789abcdef";
  std::string s;
  for (size_t i = 0; i < bytes; i++) {
    s += HEX[b[i] >> 4];
    s += HEX[b[i] & 15];
  }
  return s;
}

/// POST /update: the raw firmware image, with the window's token.
esp_err_t on_update(httpd_req_t *req) {
  ESP_LOGI(TAG, "Upload request, %d bytes", req->content_len);
  char auth[80] = {};
  std::string expected;
  {
    std::lock_guard lock(g_mutex);
    expected = "Bearer " + g_window.token;
  }
  if (httpd_req_get_hdr_value_str(req, "Authorization", auth, sizeof auth) != ESP_OK || expected != auth) {
    ESP_LOGW(TAG, "Upload refused: wrong token");
    httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "bad token");
    return ESP_OK;
  }

  const esp_partition_t *part = esp_ota_get_next_update_partition(nullptr);
  esp_ota_handle_t handle;
  if (!part || esp_ota_begin(part, OTA_SIZE_UNKNOWN, &handle) != ESP_OK) {
    httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "no update partition");
    return ESP_OK;
  }
  ESP_LOGI(TAG, "Receiving %d bytes into %s", req->content_len, part->label);

  static char buf[4096];
  int remaining = req->content_len;
  while (remaining > 0) {
    int n = httpd_req_recv(req, buf, std::min<int>(remaining, sizeof buf));
    if (n == HTTPD_SOCK_ERR_TIMEOUT)
      continue;
    if (n <= 0 || esp_ota_write(handle, buf, n) != ESP_OK) {
      ESP_LOGW(TAG, "Upload failed with %d bytes to go (recv %d)", remaining, n);
      esp_ota_abort(handle);
      httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "upload failed");
      return ESP_OK;
    }
    remaining -= n;
  }
  // esp_ota_end checks the image (magic, segments, SHA-256 appended by the build).
  if (esp_err_t err = esp_ota_end(handle); err != ESP_OK || esp_ota_set_boot_partition(part) != ESP_OK) {
    ESP_LOGW(TAG, "Image rejected: %s", esp_err_to_name(err));
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "not a valid firmware image");
    return ESP_OK;
  }
  ESP_LOGI(TAG, "Update written; restarting");
  httpd_resp_sendstr(req, "ok");
  // The new image confirms itself once its Bluetooth is up; otherwise the bootloader rolls back.
  esp_timer_start_once(g_restart_timer, 1000 * 1000);
  return ESP_OK;
}

esp_err_t on_index(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/plain");
  httpd_resp_sendstr(req, "OpenRV gateway: POST the firmware image to /update.");
  return ESP_OK;
}

bool start_wifi() {
  if (!g_wifi_ready) {
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&init) != ESP_OK)
      return false;
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    g_wifi_ready = true;
  }

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
  char ssid[20];
  std::snprintf(ssid, sizeof ssid, "OpenRV-%02X%02X", mac[4], mac[5]);
  g_window.ssid = ssid;
  g_window.password = random_text(PASSWORD_LEN, "abcdefghjkmnpqrstuvwxyz23456789");  // no look-alikes

  wifi_config_t cfg{};
  std::memcpy(cfg.ap.ssid, g_window.ssid.data(), g_window.ssid.size());
  cfg.ap.ssid_len = g_window.ssid.size();
  std::memcpy(cfg.ap.password, g_window.password.data(), g_window.password.size());
  cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
  cfg.ap.channel = 6;
  cfg.ap.max_connection = 1;
  return esp_wifi_set_mode(WIFI_MODE_AP) == ESP_OK && esp_wifi_set_config(WIFI_IF_AP, &cfg) == ESP_OK &&
         esp_wifi_start() == ESP_OK;
}

bool start_server() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.recv_wait_timeout = 15;
  if (httpd_start(&g_server, &config) != ESP_OK)
    return false;
  static const httpd_uri_t update{.uri = "/update", .method = HTTP_POST, .handler = on_update, .user_ctx = nullptr};
  static const httpd_uri_t index{.uri = "/", .method = HTTP_GET, .handler = on_index, .user_ctx = nullptr};
  httpd_register_uri_handler(g_server, &update);
  httpd_register_uri_handler(g_server, &index);
  return true;
}

void close_now() {
  if (g_server) {
    httpd_stop(g_server);
    g_server = nullptr;
  }
  if (g_until_us) {
    esp_wifi_stop();
    g_until_us = 0;
    ESP_LOGI(TAG, "Update window closed");
  }
}

}  // namespace

std::optional<Window> begin(int minutes) {
  std::lock_guard lock(g_mutex);
  if (!g_close_timer) {
    const esp_timer_create_args_t close{.callback = [](void *) {
                                          std::lock_guard l(g_mutex);
                                          close_now();
                                        },
                                        .arg = nullptr,
                                        .dispatch_method = ESP_TIMER_TASK,
                                        .name = "ota_close",
                                        .skip_unhandled_events = true};
    const esp_timer_create_args_t restart{.callback = [](void *) { esp_restart(); },
                                          .arg = nullptr,
                                          .dispatch_method = ESP_TIMER_TASK,
                                          .name = "ota_restart",
                                          .skip_unhandled_events = true};
    esp_timer_create(&close, &g_close_timer);
    esp_timer_create(&restart, &g_restart_timer);
  }

  if (!g_until_us) {
    if (!start_wifi() || !start_server()) {
      ESP_LOGE(TAG, "Couldn't open the update window");
      close_now();
      return std::nullopt;
    }
    g_window.token = random_hex(TOKEN_BYTES);
    g_window.url = std::string("http://") + ADDRESS + "/update";
    ESP_LOGI(TAG, "Update window open: %s", g_window.ssid.c_str());
  }
  int64_t us = static_cast<int64_t>(minutes) * 60 * 1000000;
  g_until_us = esp_timer_get_time() + us;
  esp_timer_stop(g_close_timer);
  esp_timer_start_once(g_close_timer, us);
  g_window.seconds_left = minutes * 60;
  return g_window;
}

void end() {
  std::lock_guard lock(g_mutex);
  if (g_close_timer)
    esp_timer_stop(g_close_timer);
  close_now();
}

// ---- Over Bluetooth: the gateway hands over the image piece by piece ----

namespace {

esp_ota_handle_t g_ble_handle = 0;
const esp_partition_t *g_ble_part = nullptr;

void restart_soon() {
  // Leave time for the answer to reach the phone. The new image confirms itself once its
  // Bluetooth is up; otherwise the bootloader goes back to this one.
  static esp_timer_handle_t timer = nullptr;
  if (!timer) {
    const esp_timer_create_args_t args{.callback = [](void *) { esp_restart(); },
                                       .arg = nullptr,
                                       .dispatch_method = ESP_TIMER_TASK,
                                       .name = "ota_restart_ble",
                                       .skip_unhandled_events = true};
    esp_timer_create(&args, &timer);
  }
  esp_timer_start_once(timer, 1500 * 1000);
}

}  // namespace

const char *receive_begin(size_t size) {
  std::lock_guard lock(g_mutex);
  if (g_ble_part)
    esp_ota_abort(g_ble_handle);
  g_ble_part = esp_ota_get_next_update_partition(nullptr);
  if (!g_ble_part)
    return "no update partition";
  if (size > g_ble_part->size) {
    g_ble_part = nullptr;
    return "image too large";
  }
  if (esp_ota_begin(g_ble_part, size, &g_ble_handle) != ESP_OK) {
    g_ble_part = nullptr;
    return "can't erase the update partition";
  }
  ESP_LOGI(TAG, "Receiving %u bytes into %s over Bluetooth", static_cast<unsigned>(size), g_ble_part->label);
  return nullptr;
}

const char *receive_write(const uint8_t *data, size_t len) {
  std::lock_guard lock(g_mutex);
  if (!g_ble_part)
    return "not started";
  return esp_ota_write(g_ble_handle, data, len) == ESP_OK ? nullptr : "write failed";
}

const char *receive_finish() {
  std::lock_guard lock(g_mutex);
  if (!g_ble_part)
    return "not started";
  const esp_partition_t *part = g_ble_part;
  g_ble_part = nullptr;
  // esp_ota_end checks the image (magic, segments, SHA-256 appended by the build).
  if (esp_err_t err = esp_ota_end(g_ble_handle); err != ESP_OK)
    return "not a valid firmware image";
  if (esp_ota_set_boot_partition(part) != ESP_OK)
    return "can't switch to the new image";
  restart_soon();
  return nullptr;
}

void receive_abort() {
  std::lock_guard lock(g_mutex);
  if (g_ble_part)
    esp_ota_abort(g_ble_handle);
  g_ble_part = nullptr;
}

bool active() {
  std::lock_guard lock(g_mutex);
  return g_until_us > esp_timer_get_time() || g_ble_part != nullptr;
}

}  // namespace openrv::ota
