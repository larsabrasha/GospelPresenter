# gp-core: the Rust core (an experiment)

Whether Gospel Presenter's core can be one Rust library under the web and a native Mac app (`apps/mac`) without the
two drifting apart. The TypeScript core (`packages/core`) is still the app's; every check here compares with it.

- `src/` — the schema (`schema.rs`), the mutators (`mutators.rs`, one module a file of them in `mutators/`, argument checks in `args.rs`, JSON as JavaScript writes it in `json.rs`), what the shells show (`views.rs`, `search.rs`), and
  presenting as a reducer (`live.rs`). The core never opens a database: it asks its shell for every SQL query and
  waits for the rows (`bridge.rs`), so the same code runs as WASM under Node and as a static library under Swift;
  Swift reaches it through `crates/gp-core-ffi` (UniFFI, `docs/native-apps.md`), the web through `bridge.rs`'s C functions.
- `parity/mutations/` — the schema and the mutators against the TS core, file by file of `packages/core/src/mutators`:
  `schema-check.mjs` migrates a database of every version through both; `run.mjs [file] --ops N --seeds N` sends the
  same random mutations through both, every table compared after each step (a file is proved at 30 000).
- `src/sync.rs`, `src/sync_sql.rs` — sync's client logic (SyncClient's): the commands `syncOpen` (in the transaction of
  `migrateOrgSchema`), `syncMutate` (a change run and queued), `syncPending` (the queue to send) and `syncRebase` (the
  server's pages), each of the others in one transaction of the shell's. A statement the shell's SQLite refuses is answered `{"error": …}`.
- `parity/sync/check.mjs` — the app's SyncClient, now on the core's sync, against the TS SyncClient as it was before
  (frozen by `build.sh` from commit 75e7f234): device A as the reference against a real server engine and as the app's
  client given the same answers, its requests checked against the reference's; device B changing the same library; a
  network that loses answers and refuses. Every table, the queue, the rejections and the tables reported compared
  after every step.
- `parity/` — the checks against the TS core: random mutations through both cores on two SQLite files (`diff.mjs`),
  slides against `songSlides` and `bibleItemSlides` (`demo-seed.mjs`), presenting against the web's (`live-check.mjs`),
  and the native library's outcomes and rows (`export.mjs`, `compare-final.mjs`, with `apps/mac`'s `parity`).
- `build.sh` — builds the WASM, the static library and the Mac app; `test` runs every check, `run` starts the app on
  made-up demo data (no real song texts). Generated files go to `parity/.out/` and `/target/`.

Ported so far: the schema and its migrations, the default labels, every mutator of `packages/core/src/mutators` but
the test helper `probe`; the presentations, a presentation's slides, the trash, song search, and presenting's keys.
`docs/rust-core.md` says where each stands.
