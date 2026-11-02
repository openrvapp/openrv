# OpenRV gateway firmware (ESP-IDF). Build: idf.py set-target esp32s3 && idf.py build
cmake_minimum_required(VERSION 3.22)

# Release builds pass -DPROJECT_VER from the tag (.github/workflows/firmware-release.yml).
if(NOT DEFINED PROJECT_VER)
  set(PROJECT_VER "0.5.0")
endif()
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(openrv-gateway)
