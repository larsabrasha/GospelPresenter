#!/bin/sh
# The checks of the way back (ADR 0008, docs/core-back-to-typescript.md): the Rust core as the reference, the working
# tree's TS core (packages/core) as the candidate. Builds the WASM and the TS bundle, then runs the named checks.
#   crates/gp-core/parity/port.sh build                    the WASM and .out/ts-tree.mjs
#   crates/gp-core/parity/port.sh mutations [file …]       schema-check.mjs, then run.mjs (GP_OPS, GP_SEEDS)
#   crates/gp-core/parity/port.sh sync                     sync/check.mjs, Rust's client against the TS one (GP_STEPS, GP_SEEDS)
#   crates/gp-core/parity/port.sh views [group …]          port-views/: every ported view, the same arguments through both cores
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
# The demo data the view checks read (demo-seed.mjs, views/fixture.mjs), which needs build.sh's reference bundles.
if [ ! -f "$OUT/fixtures/demo.sqlite" ] || [ ! -f "$OUT/web-queries.mjs" ]; then
  REF=$OUT/ref-2.0
  rm -rf "$REF" && mkdir -p "$REF" "$OUT/fixtures" && git -C "$ROOT" archive 238d481b apps/web/src packages/core/src packages/sync/src | tar -x -C "$REF"
  sed "s|@REF@|$REF|g" "$PARITY/ts-entry.template.ts" > "$OUT/ts-entry.ts"
  "$ESBUILD" "$OUT/ts-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/ts-core.mjs" --log-level=warning
  sed "s|@REF@|$REF|g" "$PARITY/web-entry.template.ts" > "$OUT/web-entry.ts"
  "$ESBUILD" "$OUT/web-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/web-queries.mjs" --log-level=warning \
    --alias:@gp/core="$REF/packages/core/src/index.ts"
  node --no-warnings "$PARITY/demo-seed.mjs" "$OUT/fixtures" | tail -1
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
  views)
    node --no-warnings port-views/run.mjs "$OUT/fixtures/demo.sqlite" "$@"
    ;;
  *) echo "port.sh build | mutations [file …] | sync | views [group …]" >&2; exit 2 ;;
esac
