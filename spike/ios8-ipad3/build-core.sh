#!/bin/sh
# The Rust core for the iPad 3 (A5X, armv7) on iOS 8: crates/gp-core-ffi as a static library, built with Rust nightly
# from a target of its own (armv7-apple-ios.json; Rust has dropped armv7-apple-ios, and armv7s needs an A6), into
# .build/target/armv7-apple-ios/release/libgp_core_ffi.a. Needs `rustup toolchain install nightly --component rust-src`.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BUILD=$HERE/.build

# The workspace builds gp-core as a cdylib too (the web's WASM), and rustc cannot link one for armv7 ("unsupported
# architecture in Apple target"): a copy of the two crates, gp-core an rlib only, the repository left as it is.
rm -rf "$BUILD/src" && mkdir -p "$BUILD/src/crates"
cp "$ROOT/Cargo.toml" "$ROOT/Cargo.lock" "$BUILD/src/"
cp -R "$ROOT/crates/gp-core" "$ROOT/crates/gp-core-ffi" "$BUILD/src/crates/"
rm -rf "$BUILD/src/crates/gp-core/parity"
sed -i '' 's/^crate-type = \["cdylib", "rlib"\]$/crate-type = ["rlib"]/' "$BUILD/src/crates/gp-core/Cargo.toml"
grep -q '^crate-type = \["rlib"\]$' "$BUILD/src/crates/gp-core/Cargo.toml" || { echo "gp-core's crate-type is not what this script expects" >&2; exit 1; }

# The C header Core.m includes, generated from the same core as the Mac app's.
"$ROOT/crates/gp-core-ffi/bindings.sh"

# iOS 8 is below what rustc supports (10.0): it warns, writes 10.0 into the objects, and the app's linker warns again.
cd "$BUILD/src"
IPHONEOS_DEPLOYMENT_TARGET=8.0 CARGO_TARGET_DIR="$BUILD/target" RUSTC_ICE="$BUILD" \
  cargo +nightly build -p gp-core-ffi --release --lib --target "$HERE/armv7-apple-ios.json" \
  -Zbuild-std=std,panic_abort -Zjson-target-spec
lipo -info "$BUILD/target/armv7-apple-ios/release/libgp_core_ffi.a"

# SQLite for the app: iOS 8's own is 3.8.5, older than the core's SQL. The amalgamation the repository already has
# (better-sqlite3's, through pnpm install), as ARM code for the reason in app/Makefile; no locking styles, whose
# gethostuuid iOS does not have; one thread, as the app calls the core.
for SQLITE in "$ROOT"/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps/sqlite3; do :; done
[ -f "$SQLITE/sqlite3.c" ] || { echo "no sqlite3.c: run pnpm install first" >&2; exit 1; }
mkdir -p "$BUILD/sqlite"
cp "$SQLITE/sqlite3.h" "$BUILD/sqlite/"
xcrun clang -c -arch armv7 -marm -Os -miphoneos-version-min=8.0 -isysroot "${THEOS:-$HOME/theos}/sdks/iPhoneOS9.3.sdk" \
  -DSQLITE_THREADSAFE=0 -DSQLITE_ENABLE_LOCKING_STYLE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_DEFAULT_MEMSTATUS=0 \
  "$SQLITE/sqlite3.c" -o "$BUILD/sqlite/sqlite3.o"
rm -f "$BUILD/sqlite/libsqlite3.a" && xcrun ar rcs "$BUILD/sqlite/libsqlite3.a" "$BUILD/sqlite/sqlite3.o"
grep '#define SQLITE_VERSION ' "$SQLITE/sqlite3.h"

# The demo data the app opens, as apps/mac/apple.sh takes it (made by crates/gp-core/build.sh and demo-seed.mjs).
DEMO=$ROOT/crates/gp-core/parity/.out/fixtures/demo.sqlite
if [ ! -f "$DEMO" ]; then
  "$ROOT/crates/gp-core/build.sh"
  (cd "$ROOT/crates/gp-core" && node --no-warnings parity/demo-seed.mjs "$(dirname "$DEMO")")
fi
cp "$DEMO" "$HERE/app/Resources/demo.sqlite"

# The web's texts, Swedish and English (texts.mjs).
node --no-warnings "$HERE/texts.mjs"

# The app's icon and launch images, drawn by app/art.m.
xcrun clang -fobjc-arc "$HERE/app/art.m" -framework AppKit -framework ImageIO -o "$BUILD/art"
"$BUILD/art" "$ROOT/website/public/logo.svg" "$HERE/app/Resources"
