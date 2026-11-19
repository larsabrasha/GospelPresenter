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
