#!/bin/sh
# The core's view types' JSON Schema (examples/schema.rs) and the shells' types from it (generate.mjs): Swift for the
# Mac and iOS app, C# for the Windows app, TypeScript for the web. Run after a change to
# crates/gp-core/src/view_types.rs; every output is checked in. Where dotnet is, the C# is compiled and read back.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
cargo run --quiet --example schema --features schema > schema/views.json
node schema/generate.mjs schema/views.json swift > ../../apps/mac/Sources/Shell/ViewTypes.swift
node schema/generate.mjs schema/views.json csharp > schema/csharp/ViewTypes.cs
node schema/generate.mjs schema/views.json typescript > ../../packages/rust-core/src/view-types.ts
if command -v dotnet >/dev/null; then dotnet run --project schema/csharp-check; fi
