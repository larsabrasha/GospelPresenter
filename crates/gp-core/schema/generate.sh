#!/bin/sh
# The core's view types' JSON Schema (examples/schema.rs) and the shells' types from it (generate.mjs): run after a
# change to crates/gp-core/src/view_types.rs; both outputs are checked in.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
cargo run --quiet --example schema --features schema > schema/views.json
node schema/generate.mjs schema/views.json swift > ../../apps/mac/Sources/GPMac/ViewTypes.swift
