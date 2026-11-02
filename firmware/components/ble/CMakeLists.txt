idf_component_register(
    SRCS ble.cpp links.cpp
    INCLUDE_DIRS include
    REQUIRES gateway bt esp_timer log)

# NimBLE's GATT tables are C structs filled with designated initializers; unnamed fields are meant to be zero.
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-missing-field-initializers)
