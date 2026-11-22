#!/bin/sh
# The checks of the way back (ADR 0008, docs/core-back-to-typescript.md): the Rust core as the reference, the working
# tree's TS core (packages/core) as the candidate. Builds the WASM and the TS bundle, then runs the named checks.
#   crates/gp-core/parity/port.sh build                    the WASM and .out/ts-tree.mjs
#   crates/gp-core/parity/port.sh mutations [file …]       schema-check.mjs, then run.mjs (GP_OPS, GP_SEEDS)
#   crates/gp-core/parity/port.sh sync                     sync/check.mjs, Rust's client against the TS one (GP_STEPS, GP_SEEDS)
set -e
cd "$(dirname "$0")"
PARITY=$PWD
ROOT=$(cd ../../.. && pwd)
OUT=$PARITY/.out
mkdir -p "$OUT"
export NODE_PATH=$ROOT/packages/core/node_modules:$ROOT/apps/server/node_modules:$ROOT/apps/web/node_modules
ESBUILD=$ROOT/apps/desktop/node_modules/.bin/esbuild
"$ESBUILD" "$PARITY/ts-tree-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/ts-tree.mjs" --log-level=warning
NODE_PATH=$ROOT/packages/sync/node_modules:$ROOT/packages/rust-core/node_modules:$NODE_PATH "$ESBUILD" "$PARITY/sync/ts-sync-tree-entry.ts" --bundle --format=esm \
  --platform=node --outfile="$OUT/ts-sync-tree.mjs" --log-level=warning
if [ ! -f "$OUT/gp_core.wasm" ] || [ -n "$(find "$ROOT/crates/gp-core/src" -newer "$OUT/gp_core.wasm" -print -quit)" ]; then
  (cd "$ROOT" && cargo build -p gp-core --release --target wasm32-unknown-unknown --quiet && cp target/wasm32-unknown-unknown/release/gp_core.wasm "$OUT/")
fi
export GP_TS=tree
what=$1; [ $# -gt 0 ] && shift
case "$what" in
  build) ;;
  mutations)
    node --no-warnings mutations/schema-check.mjs | tail -3
    node --no-warnings mutations/run.mjs "$@" --ops "${GP_OPS:-1000}" --seeds "${GP_SEEDS:-3}"
    ;;
  sync)
    node --no-warnings sync/driver-check.mjs --steps "${GP_STEPS:-500}" --seeds "${GP_SEEDS:-3}"
    node --no-warnings sync/check.mjs --steps "${GP_STEPS:-500}" --seeds "${GP_SEEDS:-3}" | grep -vE "^seed"
    ;;
  *) echo "port.sh build | mutations [file …] | sync" >&2; exit 2 ;;
esac
