#!/bin/sh
# The Rust core for every Apple target, and the iOS app over it (ios/GPiOS.xcodeproj, the same SwiftUI as the Mac's).
#   apps/mac/apple.sh                 the core as build/GPCore.xcframework (macOS, iOS, the iOS simulator), the demo data
#   apps/mac/apple.sh ios             that, then the iOS app for the simulator (build/derived)
#   apps/mac/apple.sh device          that, then the iOS app for a device, unsigned (proves it compiles and links)
#   apps/mac/apple.sh run <simulator> the simulator build, installed and started on a fresh copy of the demo data
#   apps/mac/apple.sh uitest [<simulator>]
#                                     the app's menus checked against the core's answers for a scenario (ios/UITests)
#   TEAM=<team id> apps/mac/apple.sh install <UDID>
#                                     signed with that team (a personal one will do), installed and started on a device
#                                     of one's own, unlocked (UDIDs: xcrun devicectl list devices); the team is not kept
# The Mac app itself is still built by SwiftPM (crates/gp-core/build.sh), from target/release.
set -e -o pipefail  # a failed xcodebuild stops the script, though its output goes through grep
cd "$(dirname "$0")"
MAC=$PWD
ROOT=$(cd ../.. && pwd)
BUILD=$MAC/build
DEMO=$ROOT/crates/gp-core/parity/.out/fixtures/demo.sqlite
mkdir -p "$BUILD"

# The core's native interface (crates/gp-core-ffi, UniFFI) as a static library per target; the oldest systems the app
# runs on, so the linker does not warn.
export MACOSX_DEPLOYMENT_TARGET=14.0 IPHONEOS_DEPLOYMENT_TARGET=17.0
for t in aarch64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim; do
  rustup target list --installed | grep -qx "$t" || rustup target add "$t"
  (cd "$ROOT" && cargo build -p gp-core-ffi --release --lib --target "$t" --quiet)
done
# Libraries only: the header and its module are SwiftPM's (Sources/GPCoreFFI), one module for the Mac and iOS; the
# Swift bindings go into the Shell module.
"$ROOT/crates/gp-core-ffi/bindings.sh"
node "$MAC/texts.mjs"
rm -rf "$BUILD/GPCore.xcframework"
xcodebuild -create-xcframework -output "$BUILD/GPCore.xcframework" \
  -library "$ROOT/target/aarch64-apple-darwin/release/libgp_core_ffi.a" \
  -library "$ROOT/target/aarch64-apple-ios/release/libgp_core_ffi.a" \
  -library "$ROOT/target/aarch64-apple-ios-sim/release/libgp_core_ffi.a" >/dev/null

# The demo data the app copies on its first start, as the Mac app's GP_MAC_DATA (crates/gp-core/build.sh makes it).
if [ ! -f "$DEMO" ]; then
  "$ROOT/crates/gp-core/build.sh"
  (cd "$ROOT/crates/gp-core" && node --no-warnings parity/demo-seed.mjs "$(dirname "$DEMO")")
fi
cp "$DEMO" "$BUILD/demo.sqlite"

# The slide renderer: the web's SlideView on a page of its own (apps/web/vite.slides.config.ts), which the app loads
# from its own files in a web view (Sources/GPMac/SlideRenderer.swift).
(cd "$ROOT/apps/web" && pnpm exec vite build -c vite.slides.config.ts --logLevel warn)
rm -rf "$BUILD/slides" && cp -R "$ROOT/apps/web/dist-slides" "$BUILD/slides"

ios() {
  dest=$1; shift
  xcodebuild -project ios/GPiOS.xcodeproj -scheme GPiOS -configuration Debug -derivedDataPath "$BUILD/derived" \
    -destination "$dest" "$@" build 2>&1 | grep -E "error|warning: |BUILD (SUCCEEDED|FAILED)" | grep -v "appintentsmetadataprocessor"
}

case "$1" in
  ios) ios "generic/platform=iOS Simulator" ;;
  device) ios "generic/platform=iOS" CODE_SIGNING_ALLOWED=NO ;;
  run)
    ios "generic/platform=iOS Simulator"
    DEVICE=${2:-iPhone 17 Pro}
    xcrun simctl boot "$DEVICE" 2>/dev/null || true
    APP=$BUILD/derived/Build/Products/Debug-iphonesimulator/GPiOS.app
    xcrun simctl uninstall "$DEVICE" com.gospelpresenter.native 2>/dev/null || true
    xcrun simctl install "$DEVICE" "$APP"
    xcrun simctl launch "$DEVICE" com.gospelpresenter.native
    open -a Simulator
    ;;
  uitest)
    # The app's menus against the core's answers (ios/UITests, docs/view-models.md), on a simulator: minutes, so run
    # when the app's Swift changes, not in every check. TEST_RUNNER_ hands the repository's path to the test.
    DEVICE=${2:-iPhone 17 Pro}
    # A name is found among the installed simulators (the first of its name), as several iOS versions may have one.
    UDID=$(xcrun simctl list devices available | grep -m1 -E "^ +$DEVICE \(" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
    TEST_RUNNER_GP_REPO="$ROOT" xcodebuild -project ios/GPiOS.xcodeproj -scheme GPiOS -configuration Debug \
      -derivedDataPath "$BUILD/derived" -destination "platform=iOS Simulator,id=${UDID:-$DEVICE}" test 2>&1 \
      | grep -E "error|Test Case|XCTAssert|failed|passed|TEST (SUCCEEDED|FAILED)" | grep -v "appintentsmetadataprocessor"
    ;;
  install)
    [ -n "$TEAM" ] && [ -n "$2" ] || { echo "TEAM=<team id> $0 install <UDID>"; exit 1; }
    ios "id=$2" DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates
    xcrun devicectl device install app --device "$2" "$BUILD/derived/Build/Products/Debug-iphoneos/GPiOS.app" >/dev/null
    xcrun devicectl device process launch --device "$2" com.gospelpresenter.native
    ;;
esac
