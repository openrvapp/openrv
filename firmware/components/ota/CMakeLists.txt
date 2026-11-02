idf_component_register(
    SRCS ota.cpp
    INCLUDE_DIRS include
    REQUIRES esp_wifi esp_netif esp_http_server app_update esp_timer log)
