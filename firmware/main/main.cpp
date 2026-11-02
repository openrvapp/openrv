// OpenRV gateway: wires the gateway core to NimBLE and NVS, then ticks it every 100 ms.
#include <cstdio>
#include <string>

#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_ota_ops.h"
#include "esp_heap_caps.h"
#include "esp_psram.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"

#include "openrv/ble.h"
#include "openrv/board.h"
#include "openrv/gateway.h"
#include "openrv/ota.h"
#include "setup_code.h"

namespace {

const char *const TAG = "main";
const char *const NVS_NAMESPACE = "openrv";
const char *const NVS_CONFIG_KEY = "config";

/// The Bluetooth address phones see, as AA:BB:CC:DD:EE:FF.
std::string bluetooth_mac() {
  uint8_t mac[6] = {};
  if (esp_read_mac(mac, ESP_MAC_BT) != ESP_OK)
    return {};
  char text[18];
  std::snprintf(text, sizeof text, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return text;
}

std::string load_config() {
  nvs_handle_t h;
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK)
    return {};
  size_t len = 0;
  std::string s;
  if (nvs_get_str(h, NVS_CONFIG_KEY, nullptr, &len) == ESP_OK && len > 0) {
    s.resize(len);
    nvs_get_str(h, NVS_CONFIG_KEY, s.data(), &len);
    s.resize(len - 1);  // drop the terminator
  }
  nvs_close(h);
  return s;
}

void save_config(const std::string &json) {
  nvs_handle_t h;
  if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) != ESP_OK)
    return;
  esp_err_t err = nvs_set_str(h, NVS_CONFIG_KEY, json.c_str());
  if (err == ESP_OK)
    err = nvs_commit(h);
  nvs_close(h);
  if (err != ESP_OK)
    ESP_LOGE(TAG, "Saving the configuration failed: %s", esp_err_to_name(err));
}

void init_nvs() {
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  ESP_ERROR_CHECK(err);
}

}  // namespace

extern "C" void app_main() {
  init_nvs();

  static openrv::Gateway gateway(openrv::Platform{
      .send = openrv::ble::send,
      .now_us = esp_timer_get_time,
      .random = esp_fill_random,
      .load_config = load_config,
      .save_config = save_config,
      .reboot =
          [] {
            vTaskDelay(pdMS_TO_TICKS(300));  // let the reply go out
            esp_restart();
          },
      .links = &openrv::ble::links(),
      .ota_window =
          [](int minutes) {
            if (minutes == 0) {
              openrv::ota::end();
              return openrv::Json();
            }
            auto w = openrv::ota::begin(minutes);
            if (!w)
              return openrv::Json();
            openrv::Json r = openrv::json_object();
            cJSON_AddStringToObject(r.get(), "ssid", w->ssid.c_str());
            cJSON_AddStringToObject(r.get(), "password", w->password.c_str());
            cJSON_AddStringToObject(r.get(), "url", w->url.c_str());
            cJSON_AddStringToObject(r.get(), "token", w->token.c_str());
            cJSON_AddNumberToObject(r.get(), "expires_s", w->seconds_left);
            return r;
          },
      .ota_begin = openrv::ota::receive_begin,
      .ota_write = openrv::ota::receive_write,
      .ota_finish = openrv::ota::receive_finish,
      .ota_abort = openrv::ota::receive_abort,
      .firmware_version = esp_app_get_description()->version,
      .mac = bluetooth_mac(),
      .pair = openrv::ble::pair,
      .drop = openrv::ble::drop,
      .prune_bonds = openrv::ble::prune_bonds,
      .setup_code = load_setup_code(),
  });
  gateway.load();
  openrv::ble::start(gateway);
  openrv::board::start(gateway);

  // The radio came up, so this image is good: cancel the rollback a fresh OTA image is armed with.
  esp_ota_mark_app_valid_cancel_rollback();
  ESP_LOGI(TAG, "OpenRV gateway %s running, %s", esp_app_get_description()->version,
           gateway.status().claimed ? "owned" : "waiting for an owner");
#if CONFIG_SPIRAM
  if (esp_psram_is_initialized())
    ESP_LOGI(TAG, "PSRAM: %u KB", static_cast<unsigned>(esp_psram_get_size() / 1024));
  else
#endif
    ESP_LOGI(TAG, "No PSRAM: running from internal RAM");
  // How much room is left where it's tightest; boards without PSRAM have only this.
  ESP_LOGI(TAG, "Free internal RAM: %u KB (lowest %u KB)",
           static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024),
           static_cast<unsigned>(heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024));

  while (true) {
    vTaskDelay(pdMS_TO_TICKS(100));
    gateway.tick();
  }
}
