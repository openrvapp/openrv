# RVLock Trek — BLE protocol (decoded 2026-10-16)

Decoded from an Android `btsnoop_hci.log` capture of the RVLock Keyless app
locking and unlocking a Trek (Bluetooth built into the handle). The gateway
treats the lock as a command-only, on-demand device (the same connection model
as the Alpicool cooler).

## Link layer
- **No SMP pairing and no encryption** in the capture (0 SMP packets, no
  Encryption Change events). The app-level password below is the *only*
  authentication; the gateway does **not** need to bond at the link layer.
- Implication: the token travels in cleartext and is replayable. See Security.

## GATT
- Service **0x1000** (handles 0x0001-0x0011) holds both characteristics the
  app uses. Service 0xFEE0 (from 0x0012, with characteristic 0xFEE1) is also
  present but unused. Lock MAC (example): `5C:53:10:12:34:56`.
- **Command (write):** characteristic **0x1001**, value handle **0x0003**
  (read, write, write without response) — app uses `WRITE_REQ`.
- **Response (notify):** characteristic **0x1002**, value handle **0x0006**,
  CCCD at **0x0007** — enable notifications before sending commands.

## Frame format
`7E <LEN> <payload…> <CHK>`
- `LEN` = number of bytes after LEN, including CHK.
- `CHK` = sum of all preceding bytes (including 7E and LEN) & 0xFF.
  (Verified on command and notify frames. The password frame's last byte is
  off by one under this rule, so treat the password as an opaque captured
  blob, not a frame to recompute.)

## Exchange (per action)
1. Connect; enable notifications on 0x0006 (write 0x0001 to CCCD 0x0007).
2. Write the **password** frame to 0x0003, for example
   `7E 08 01 21 A1 B2 C3 D4 01 45`. Each lock has its own bytes (here made up): never publish a
   real one, since anyone who has it can unlock that lock.
   Lock replies (notify on 0x0006): `7E 05 01 21 03 00 A8` (auth OK).
3. Write the **action** frame to 0x0003:
   - **`7E 06 01 03 03 00 00 8B`** — action byte 00 = **lock**
   - **`7E 06 01 03 03 01 00 8C`** — action byte 01 = **unlock**
   Lock echoes the same frame back as a notify = acknowledgement.
4. Mapping confirmed on a real lock through the gateway (a first reading had it
   the other way round).

No battery or lock-state read was seen in this capture; likely command-only.

## Is the password negotiated at pairing time?
Probably yes — the app enrollment likely sets/exchanges this token on the lock
— but it does not matter for the gateway: the lock accepted this exact token
over a fresh, unencrypted connection with no challenge, so it authorizes by
**token value**, not by which device sends it. The gateway simply **replays
the owner's captured token**. To learn whether the token is per-phone or rotates,
capture the *enrollment* flow (remove the lock in the app and re-add it with
the snoop log running) — not required to ship.

## Security notes
- The password is static and sent in the clear, so anyone who sniffs it once
  can replay it to unlock. This is a weakness in the lock itself and exists
  independent of the gateway.
- Reusing a phone's token means the gateway presents as that phone; the lock
  cannot tell them apart.

## How OpenRV uses it

- The lock is device type `rvlock_trek` (class: lock). Its settings hold the
  password frame, pasted as hex when the lock is added. The gateway keeps it
  and never sends it back to a phone.
- On a lock or unlock command: connect, enable notifications on 0x0006, write
  the password frame to 0x0003, wait for the auth-OK notify, write the action
  frame, confirm by its echo, then disconnect, so the RVLock app can still use
  the lock in between (it accepts one client at a time).
- Unlocking asks for the gateway PIN when one is set, unless the lock's "Ask for
  the gateway PIN to unlock" setting is off. A lock-only setting refuses
  unlocking altogether.
- There's no lock-state or battery reading, so the app shows the last command
  sent and whether the lock acknowledged it.
