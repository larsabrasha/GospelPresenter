# The core on an iPad 3 with iOS 8.4.1

A spike (Lars, 2026-11-18): whether the Rust core (`crates/gp-core`) runs on a jailbroken iPad 3 ("the new iPad",
A5X, 32-bit armv7) downgraded to iOS 8.4.1, for a screen that shows song texts on an old iPad, as the Raspberry Pi
in `docs/native-slide-rendering.md`. Not a shell of the app: one screen that calls the core and shows its answers.

**Where it stands:** the app builds as a .deb for armv7 and iOS 8.0, and its calls into the core answer right on the
Mac. It has not run on an iPad. Built and checked at 0944db9f; the core's interface (`start`, UniFFI's `Step`) may
have changed since, and Core.m reads it by hand.

## Why not the app itself

- SwiftUI needs iOS 13, `@Observable` iOS 17, and today's Swift iOS 12: the UI here is Objective-C and UIKit.
- The Swift that UniFFI 0.32 generates is too new for an old Swift; Core.m calls UniFFI's C functions instead.
- The web neither: Safari 8 has no WebAssembly (iOS 11) and too little of the JavaScript the web is built to.
- Xcode 11, the last to build for iOS 8, does not run on Apple Silicon, and Catalina (Intel only) cannot be
  virtualised there. None is needed: today's clang and ld build and link armv7 for iOS 8 given an old SDK.

## What it takes

1. **The core** (`build-core.sh`): Rust nightly, `-Zbuild-std`, and a target of our own (`armv7-apple-ios.json`, the
   armv7s target's with a Cortex-A9 and VFPv3), since Rust has dropped `armv7-apple-ios` and armv7s code needs an A6.
   No thread-local storage (iOS 8 has none for apps; std uses pthread keys). gp-core is built from a copy as an rlib
   only: as a cdylib, rustc panics linking it for armv7. rustc writes iOS 10.0 into the objects, its lowest.
2. **The SDK**: Theos's `iPhoneOS9.3.sdk`, its .tbd files made armv7-only and libsystem_c's given the memory
   functions it leaves out (`sdk-armv7-only.py`, which says why).
3. **The app** (`app/`, Theos): `clock.c` gives Rust's std the `clock_gettime` iOS 8 lacks (iOS 10); the Makefile
   turns off a module-map warning the old SDK sets off, and `objc_alloc`, which iOS 8 may lack.

Not done: SQLite. The views a screen needs ask for SQL, which Core.m answers "asked for SQL"; iOS 8's own SQLite is
3.8, so a real screen would build SQLite's amalgamation into the app.

## Build

On a Mac with Xcode and Homebrew:

```sh
rustup toolchain install nightly --profile minimal --component rust-src
brew install ldid dpkg make                       # Theos's tools; GNU make 4 as gmake
git clone --recursive https://github.com/theos/theos.git ~/theos
git clone --filter=blob:none --sparse https://github.com/theos/sdks.git /tmp/sdks
git -C /tmp/sdks sparse-checkout set iPhoneOS9.3.sdk && mv /tmp/sdks/iPhoneOS9.3.sdk ~/theos/sdks/
python3 -I spike/ios8-ipad3/sdk-armv7-only.py ~/theos/sdks/iPhoneOS9.3.sdk
spike/ios8-ipad3/build-core.sh
cd spike/ios8-ipad3/app && THEOS=~/theos gmake package FINALPACKAGE=1   # packages/*.deb
```

The decoding in Core.m, run on the Mac against the host's core (after `crates/gp-core/build.sh`):

```sh
cd spike/ios8-ipad3/app && xcrun clang -fobjc-arc -I../../../apps/mac/Sources/GPCoreFFI mac-check.m Core.m \
  -L../../../target/release -lgp_core_ffi -framework Foundation -o ../.build/mac-check && ../.build/mac-check
```

## On the iPad

Jailbroken (EtasonJB is the one for 32-bit 8.4.1, from memory, not checked), with OpenSSH from Cydia: copy the .deb
over with `scp`, then `dpkg -i` it and `uicache`. The app lands in /Applications, signed by ldid, and needs no
AppSync. If it stops at launch, the reason is in the crash log (Settings › Privacy › Diagnostics) or in Console on
the Mac with the cable in.

## Checked

- The binary: armv7, `LC_VERSION_MIN_IPHONEOS` 8.0, `LC_DYLD_INFO_ONLY` (not chained fixups, iOS 13.4), the app's own
  `clock_gettime`, no `objc_alloc` and no thread-local variables imported; it links libobjc, Foundation,
  CoreFoundation, UIKit, CoreGraphics and libSystem only. The .deb 781 kB, the binary 2.3 MB.
- `mac-check`: `coreInfoView`, `highlightView` and a view that does not exist answer as the core does, 0.8 ms.

## Not checked

- That it starts on iOS 8.4.1: whether every function it imports is in iOS 8 (from memory: yes), and whether objects
  marked iOS 10.0 matter to dyld there.
- The clock: `clock.c` has not run.
