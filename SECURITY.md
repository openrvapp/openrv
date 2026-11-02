# Security policy

OpenRV unlocks doors and switches appliances, so security reports matter to us.

## Reporting a vulnerability

Please report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Don't open a public issue or discussion for it.

Say what's affected (gateway firmware, app, or protocol), the versions, and how to reproduce it. We aim to acknowledge a report within a week and to agree a disclosure date with you once a fix is ready. We're volunteers, so a fix can take longer; we'll keep you posted.

## Supported versions

Fixes go into the latest gateway firmware release and the latest app. Older versions are not patched, and the app offers firmware updates over the air.

## Scope and known limitations

In scope: the gateway's Bluetooth service, pairing and phone roles, its PIN check, the setup code, the firmware update window and upload, the app's handling of gateway data and stored secrets, and the device drivers.

Known limitations, by design for now, that we'd welcome help with:

- **Phone to gateway:** phones pair with the gateway (LE Secure Connections, bonded) and only phones it knows, as an owner or a guest, get past `hello`. The gateway has no screen or keypad, so pairing is "Just Works": it isn't protected against someone relaying the radio link while a phone pairs. That only matters while pairing is open, which takes someone at the gateway (holding BOOT for 3 seconds) or an owner's phone, and lets in one phone per window.
- **First owner:** a new or factory-reset gateway lets the first phone that proves its setup code (from the web flasher, written to its own flash partition) or pairs during a BOOT-button window become its owner. Anyone who can read the board's flash, or reach its button, can do the same; keep the setup code with the gateway and treat physical access as ownership.
- **Known phones** are recognised by their Bluetooth identity address and bond. A phone that pairs again under a known address, outside a pairing window, is refused, but because the gateway stores the new bond while pairing, doing so can cut off the real phone until it's added again.
- **Firmware updates:** only an owner's phone can send one: over the encrypted Bluetooth link, or during a short Wi-Fi window it opens, on a WPA2 network with a random password and a one-time upload token. The gateway checks the image before switching to it and rolls back if it fails to start. Images are not signed, so an owner can install any build; the app checks a downloaded image against the release's SHA-256 before sending it.
- **Device protocols** are only as secure as the devices. For example, the RVLock Trek's password is a fixed, replayable message (see `docs/devices/rvlock-trek.md`); anyone who captures it can operate the lock with or without OpenRV.
