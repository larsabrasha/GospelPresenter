#!/bin/sh
# The Mac app as a bundle, build/<the app's name>.app, from SwiftPM's release build (crates/gp-core/build.sh runs it):
# the program, Bundle/Info.plist with the app's name, its icon, and the accent, each the core's (`lookView`, which
# texts.mjs wrote to build/app.env and build/Assets.xcassets). A bundle, as a Mac's sidebar selection takes the app's
# accent from its Info.plist and catalogue only, and its name and icon in the menu bar and the Dock come from it (Lars,
# 2026-11-21). The program is linked with the SDK it was built with written in (SwiftPM writes the deployment target,
# and AppKit then draws the app as one of macOS 14, without Liquid Glass), and signed for this machine.
#   apps/mac/bundle.sh DEMO SLIDES   DEMO the demo data (demo.sqlite), SLIDES the slide renderer (apps/web/dist-slides),
#                                    both put among the bundle's resources, as the app opened from Finder needs them.
set -e
DEMO=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
SLIDES=$(cd "$2" && pwd)
[ -f "$DEMO" ] && [ -f "$SLIDES/slides.html" ] || { echo "usage: bundle.sh DEMO.sqlite SLIDES-DIR (the demo data and apps/web/dist-slides)" >&2; exit 1; }
cd "$(dirname "$0")"
. build/app.env
APP="build/$APP_NAME.app"
SDK=$(xcrun --show-sdk-version)
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
COMMIT=$(git rev-parse --short=7 HEAD 2>/dev/null || true)
sed -e "s/__APP_NAME__/$APP_NAME/g" -e "s/__COMMIT__/$COMMIT/g" Bundle/Info.plist > "$APP/Contents/Info.plist"
vtool -set-build-version macos 14.0 "$SDK" -replace -output "$APP/Contents/MacOS/GPMac" .build/release/GPMac
cp "$DEMO" "$APP/Contents/Resources/demo.sqlite"
cp -R "$SLIDES" "$APP/Contents/Resources/slides"
# The icon at every size a Mac asks for, from the one picture.
SET=build/AppIcon.iconset
rm -rf "$SET" && mkdir -p "$SET"
for n in 16 32 128 256 512; do
  sips -z $n $n "$APP_ICON" --out "$SET/icon_${n}x${n}.png" >/dev/null
  sips -z $((n * 2)) $((n * 2)) "$APP_ICON" --out "$SET/icon_${n}x${n}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
xcrun actool build/Assets.xcassets --compile "$APP/Contents/Resources" --platform macosx --minimum-deployment-target 14.0 \
  --accent-color AccentColor --output-partial-info-plist build/assets-info.plist --errors --warnings >/dev/null
codesign -f -s - "$APP"
echo "$APP"
