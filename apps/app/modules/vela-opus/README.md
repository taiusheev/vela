# Original Telegram voice playback on iPhone

This local Expo module decodes Ogg Opus into a temporary stereo 48 kHz, 16-bit
WAV for Apple's audio player. It performs no network requests and introduces no
media processor. The authenticated app API supplies the original recording;
the app discards the downloaded Ogg after decoding, retains at most three local
playback files, and clears them on account/session changes.
Authenticated downloads are cancelled after thirty seconds or on account/session
changes, and incomplete downloads are deleted.

The decoder runs on a serial native background queue. Source files must be regular
files within the app's `Caches/vela-audio` directory and at most 20 MiB. PCM is
decoded in fixed-size chunks, with a five-minute duration limit. Invalid,
truncated, oversized, or overlong files fail with a content-free error and the
partial output is deleted. A voice above the five-minute limit cannot be played
in this trial app.

## Sources and licensing

`codec-pins.json` pins official Xiph release archives and their SHA-256 hashes.
`scripts/prepare-codecs.mjs` verifies every archive before extraction, configures
portable C sources, and deterministically renames the three `config.h` includes
to avoid collisions within one CocoaPod. HTTP support in libopusfile is disabled.
Upstream sources are otherwise unchanged. The checked-in `licenses/*.txt` files
contain the original notices and are bundled into the app by the podspec.

`vendor`, `generated`, `.archives`, and `.host-build` are ignored. Commit the
module code, pins, licence notices, and this document only. To update a codec,
verify the release and checksum using the upstream download pages, update its
pin, then rerun the checks below.

## Build and verification

The app's local-module autolinking configuration registers this module. Its Expo
config plugin prepares the source files before iOS CocoaPods installation. A
development build or release build is required; Expo Go does not include this
custom native module.

Run from the repository root:

```sh
node apps/app/modules/vela-opus/scripts/check-host.mjs
```

The host check compiles all pinned codec C sources with Clang and tests synthetic
mono and chained mono/stereo Opus, WAV output, corrupt input, missing input,
oversized input, duration bounds, and output errors. This passes on the current
macOS command-line-tools environment. Expo Apple autolinking also resolves the
pod and Swift module.

These checks do not establish iOS compilation or playback. This computer has no
Xcode installation. Trial release requires an Xcode build for both simulator and
device, followed by a signed iPhone check of a fresh Telegram Ogg voice, pause,
replay, app background/foreground, expiry, deletion, and account switch. Retain
the build identifier and device/iOS version with that evidence.
