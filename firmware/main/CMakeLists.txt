idf_component_register(
    SRCS main.cpp setup_code.cpp
    REQUIRES gateway ble board ota nvs_flash esp_timer app_update esp_app_format esp_psram esp_partition)
