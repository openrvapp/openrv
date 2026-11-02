// The BOOT button and the RGB status LED. One task polls the button every 20 ms and redraws the
// LED from the gateway's status; a board without either (GPIO -1) just skips that part.
#include "openrv/board.h"

#include <algorithm>
#include <cstdint>

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

#include "openrv/gateway.h"
#include "openrv/ota.h"

#if CONFIG_OPENRV_LED_GPIO >= 0
#include "led_strip.h"
#endif

namespace openrv::board {

namespace {

const char *const TAG = "board";
constexpr int TICK_MS = 20;
constexpr int64_t PAIR_HOLD_MS = 3000;
constexpr int64_t RESET_HOLD_MS = 10000;
constexpr int64_t RESET_WARN_MS = 7000;  // the LED starts warning that a reset is coming
constexpr int PAIRING_S = 120;
constexpr int64_t SHOW_MS = 4000;  // how long a short press shows the status brightly
constexpr uint8_t DIM = 24;        // full brightness for the LED, out of 255; it lives in a dark RV
constexpr uint8_t BRIGHT = 120;

Gateway *g_gateway = nullptr;

struct Rgb {
  uint8_t r, g, b;
};
constexpr Rgb OFF{0, 0, 0};
constexpr Rgb GREEN{0, 255, 0};
constexpr Rgb CYAN{0, 200, 255};
constexpr Rgb BLUE{0, 40, 255};
constexpr Rgb AMBER{255, 110, 0};
constexpr Rgb RED{255, 0, 0};
constexpr Rgb PURPLE{170, 0, 255};

int64_t now_ms() { return esp_timer_get_time() / 1000; }

bool blink(int64_t t, int period_ms) { return (t % period_ms) < period_ms / 2; }

/// 0..1..0 over the period, for breathing.
float breathe(int64_t t, int period_ms) {
  float x = static_cast<float>(t % period_ms) / static_cast<float>(period_ms) * 2.0f;
  return 0.15f + 0.85f * (x < 1.0f ? x : 2.0f - x);
}

Rgb scale(Rgb c, float k) {
  auto f = [k](uint8_t v) { return static_cast<uint8_t>(std::clamp(v * k, 0.0f, 255.0f)); };
  return {f(c.r), f(c.g), f(c.b)};
}

#if CONFIG_OPENRV_LED_GPIO >= 0
led_strip_handle_t g_strip = nullptr;

void led_init() {
  led_strip_config_t cfg{};
  cfg.strip_gpio_num = CONFIG_OPENRV_LED_GPIO;
  cfg.max_leds = 1;
  cfg.led_model = LED_MODEL_WS2812;
  cfg.color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB;
  led_strip_rmt_config_t rmt{};
  rmt.clk_src = RMT_CLK_SRC_DEFAULT;
  rmt.resolution_hz = 10 * 1000 * 1000;
  if (led_strip_new_rmt_device(&cfg, &rmt, &g_strip) != ESP_OK) {
    ESP_LOGW(TAG, "No status LED on GPIO %d", CONFIG_OPENRV_LED_GPIO);
    g_strip = nullptr;
  }
}

void led_show(Rgb c) {
  static Rgb last{1, 2, 3};
  if (!g_strip || (c.r == last.r && c.g == last.g && c.b == last.b))
    return;
  last = c;
  led_strip_set_pixel(g_strip, 0, c.r, c.g, c.b);
  led_strip_refresh(g_strip);
}
#else
void led_init() {}
void led_show(Rgb) {}
#endif

/// What the LED shows while the button is held: a blue blink each second up to the pairing mark,
/// steady blue (let go now to pair), then red blinking faster and faster up to the reset.
Rgb held_colour(int64_t held) {
  if (held < PAIR_HOLD_MS)
    return (held % 1000) < 150 ? scale(BLUE, BRIGHT / 255.0f) : OFF;
  if (held < RESET_WARN_MS)
    return scale(BLUE, BRIGHT / 255.0f);
  int64_t left = RESET_HOLD_MS - held;
  int period = left > 2000 ? 500 : left > 1000 ? 250 : 120;
  return blink(held, period) ? scale(RED, BRIGHT / 255.0f) : OFF;
}

Rgb status_colour(const GatewayStatus &s, int64_t t, uint8_t level) {
  float k = level / 255.0f;
  if (ota::active())
    return scale(PURPLE, k * breathe(t, 1500));
  if (s.pairing)
    return blink(t, 500) ? scale(BLUE, k) : OFF;
  if (s.criticals)
    return blink(t, 1000) ? scale(RED, k) : OFF;
  if (s.warnings)
    return scale(AMBER, k);
  if (!s.claimed)
    return scale(CYAN, k * breathe(t, 3000));
  if (s.phone_connected)
    return scale(GREEN, k);
  return scale(GREEN, k * breathe(t, 4000));
}

[[noreturn]] void factory_reset() {
  ESP_LOGW(TAG, "Factory reset: erasing devices, alerts, phones and settings");
  led_show(scale(RED, BRIGHT / 255.0f));
  // Everything the gateway learned lives in NVS: its configuration, the Bluetooth bonds, Wi-Fi.
  // The firmware and the setup code from the flasher are elsewhere, so it comes back as flashed.
  esp_err_t err = nvs_flash_erase();
  if (err != ESP_OK)
    ESP_LOGE(TAG, "Erasing NVS failed: %s", esp_err_to_name(err));
  vTaskDelay(pdMS_TO_TICKS(500));
  esp_restart();
}

void task(void *) {
  int64_t pressed_at = -1;
  int64_t show_until = 0;
  GatewayStatus status = g_gateway->status();
  int64_t status_at = 0;
  for (;;) {
    int64_t t = now_ms();
#if CONFIG_OPENRV_BUTTON_GPIO >= 0
    bool down = gpio_get_level(static_cast<gpio_num_t>(CONFIG_OPENRV_BUTTON_GPIO)) == 0;
#else
    bool down = false;
#endif
    if (down && pressed_at < 0) {
      pressed_at = t;
    } else if (down && t - pressed_at >= RESET_HOLD_MS) {
      factory_reset();
    } else if (!down && pressed_at >= 0) {
      int64_t held = t - pressed_at;
      pressed_at = -1;
      if (held >= PAIR_HOLD_MS) {
        ESP_LOGI(TAG, "Button held %lld ms: pairing open", static_cast<long long>(held));
        g_gateway->open_pairing(PAIRING_S, Role::GUEST);
        status_at = 0;  // show it right away
      } else if (held >= 50) {
        show_until = t + SHOW_MS;
      }
    }

    if (t - status_at >= 250) {
      status = g_gateway->status();
      status_at = t;
    }
    if (pressed_at >= 0)
      led_show(held_colour(t - pressed_at));
    else
      led_show(status_colour(status, t, t < show_until ? BRIGHT : DIM));
    vTaskDelay(pdMS_TO_TICKS(TICK_MS));
  }
}

}  // namespace

void start(Gateway &gateway) {
  g_gateway = &gateway;
#if CONFIG_OPENRV_BUTTON_GPIO >= 0
  gpio_config_t io{};
  io.pin_bit_mask = 1ULL << CONFIG_OPENRV_BUTTON_GPIO;
  io.mode = GPIO_MODE_INPUT;
  io.pull_up_en = GPIO_PULLUP_ENABLE;
  gpio_config(&io);
#endif
  led_init();
  xTaskCreate(task, "board", 4096, nullptr, 3, nullptr);
}

}  // namespace openrv::board
