#!/bin/sh
# The Windows app's core from a Mac or Linux (docs/windows-app.md), in Docker (build/Dockerfile):
#   - gp_core_ffi.dll for x64 and ARM64 (cargo-xwin), into apps/windows/native/win-x64 and win-arm64;
#   - the C# bindings (uniffi-bindgen-cs, read from the DLL's metadata), into apps/windows/Shell/Ffi;
#   - the core for this machine as a dynamic library, into apps/windows/native/<rid>, for the Shell library's tests;
#   - the texts (texts.mjs).
# A file is replaced only when it changed. On Windows, build/build.ps1 does the same without Docker.
set -e
cd "$(dirname "$0")/../../.."
ROOT=$PWD
WIN=$ROOT/apps/windows
docker build -q -t gp-windows-build "$WIN/build" >/dev/null
# The registry and Microsoft's CRT and SDK kept in volumes between runs; the Linux build in a target of its own.
docker run --rm -v "$ROOT:/src" -v gp-cargo-registry:/usr/local/cargo/registry -v gp-xwin:/xwin \
  -e CARGO_TARGET_DIR=/src/target/xwin gp-windows-build sh -ec '
    for t in x86_64-pc-windows-msvc aarch64-pc-windows-msvc; do
      cargo xwin rustc --quiet -p gp-core-ffi --lib --release --target $t --crate-type cdylib
    done
    rm -rf /tmp/cs && mkdir -p /tmp/cs
    uniffi-bindgen-cs --library target/xwin/x86_64-pc-windows-msvc/release/gp_core_ffi.dll \
      --config crates/gp-core-ffi/uniffi.toml --no-format --out-dir /tmp/cs >/dev/null
    mkdir -p target/xwin/cs && cp /tmp/cs/*.cs target/xwin/cs/'
copy() { mkdir -p "$(dirname "$2")"; cmp -s "$1" "$2" || cp "$1" "$2"; }
copy target/xwin/x86_64-pc-windows-msvc/release/gp_core_ffi.dll "$WIN/native/win-x64/gp_core_ffi.dll"
copy target/xwin/aarch64-pc-windows-msvc/release/gp_core_ffi.dll "$WIN/native/win-arm64/gp_core_ffi.dll"
for f in target/xwin/cs/*.cs; do copy "$f" "$WIN/Shell/Ffi/$(basename "$f")"; done
# This machine's core, for the tests: unoptimised, as bindings.sh builds the Mac's.
cargo rustc --quiet -p gp-core-ffi --lib --crate-type cdylib
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) copy target/debug/libgp_core_ffi.dylib "$WIN/native/osx-arm64/libgp_core_ffi.dylib" ;;
  Darwin-x86_64) copy target/debug/libgp_core_ffi.dylib "$WIN/native/osx-x64/libgp_core_ffi.dylib" ;;
  Linux-x86_64) copy target/debug/libgp_core_ffi.so "$WIN/native/linux-x64/libgp_core_ffi.so" ;;
  Linux-aarch64) copy target/debug/libgp_core_ffi.so "$WIN/native/linux-arm64/libgp_core_ffi.so" ;;
esac
node "$WIN/texts.mjs"
