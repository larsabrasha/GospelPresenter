#!/bin/sh
# Builds the Rust core (WASM for the checks in Node, crates/gp-core-ffi's static library for apps/mac) and the Mac app.
#   crates/gp-core/build.sh          build
#   crates/gp-core/build.sh test     build, then every parity check against the TS core (packages/core at 238d481b)
#   crates/gp-core/build.sh run      build, then start the Mac app on a fresh copy of the demo data
set -e
cd "$(dirname "$0")"
CRATE=$PWD
ROOT=$(cd ../.. && pwd)
OUT=$CRATE/parity/.out
mkdir -p "$OUT/fixtures"

# The reference every check compares with: 2.0's TS core and the web's reads as they were at 238d481b
# (docs/rust-core.md "The reference"), taken from git, never from the app's packages/core, which no longer has them.
REF=$OUT/ref-2.0
rm -rf "$REF" && mkdir -p "$REF" && git -C "$ROOT" archive 238d481b apps/web/src packages/core/src packages/sync/src | tar -x -C "$REF"
[ -f "$REF/packages/core/src/mutators/registry.ts" ] || { echo "the reference at 238d481b has no TS mutators" >&2; exit 1; }
ESBUILD=$ROOT/apps/desktop/node_modules/.bin/esbuild
# Its packages (zod, drizzle-orm), from the workspace's.
export NODE_PATH=$ROOT/packages/core/node_modules:$ROOT/apps/server/node_modules:$ROOT/apps/web/node_modules
sed "s|@REF@|$REF|g" parity/ts-entry.template.ts > "$OUT/ts-entry.ts"
"$ESBUILD" "$OUT/ts-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/ts-core.mjs" --log-level=warning
"$ESBUILD" "$OUT/ts-entry.ts" --bundle --format=esm --platform=browser --minify --outfile="$OUT/ts-core.min.mjs" --log-level=warning
# The web's reads, with the reference's TS core: what the views are compared with (views-check.mjs).
sed "s|@REF@|$REF|g" parity/web-entry.template.ts > "$OUT/web-entry.ts"
"$ESBUILD" "$OUT/web-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/web-queries.mjs" --log-level=warning \
  --alias:@gp/core="$REF/packages/core/src/index.ts"
# The export zip's rows (parity/views/legacy.mjs) against the TS as it was when it moved to the core, at fb03e798: the
# reference at 238d481b has neither schema 27's field times nor their columns.
LEGACY_REFERENCE=fb03e798
REF_LEGACY=$OUT/ref-legacy
rm -rf "$REF_LEGACY" && mkdir -p "$REF_LEGACY" && git -C "$ROOT" archive "$LEGACY_REFERENCE" packages/core/src apps/web/src | tar -x -C "$REF_LEGACY"
printf "export { upgradeLegacyRows, legacyBlobs, legacyRowsProblem, legacyOverlayPage, LEGACY_TABLES } from '%s/packages/core/src/legacy.ts';\nexport { tableByName } from '%s/packages/core/src/sync-sql.ts';\nexport { CLASSIC } from '%s/packages/core/src/themes.ts';\n" "$REF_LEGACY" "$REF_LEGACY" "$REF_LEGACY" > "$OUT/legacy-entry.ts"
"$ESBUILD" "$OUT/legacy-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/legacy-core.mjs" --log-level=warning
# The ProPresenter import's duplicates (parity/views/song-import.mjs) against the web's songImport.ts there too.
"$ESBUILD" "$REF_LEGACY/apps/web/src/pages/songImport.ts" --bundle --format=esm --platform=node --outfile="$OUT/song-import.mjs" --log-level=warning
# The TS SyncClient as it was before the switch to the core's sync (the reference), the one on the core, and the
# server's engine, for the sync check. Its TS core is the reference's with today's tables and schema version (schema
# 27's field times, parity/beyond-reference.mjs), so its sync SQL carries every column the server and the core do.
SYNC_REFERENCE=75e7f234
REF_SYNC=$OUT/ref-sync
rm -rf "$REF_SYNC" && mkdir -p "$REF_SYNC/packages" && cp -R "$REF/packages/core" "$REF/packages/sync" "$REF_SYNC/packages/"
cp "$ROOT/packages/core/src/schema.ts" "$REF_SYNC/packages/core/src/schema.ts"
sed "s|^export const SCHEMA_VERSION = .*|$(grep '^export const SCHEMA_VERSION' "$ROOT/packages/core/src/org-schema.ts")|" "$REF/packages/core/src/org-schema.ts" \
  > "$REF_SYNC/packages/core/src/org-schema.ts"
