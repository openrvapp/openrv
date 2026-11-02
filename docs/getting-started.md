# Getting started with OpenRV

This guide takes you from a new board to your RV's devices on your phone. You don't need to write
code or install developer tools. Allow about 20 minutes.

## What you need

- **An ESP32-S3 board with at least 4 MB of flash.** This is the gateway. Good choices:
  - Espressif ESP32-S3-DevKitC-1 (any version marked N8, N16, N8R8 or N16R8)
  - Similar "ESP32-S3 dev boards" with two USB-C ports, such as the Lonely Binary ESP32-S3 N16R8,
    which OpenRV is tested on
  Boards with an RGB light and a BOOT button get a status light and button control; others work
  too, set up from the app.
- **A USB cable that carries data**, not just power. Many cheap cables only charge.
- **A computer with Chrome or Edge** (Windows, Mac, Linux or ChromeOS) for the first install.
  Firefox and Safari can't talk to USB devices.
- **A phone:** Android 7 or later, or an iPhone once the iOS app is out.
- In the RV: a **USB power adapter** for the gateway, such as a 12 V USB socket. It uses less than
  a watt.

## 1. Install the gateway firmware

1. Plug the board into your computer.
2. Open [openrv.app/flash.html](https://openrv.app/flash.html) in Chrome or Edge.
3. Leave the newest release selected and click **Connect**. Pick the board in the list that pops
   up. It's usually called "USB Serial", "USB JTAG/serial debug unit" or "CH340".
4. Check that every line under the board shows a tick, then click **Install**. It takes about a
   minute.
5. When it finishes, the page shows a **QR code and a setup code**. Print it, save it, or take a
   photo of it, and keep it with the gateway: it makes your phone the gateway's owner.

The board isn't in the list? See [The computer can't find the board](#the-computer-cant-find-the-board).

## 2. Install the app

1. Install **OpenRV** from Google Play or the App Store.
2. Open it. You can tap **Try the demo gateway** to look around before your gateway is ready.

(If you'd rather build the app yourself, the [README](../README.md#development) explains how.)

## 3. Become the gateway's owner

1. Power the gateway. Its light slowly glows cyan: it's waiting for an owner.
2. Scan the QR code from step 1 with your phone's camera and tap the link. OpenRV opens, finds the
   gateway and asks to pair: tap **Pair**. Your phone is now the gateway's owner.

No QR code? In the app, tap **Find a gateway**, choose **OpenRV**, and either type the setup code
or hold the board's **BOOT** button for 3 seconds (the light blinks blue).

Only phones you let in can use the gateway. To add another, go to **Settings › Phones › Add a
phone** and connect the other phone within 2 minutes. Guests can see and operate devices; owners
can also change settings.

## 4. Add your devices

1. In the app, go to **Devices** and tap **Add device**. The gateway listens for nearby Bluetooth
   devices for a minute.
2. Devices OpenRV knows are listed first. Tap one, give it a name such as "Front tank", and tap
   **Add**. Add as many as you like.
3. They appear on the **Dashboard**. Press and hold a card and drag it to rearrange; the edit
   button in the top bar lets you rename the dashboard and change or hide cards.

## 5. Alerts

Open a device and tap **Alerts** to be warned when, say, propane is low or the fridge gets warm.
The gateway checks alerts all the time. In **Settings › Alert notifications**, choose how your
phone hears about them:

- **Live:** the phone stays connected while the app is in the background; alerts arrive in seconds.
- **Periodic:** the phone checks about every 15 minutes.
- **Off:** only while the app is open.

## 6. Updates

The app checks for new gateway firmware and downloads it at home. At the RV, go to **Settings ›
Firmware update** and install it over Wi-Fi (seconds) or Bluetooth (a minute or two). If an update
ever fails, the gateway goes back to the previous version by itself.

## The status light and the BOOT button

| Light | Meaning |
|---|---|
| Slow green glow | All is well, no phone connected |
| Steady green | All is well, a phone is connected |
| Slow cyan glow | No owner yet: set it up from the app |
| Blinking blue | Pairing mode: a new phone can join for 2 minutes |
| Steady amber | A warning alert |
| Blinking red | A critical alert |
| Purple glow | A firmware update is in progress |

| BOOT button | What it does |
|---|---|
| Short press | Shows the status brightly for a few seconds |
| Hold 3 seconds | Pairing mode, so a new phone can join |
| Hold 10 seconds | Factory reset: erases all devices, alerts, settings and phones (the setup code still works) |

The app shows the same guide under **Settings › Status light and button**.

## Troubleshooting

### The computer can't find the board

- Try another USB cable: charge-only cables are the most common cause.
- On boards with two USB ports, try the other one.
- Install the USB driver if your computer needs one. Boards with a **CH340** or **CH343** USB chip
  (it's printed on the chip next to the USB port) need WCH's driver on some computers: for
  [Windows](https://www.wch-ic.com/downloads/CH341SER_EXE.html) or
  [Mac](https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html). The ESP32-S3's own USB port
  (often labelled USB or OTG) needs no driver.
- Put the board in download mode: hold **BOOT**, press and release **RESET**, then let go of
  **BOOT**, and click **Connect** again.

### The app can't find or connect to the gateway

- Make sure the gateway has power and its light is on, and that the phone is within about 10 m.
- Allow OpenRV to use Bluetooth (and nearby devices) when Android asks. If you said no, allow it in
  Android's Settings › Apps › OpenRV › Permissions.
- After a firmware reinstall or factory reset, the app clears the old pairing by itself and asks
  to pair again.

### "This gateway already has an owner"

Ask an owner to add your phone (Settings › Phones › Add a phone), or hold BOOT for 3 seconds to
join as a guest. If no owner can help, a factory reset (hold BOOT 10 seconds) starts over, and
erases everything on the gateway.

### Android asks to pair, or about contacts

Pairing is how the gateway knows your phone; tap **Pair**. The question about sharing contacts and
call history is Android's: leave it off, as the gateway can't use them.

### Still stuck?

Ask in [Discussions](https://github.com/openrvapp/openrv/discussions), or open an
[issue](https://github.com/openrvapp/openrv/issues) with what you tried and what you saw.
