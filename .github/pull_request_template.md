## What this changes

<!-- One device or one fix per pull request. -->

## New or changed device support

<!-- Delete this section if the pull request doesn't touch a device protocol. -->

- Device (maker and model):
- Device class:
- Where the protocol came from (capture, specification, or project and its licence):
- Tested on real hardware: yes / no (what you checked)

## Checklist

- [ ] Host tests pass (`firmware/test/host`), with tests for any new decoder and driver
- [ ] The firmware builds with no warnings
- [ ] App checks pass, if the app changed (`npm run typecheck`, `npm test`, `npx prettier --check src`)
- [ ] Sources are credited in README.md, and licences added to THIRD_PARTY_NOTICES.md where needed
- [ ] Docs updated (docs/device-classes.md, docs/devices/, CONTRIBUTING.md) where needed
