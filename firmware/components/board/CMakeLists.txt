idf_component_register(
    SRCS board.cpp
    INCLUDE_DIRS include
    REQUIRES gateway ota esp_driver_gpio nvs_flash esp_timer log)
