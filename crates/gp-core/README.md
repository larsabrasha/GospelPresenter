# gp-core: the Rust core (an experiment)

Whether Gospel Presenter's core can be one Rust library under the web and a native Mac app (`apps/mac`) without the
two drifting apart. The TypeScript core (`packages/core`) is still the app's; every check here compares with it.

- `src/` — mutators (`mutators.rs`, argument checks in `args.rs`), what the shells show (`views.rs`, `search.rs`), and
  presenting as a reducer (`live.rs`). The core never opens a database: it asks its shell for every SQL query and
  waits for the rows (`bridge.rs`), so the same code runs as WASM under Node and as a static library under Swift.
- `parity/` — the checks against the TS core: random mutations through both cores on two SQLite files (`diff.mjs`),
  slides against `songSlides` and `bibleItemSlides` (`demo-seed.mjs`), presenting against the web's (`live-check.mjs`),
  and the native library's outcomes and rows (`export.mjs`, `compare-final.mjs`, with `apps/mac`'s `parity`).
- `build.sh` — builds the WASM, the static library and the Mac app; `test` runs every check, `run` starts the app on
  made-up demo data (no real song texts). Generated files go to `parity/.out/` and `/target/`.

Ported so far: createPresentation, addSongToPresentation, addHeaderToPresentation, moveItem, reorderItems, removeItem,
updatePresentation, renameItem, setItemNote, setItemArrangement, trash/restore/purgePresentation; the presentations,
a presentation's slides, the trash, song search, and presenting's keys.
