# Device support: the device classes, and one folder per protocol under protocols/. A new protocol
# folder is picked up the next time CMake runs (idf.py reconfigure); protocols/registry.cpp needs
# one line for it.
file(GLOB DEVICE_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/core/*.cpp
    ${CMAKE_CURRENT_LIST_DIR}/classes/*.cpp
    ${CMAKE_CURRENT_LIST_DIR}/protocols/*.cpp
    ${CMAKE_CURRENT_LIST_DIR}/protocols/*/*.cpp)
list(FILTER DEVICE_SOURCES EXCLUDE REGEX "_test[.]cpp$")  # host tests, built by firmware/test/host

idf_component_register(
    SRCS ${DEVICE_SOURCES}
    INCLUDE_DIRS include
    REQUIRES espressif__cjson log)
