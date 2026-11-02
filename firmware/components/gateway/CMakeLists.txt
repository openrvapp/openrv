# The gateway core: configured devices, latest readings, and the JSON protocol for phones.
idf_component_register(
    SRCS gateway.cpp access.cpp rules.cpp sessions.cpp transfer.cpp
    INCLUDE_DIRS include
    REQUIRES devices mbedtls log)
