# gp-core: the Rust core (an experiment)

Whether Gospel Presenter's core can be one Rust library under the web and a native Mac app (`apps/mac`) without the
two drifting apart. The TypeScript core (`packages/core`) is still the app's; every check here compares with it.

- `src/` — the schema (`schema.rs`), the mutators (`mutators.rs`, one module a file of them in `mutators/`, argument checks in `args.rs`, JSON as JavaScript writes it in `json.rs`), what the shells show (`views.rs`, `search.rs`), and
  presenting as a reducer (`live.rs`). The core never opens a database: it asks its shell for every SQL query and
  waits for the rows (`bridge.rs`), so the same code runs as WASM under Node and as a static library under Swift.
- `parity/mutations/` — the schema and the mutators against the TS core, file by file of `packages/core/src/mutators`:
  `schema-check.mjs` migrates a database of every version through both; `run.mjs [file] --ops N --seeds N` sends the
  same random mutations through both, every table compared after each step (a file is proved at 30 000).
- `parity/` — the checks against the TS core: random mutations through both cores on two SQLite files (`diff.mjs`),
  slides against `songSlides` and `bibleItemSlides` (`demo-seed.mjs`), presenting against the web's (`live-check.mjs`),
  and the native library's outcomes and rows (`export.mjs`, `compare-final.mjs`, with `apps/mac`'s `parity`).
- `build.sh` — builds the WASM, the static library and the Mac app; `test` runs every check, `run` starts the app on
  made-up demo data (no real song texts). Generated files go to `parity/.out/` and `/target/`.

Ported so far: the schema and its migrations, the default labels, every mutator of `packages/core/src/mutators` but
the test helper `probe`; the presentations, a presentation's slides, the trash, song search, and presenting's keys.
`docs/rust-core.md` says where each stands.