git -C "$ROOT" show "$SYNC_REFERENCE:packages/sync/src/client/client.ts" \
  | sed "s|'./sqlite.ts'|'$REF_SYNC/packages/sync/src/client/sqlite.ts'|; s|'./transport.ts'|'$REF_SYNC/packages/sync/src/client/transport.ts'|; s|from '@gp/core'|from '$REF_SYNC/packages/core/src/index.ts'|" \
  > "$OUT/reference-client.ts"
sed "s|@REPO@|$ROOT|g; s|@REF@|$REF_SYNC|g" parity/sync/ts-sync-entry.template.ts > "$OUT/ts-sync-entry.ts"
NODE_PATH=$ROOT/packages/sync/node_modules:$NODE_PATH "$ESBUILD" "$OUT/ts-sync-entry.ts" --bundle --format=esm --platform=node --outfile="$OUT/ts-sync.mjs" --log-level=warning

(cd "$ROOT" && cargo build -p gp-core --release --target wasm32-unknown-unknown --quiet \
  && cp target/wasm32-unknown-unknown/release/gp_core.wasm "$OUT/" \
  && cargo build -p gp-core-ffi --release --lib --quiet)
# The Mac app over the core's UniFFI interface (crates/gp-core-ffi), its Swift bindings generated first.
"$ROOT/crates/gp-core-ffi/bindings.sh"
node "$ROOT/apps/mac/texts.mjs"
(cd "$ROOT/apps/mac" && swift build -c release 2>&1 | grep -E "error|warning: |Build complete")

case "$1" in
  test)
    # The native interface's own tests: how a step and SQLite's values cross over to Swift.
    (cd "$ROOT" && cargo test -p gp-core-ffi --quiet 2>&1 | grep -E "^test result|FAILED|panicked")
    node --no-warnings parity/diff.mjs 3000 10
    # The schema and its migrations, then every ported file of mutators (3 000 each here; the proof of a file is
    # `node parity/mutations/run.mjs <file> --ops 3000 --seeds 10`, 30 000).
    node --no-warnings parity/mutations/schema-check.mjs | tail -1
    node --no-warnings parity/mutations/run.mjs --ops 1000 --seeds 3 | grep -vE "^[a-z-]+: [0-9]+ mutations"
    # Sync's client logic against the TS SyncClient and a real server engine (the proof: --steps 1500 --seeds 10).
    node --no-warnings parity/sync/check.mjs --steps 1500 --seeds 3 | grep -vE "^seed"
    node --no-warnings parity/export.mjs "$OUT/fixtures" 3000 5
    node --no-warnings parity/demo-seed.mjs "$OUT/fixtures"
    node --no-warnings parity/live-check.mjs "$OUT/fixtures/demo.sqlite"
    node --no-warnings parity/views-check.mjs "$OUT/fixtures/demo.sqlite"
    mkdir -p "$OUT/native"
    GP_SYNC=NORMAL "$ROOT/apps/mac/.build/release/parity" "$OUT/fixtures" "$OUT/native"
    node --no-warnings parity/compare-final.mjs "$OUT/fixtures" "$OUT/native"
    node --no-warnings parity/workerd-check.mjs "$ROOT" "$OUT/fixtures" "$REF"
    # The browser: a Web Worker over wa-sqlite, in memory and on OPFS, in Chromium (a hidden Electron) and WebKit.
    mkdir -p "$OUT/browser"
    NODE_PATH=$ROOT/apps/web/node_modules:$ROOT/packages/sync/node_modules:$ROOT/packages/core/node_modules "$ESBUILD" parity/browser/worker.js \
      --bundle --format=esm --platform=browser --outfile="$OUT/browser/worker.js" --log-level=warning \
      --alias:gp-wa-sqlite-api="$ROOT/packages/sync/src/client/wa-sqlite-api.ts" --alias:gp-org-schema="$REF/packages/core/src/org-schema.ts" \
      --alias:gp-mutators="$REF/packages/core/src/mutators/registry.ts" --alias:gp-schema="$REF/packages/core/src/schema.ts"
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
    # The slides drawn by the web's SlideView, from the repository's build of it (docs/native-apps.md).
    (cd "$ROOT/apps/web" && pnpm exec vite build -c vite.slides.config.ts --logLevel warn)
    GP_MAC_DATA="$RUN" GP_SLIDES="$ROOT/apps/web/dist-slides" exec "$ROOT/apps/mac/.build/release/GPMac"
    ;;
esac
