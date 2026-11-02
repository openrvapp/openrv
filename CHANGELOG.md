# Changelog

Notable changes to the gateway firmware, the app and the protocol. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Firmware versions follow [Semantic Versioning](https://semver.org/) and are released as `firmware-vX.Y.Z` tags.

## [Unreleased]

The first public version, redesigned from the earlier rv-ble-relay project.

### Gateway firmware

- ESP-IDF 6 and NimBLE on the ESP32-S3: the gateway stores devices, settings and alert rules, reads devices, and serves a JSON protocol to phones over Bluetooth.
- Runs on any ESP32-S3 board with 4 MB of flash or more, with or without PSRAM.
- Device support organised by class (temperature sensor, liquid level sensor, battery monitor, solar controller, refrigerator, lock, surge protector), with drivers for Mopeka Pro Check, Inkbird IBS-TH/IBS-TH2, Alpicool-protocol coolers, RVLock Trek and Go Power PWM (experimental).
- Alert rules with hysteresis and hold times, evaluated on the gateway in Celsius.
- Cooler Keep On and Auto-Lock checks; per-lock "ask for the gateway PIN to unlock".
- Firmware updates over a short-lived Wi-Fi window, with rollback if a new image fails to start.
- Pairing and phone roles (0.4.0): bonded, encrypted Bluetooth; only phones the gateway knows get in, as owners or guests. The first owner claims it with the flasher's setup code or by holding BOOT for 3 seconds; owners add and remove phones.
- The BOOT button opens pairing (3 s) or factory resets (10 s), and the board's RGB LED shows the gateway's status.
- Firmware updates over Bluetooth as well as Wi-Fi (0.5.0).

### App

- React Native (Expo) app for Android: dashboard with per-phone card styles, sizes and order; device details and controls; alerts; adding devices; firmware updates.
- One temperature unit setting for every reading and alert threshold.
- Alert notifications on the phone, by severity, when an alarm starts and when it clears. Monitoring is live (an Android foreground service keeps the gateway connected), periodic (a background check about every 15 minutes) or off (only while the app is open).
- Demo mode with sample devices, no gateway needed.
- Store builds of the app with Expo (EAS) from `app-v*` tags; local builds from source still work.
- Setting up a new gateway from the flasher's QR code, or with its setup code or BOOT button; a Phones screen for owners; guests see settings but can't change them.

### Website

- Project site and a web flasher that installs a release or a file, offers a firmware version per kind of hardware, and checks the board's chip, flash and PSRAM first.
- The flasher writes a fresh setup code with the firmware and shows it as a QR code to print or save.
