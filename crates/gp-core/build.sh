#!/bin/sh
# Builds the Rust core (WASM for the checks in Node, a static library for apps/mac) and the Mac app.
#   crates/gp-core/build.sh          build
#   crates/gp-core/build.sh test     build, then every parity check against the TS core (packages/core)
#   crates/gp-core/build.sh run      build, then start the Mac app on a fresh copy of the demo data
set -e
cd "$(dirname "$0")"
CRATE=$PWD
ROOT=$(cd ../.. && pwd)
OUT=$CRATE/parity/.out
mkdir -p "$OUT/fixtures"

# The TS core, bundled from packages/core: the reference every check compares with.
sed "s|@REPO@|$ROOT|g" parity/ts-entry.template.ts > "$OUT/ts-entry.ts"
ESBUILD=$ROOT/apps/desktop/node_modules/.bin/esbuild
export NODE_PATH=$ROOT/packages/core/node_modules:$ROOT/apps/web/node_modules
"$ESBUILD" "$OUT/ts-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/ts-core.mjs" --log-level=warning
"$ESBUILD" "$OUT/ts-entry.ts" --bundle --format=esm --platform=browser --minify --outfile="$OUT/ts-core.min.mjs" --log-level=warning

(cd "$ROOT" && cargo build -p gp-core --release --target wasm32-unknown-unknown --quiet \
  && cp target/wasm32-unknown-unknown/release/gp_core.wasm "$OUT/" \
  && cargo rustc -p gp-core --release --lib --crate-type staticlib --quiet)
(cd "$ROOT/apps/mac" && swift build -c release 2>&1 | grep -E "error|warning: |Build complete")

case "$1" in
  test)
    node --no-warnings parity/diff.mjs 3000 10
    # The schema and its migrations, then every ported file of mutators (3 000 each here; the proof of a file is
    # `node parity/mutations/run.mjs <file> --ops 3000 --seeds 10`, 30 000).
    node --no-warnings parity/mutations/schema-check.mjs | tail -1
    node --no-warnings parity/mutations/run.mjs --ops 1000 --seeds 3 | grep -vE "^[a-z-]+: [0-9]+ mutations"
    node --no-warnings parity/export.mjs "$OUT/fixtures" 3000 5
    node --no-warnings parity/demo-seed.mjs "$OUT/fixtures"
    node --no-warnings parity/live-check.mjs "$OUT/fixtures/demo.sqlite"
    mkdir -p "$OUT/native"
    GP_SYNC=NORMAL "$ROOT/apps/mac/.build/release/parity" "$OUT/fixtures" "$OUT/native"
    node --no-warnings parity/compare-final.mjs "$OUT/fixtures" "$OUT/native"
    node --no-warnings parity/workerd-check.mjs "$ROOT" "$OUT/fixtures"
    # The browser: a Web Worker over wa-sqlite, in memory and on OPFS, in Chromium (a hidden Electron) and WebKit.
    mkdir -p "$OUT/browser"
    NODE_PATH=$ROOT/apps/web/node_modules:$ROOT/packages/sync/node_modules:$ROOT/packages/core/node_modules "$ESBUILD" parity/browser/worker.js \
      --bundle --format=esm --platform=browser --outfile="$OUT/browser/worker.js" --log-level=warning \
      --alias:gp-wa-sqlite-api="$ROOT/packages/sync/src/client/wa-sqlite-api.ts" --alias:gp-org-schema="$ROOT/packages/core/src/org-schema.ts" \
      --alias:gp-mutators="$ROOT/packages/core/src/mutators/registry.ts" --alias:gp-schema="$ROOT/packages/core/src/schema.ts"
    WA=$(cd "$ROOT/apps/web" && node -p "require('path').join(require('path').dirname(require.resolve('@journeyapps/wa-sqlite')), '..', 'dist', 'wa-sqlite.wasm')")
    cp parity/browser/index.html "$OUT/gp_core.wasm" "$OUT/fixtures/parity.jsonl" "$OUT/fixtures/parity-final.json" "$WA" "$OUT/browser/"
    node --no-warnings parity/browser-check.mjs "$ROOT" chromium | grep -E "core|DIFF|error"
    node --no-warnings parity/browser-check.mjs "$ROOT" webkit | grep -E "core|DIFF|error"
    ;;
  run)
    RUN=$ROOT/apps/mac/run
    [ -f "$OUT/fixtures/demo.sqlite" ] || node --no-warnings parity/demo-seed.mjs "$OUT/fixtures"
    mkdir -p "$RUN" && rm -f "$RUN/app.sqlite" "$RUN/app.sqlite-wal" "$RUN/app.sqlite-shm"
    cp "$OUT/fixtures/demo.sqlite" "$RUN/"
    GP_MAC_DATA="$RUN" exec "$ROOT/apps/mac/.build/release/GPMac"
    ;;
esac
