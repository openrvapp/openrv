# Host build of the device support (classes, drivers, decoders) and their tests. No ESP-IDF needed:
#   cmake -S firmware/test/host -B build/host && cmake --build build/host && ctest --test-dir build/host --output-on-failure
# Each protocol's tests live next to it as protocols/<name>/<name>_test.cpp and are picked up here.
cmake_minimum_required(VERSION 3.20)
project(openrv_host_tests C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(DEVICES ${CMAKE_CURRENT_LIST_DIR}/../../components/devices)

# cJSON (MIT): the copy ESP-IDF downloaded if there is one, otherwise the same release from GitHub.
set(CJSON_LOCAL ${CMAKE_CURRENT_LIST_DIR}/../../managed_components/espressif__cjson/cJSON)
if(EXISTS ${CJSON_LOCAL}/cJSON.c)
  set(CJSON_DIR ${CJSON_LOCAL})
else()
  include(FetchContent)
  FetchContent_Declare(cjson URL https://github.com/DaveGamble/cJSON/archive/refs/tags/v1.7.19.tar.gz)
  FetchContent_Populate(cjson)
  set(CJSON_DIR ${cjson_SOURCE_DIR})
endif()

file(GLOB DEVICE_SOURCES
    ${DEVICES}/core/*.cpp
    ${DEVICES}/classes/*.cpp
    ${DEVICES}/protocols/*.cpp
    ${DEVICES}/protocols/*/*.cpp)
file(GLOB TEST_SOURCES ${CMAKE_CURRENT_LIST_DIR}/*.cpp)

add_executable(host_tests ${TEST_SOURCES} ${DEVICE_SOURCES} ${CJSON_DIR}/cJSON.c)
target_include_directories(host_tests PRIVATE ${CMAKE_CURRENT_LIST_DIR} ${CMAKE_CURRENT_LIST_DIR}/stubs ${DEVICES}/include ${CJSON_DIR})
if(MSVC)
  target_compile_options(host_tests PRIVATE /W4 /permissive- /Zc:preprocessor /wd4100)
  target_compile_definitions(host_tests PRIVATE _CRT_SECURE_NO_WARNINGS)
else()
  target_compile_options(host_tests PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

enable_testing()
add_test(NAME devices COMMAND host_tests)
