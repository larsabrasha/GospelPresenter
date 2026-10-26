# Sync spike: results

- **Date:** 2026-10-26
- **Scope:** "Next step: a two-day spike" in `research/sync-engine-evaluation.md`; ADR 0007 decisions 1–4
- **Branch:** `claude/sync-spike`
- **Verdict: go, with changes.** Every pass criterion passed and the fail criterion did not occur.
  Nothing was deployed to Cloudflare, and the browser (OPFS) client was not run, so those two areas
  still need checking (below) before more is built on them. Decision 2 does not need reopening.

## Pass/fail

The evaluation's criteria first, then the ones the spike brief added.

| Criterion | Result | Evidence |
|---|---|---|
| Both adapters pass the same test file | **Pass** | `test/sync.test.ts` runs 16 shared tests against three adapters: Node + better-sqlite3, Node + node:sqlite, Workers (DO SQLite + D1 in workerd via Miniflare). 51 passed, 6 skipped. The skips are adapter-specific probes that run only on their own adapter. |
| Clients converge byte for byte | **Pass** | After every scenario, each client's synced tables equal the server's, compared as one JSON string of `SELECT * … ORDER BY id` per table, with the pending queue empty. This compares row data, not files: the SQLite files themselves differ (page layout, the client's `_sync_meta`/`_mutation`/`_undo`). Includes a seeded 40-round random interleaving on three clients with random offline periods. |
| A pull after a rejected mutation removes its optimistic rows | **Pass** | Bob is demoted to viewer on the server; his device still thinks he is an editor and adds an item. After sync the item is gone locally and on the server, the queue is empty, and `rejected = [{id:1, error:"forbidden"}]`. |
| A server edit reaches the other client in under 3 s (SYNC-R42) | **Pass** | 510–535 ms on every adapter (table below). 500 ms of that is the SYNC-R38 coalescing window. |
| **Fail if** an async mutator cannot run atomically on DO SQLite or better-sqlite3 without duplicating it | **Did not happen** | One mutator body runs on all four databases; see "Riskiest assumption". Option (b) was therefore not built. |
| SYNC-A7: offline add + server rename | **Pass** | P has the server's name and contains X on both ends; exactly one P. |
| SYNC-A8, rewritten for D4 | **Pass** | An item deleted offline **stays deleted** although the server edited P meanwhile. Today it comes back; the rewrite deliberately reverses that. |
| SYNC-A10, rewritten for D14 (two variants) | **Pass** | (1) An offline purge of P, which the server meanwhile restored and renamed, is refused (`not-in-trash`); P exists with the server's name on both ends and the device pushes again. (2) An offline purge of P still in the server trash is final despite a rename. |
| SYNC-A12: label created offline that the server already has | **Pass** | Deterministic label ids (`label:` + normalised text). One `Bridge` row on both ends (the server's spelling survives), and both songs' links point at it, with no remapping. |
| Retried push after a lost response is idempotent | **Pass** | The response to a push is dropped and the client pushes again. The server dump, including the change log, is identical before and after the retry. |
| Delete versus concurrent edit | **Pass** | Delete during a reorder that names the item, and a reorder during a delete: the deletion is exact and the reorder lands on the remaining items, in both orders. |
| Old client refused with "update required" | **Pass** | `protocol: 0` → `426 {error:"update-required", minimumProtocol:1}` on push and pull; the client stops syncing and keeps its queue. 426 as in SYNC-R35 today (decided after the spike; it first used 409); clients key on `error`, not the status. |
| SQLite triggers in DO SQLite and in local D1 | **Pass (local only)** | The whole change log is trigger-written on every adapter, and a separate probe creates a trigger in D1 and in DO SQLite and sees it fire. Only workerd's local D1 and DO were tested, not Cloudflare's hosted ones. |
| Pokes over WebSocket | **Pass** | Hibernatable API (`ctx.acceptWebSocket` with the client id as tag) on the DO, `ws` on Node. The writer is not poked by its own change (SYNC-R39). |
| Electron with an embedded server, second client over the LAN | **Pass (one host)** | Electron 45.0.0 (Node 24.22.0) under `xvfb-run`, with a hardened window. A wa-sqlite "tablet" syncs over `http://192.0.2.2:<port>` (eth0, not loopback). Both directions take ~520–560 ms, and the tablet, the desktop's own client and the server converge. All four combinations passed: better-sqlite3 or node:sqlite, in Electron or in plain Node. Electron with node:sqlite also passed three runs in a row. |
| Paging (500 rows per pull page) | **Pass** | 1,200 rows arrive in exactly 3 pull requests, staged and applied in one rebase. |

### Reproduce

```sh
cd spike/sync
pnpm install
pnpm test                                       # 57 tests: 51 passed, 6 skipped (adapter-specific), ~21 s
pnpm exec vitest run --reporter=verbose         # also prints the [measure] lines
pnpm typecheck                                  # tsc 7.0.2, strict, clean
cd apps/desktop && pnpm lan-check:electron      # and lan-check:node, DESKTOP_DRIVER=node:sqlite
pnpm --filter @spike/server dev:worker          # wrangler dev; booted and served push/pull/triggers locally
```

Per adapter: Node + better-sqlite3 17 passed (16 shared + the better-sqlite3 probe), Node +
node:sqlite 16, Workers 18 (16 + the DO transaction probe + the trigger probe). The suite passed on
four consecutive full runs.

## Riskiest assumption: an async mutator, atomic, on synchronous transaction APIs

**Holds on every database tried, with one mutator body and no duplication.** A mutator is
`async (tx, args, ctx) => void` over a Drizzle SQLite database. It awaits Drizzle queries, which are
thenables on sync drivers and promises on async ones. The adapter makes each run atomic:

| Database | What works | What does not |
|---|---|---|
| better-sqlite3 (server) | `BEGIN IMMEDIATE`, `await mutator`, `COMMIT`/`ROLLBACK`, inside a per-organisation `SerialQueue` that every request to that organisation goes through, pulls included | `db.transaction(asyncFn)` throws "Transaction function cannot return a promise" (tested) |
| node:sqlite (server, Electron option) | Same as better-sqlite3, through Drizzle `sqlite-proxy` | Drizzle 0.45 has no node:sqlite driver |
| DO SQLite (`ctx.storage`) | `ctx.storage.transaction(async () => mutator(...))`. A probe that writes, awaits, writes and throws leaves **0** rows. | `sql.exec('BEGIN')` and `SAVEPOINT` are refused ("please use the state.storage.transaction() or state.storage.transactionSync() APIs"). `transactionSync(() => asyncMutator())` commits at the first `await`, and the probe leaves **2** rows, so it is *not atomic*. Drizzle's `durable-sqlite` `db.transaction()` is built on `transactionSync`, so mutators must never call `tx.transaction()`. |
| wa-sqlite (client) | `BEGIN` … `COMMIT` around the mutator and `SAVEPOINT` per replayed mutation, serialised by the client's queue | n/a |

The end-to-end test: a push of `[spikeWriteThenThrow, renamePresentation]`, where the first mutator
inserts a song, reads, updates it and throws. On all three server adapters the song is absent, its
trigger-written change-log row is absent, the rename after it landed, and `last_mutation_id`
advanced to 2. On the client the same mutator writes nothing and queues nothing. Fifteen async
mutations from each of three clients, pushed concurrently, get sort values 0..46 exactly once each.

Conditions the result depends on, which `packages/sync` should enforce:

1. Mutators await only `tx` (a lint rule on `packages/core/mutators`, as the evaluation proposes).
   On Node the queue keeps a stray `await fetch()` correct but slow. On the DO it was not tested.
2. Every use of an organisation's connection goes through its serial queue, or two requests could
   share one `BEGIN`.
3. Never use Drizzle's own `transaction()` on the DO.

## Measured

| Measure | Node + better-sqlite3 | Node + node:sqlite | Workers (local workerd) |
|---|---|---|---|
| Poke latency: push → row in the other client's DB (3 samples, 2 runs) | 511–515 ms | 510–513 ms | 523–535 ms |
| Push of 1,200 mutations in one request | 188–226 ms | 416–473 ms | 609–737 ms |
| First pull of 1,200 rows (3 pages) into wa-sqlite, rebase included | 92–125 ms | 76 ms | 93–98 ms |
| Electron LAN check, tablet → desktop / desktop → tablet | 550 / 526 ms | 546–558 / 523–530 ms | n/a |

Poke latency is dominated by the 500 ms trailing-edge window of SYNC-R38; the rest is the HTTP
pull and the rebase. Workers numbers are local workerd on this machine, not Cloudflare.

Lines per package (TypeScript, non-blank, comments included):

| Package | Files | Lines |
|---|---|---|
| `packages/core` (schema, mutators, policy, protocol, sync SQL) | 7 | 363 |
| `packages/client` (queue, undo, rebase, pokes, three SQLite adapters) | 7 | 354 |
| `apps/server` (protocol, routes, Node and Workers adapters, debug probes) | 5 | 597 |
| `apps/desktop` (Electron main, plain-Node main, LAN check) | 4 | 225 |
| `test` | 2 | 524 |
| **Product code (core + client + server)** | 19 | **1,314** |

This is consistent with the evaluation's estimate of about 2,000 lines. The spike leaves out the
scheduler, the polling backstop, multi-tab leadership, read scoping, notices and auth.

Versions: Node 22.22.0, pnpm 10.28.0 (pnpm 12.8.1 on the Mac), TypeScript 7.0.2, Vitest 5.0.5, drizzle-orm 0.45.4, Hono
4.13.14, better-sqlite3 13.0.3, `@journeyapps/wa-sqlite` 2.0.9 (SQLite 3.53.0), Miniflare
4.20260730.0, wrangler 4.152.0, Electron 45.0.0.

## On real Cloudflare (2026-10-26)

The Worker was deployed to a real account (`workers.dev`, D1 in region EEUR), and the same test
file ran against it from a Mac in Sweden with `SYNC_ADAPTERS=remote SYNC_REMOTE_URL=<url> pnpm
test:remote`. Two runs: 18 passed, 1 skipped (the better-sqlite3-only test). That includes
convergence, offline edits, idempotent retry, rejected-mutation rollback, delete vs edit,
update-required and paging, plus the two Workers probes on hosted infrastructure:

- In a hosted SQLite DO, raw `BEGIN` is refused, `transactionSync()` keeps the rows written before
  the first await (not atomic), and `storage.transaction()` rolls back. Same as local workerd.
- SQLite triggers fire in a hosted DO and in hosted D1.

| Measure (2 runs) | Hosted Workers |
|---|---|
| Poke latency, push → row in the other client's DB | 588–677 ms |
| Push of 1,200 mutations in one request | 824–955 ms |
| First pull of 1,200 rows (3 pages) | 194–248 ms |

Poke latency is the 500 ms window plus about 90–180 ms of round trips. The Worker and the database
were deleted after the runs.

## In real browsers (2026-10-26)

`pnpm test:browser` serves `apps/web` from the Node server's origin, as the desktop serves tablets,
and drives it with Playwright 1.64.1 in Chromium, WebKit and Firefox. The page runs the unchanged
`SyncClient` in a dedicated worker, on the synchronous wa-sqlite build with `OPFSCoopSyncVFS`. Two
runs, 15 of 15 passed both times.

- An edit made offline survives a page reload on OPFS, with the same client id and its queued
  mutation, and reaches a Node client once online. `PRAGMA integrity_check` is `ok`.
- Two tabs on the same database file, 40 concurrent writes: none failed, 40 distinct mutation ids,
  both tabs pushed, and the server ended with each write once. The tabs share one client id, since
  it lives in the file. So no leader tab is needed for correctness at this scale, but one would
  still avoid two WebSockets and duplicate pulls.
- **WebKit has no OPFS in an ephemeral context.** `navigator.storage.getDirectory()` fails with
  `UnknownError`, as in Safari's private browsing. Chromium and Firefox allow it. The product needs a
  fallback there: in-memory with a warning, or IndexedDB.

| Measure (2 runs) | Chromium | WebKit | Firefox |
|---|---|---|---|
| Poke latency, Node → browser | 510–519 ms | 505–531 ms | 513–526 ms |
| Poke latency, browser → Node | 502–513 ms | 500–513 ms | 500–513 ms |
| First pull of 1,200 rows into OPFS | 66–75 ms | 77–85 ms | 94–99 ms |

## Not proven, and why

- **Hosted Cloudflare is only partly proven.** The tests above passed on a real account. Still
  unproven: real hibernation (no eviction-and-wake cycle was exercised; the poke coalescer's
  `setTimeout` keeps an object awake for 500 ms after a write), behaviour under load, and where the
  DO was placed.
- **Browsers are only partly proven.** See "In real browsers" below. Still unproven: Safari on a
  real iPad (Playwright's WebKit on macOS is close, not the same), the async or JSPI builds, OPFS
  quota and eviction, and a pull rebasing in one tab while the other tab writes.
- **The LAN was one machine.** The tablet used the host's eth0 address, so packets never left the
  host. Wi-Fi, a second device, firewalls and pairing were not tested. The sync path has no
  internet dependency in code, but "network unplugged" was not physically demonstrated. The sandbox
  has outbound internet through a proxy, which this traffic does not use.
- **Capacitor** was not touched.
- **Auth is fake.** The bearer token is the user id. The membership lookup in D1 or `global.sqlite`
  is real.
- **Left out of scope:** read scoping by permission (SYNC-R2; the cookie's scope hash covers role
  and schema, and a role change does force a reset, which the rejected-mutation test exercises),
  multi-version mutators (only the floor check exists), pruning of delete markers with a reset
  window, the 5-minute poll (SYNC-R43), user-facing notices, and SYNC-R39's "two writers in one
  window exclude nobody" (implemented, not tested).
- **Scale and randomness:** one seeded 40-round random run per adapter, five tables, 1,200 rows. It
  is not a property-test campaign and not the 871-song/3,527-part dataset.
- **Option (b)** (data in D1 with a write-buffering `tx`) was not built, because option (a) worked.

## Surprises

1. **`transactionSync` silently breaks async mutators.** It does not throw: it commits at the first
   `await`, and the remaining writes autocommit outside it. Drizzle's `durable-sqlite`
   `transaction()` inherits this. Only the async `storage.transaction()` is correct.
2. **better-sqlite3 13 is a Node-API addon.** The binary built for Node 22 loads unchanged in
   Electron 45 (ABI 150), so no `electron-rebuild` is needed. I first assumed otherwise: there is no
   ABI-specific prebuilt, and `artifacts.electronjs.org` (Electron headers) is blocked by this
   sandbox's proxy. That is why node:sqlite was added as a second driver. It works too, and needs no
   native module at all.
3. **Electron's npm postinstall download failed** behind the proxy (an undici assertion). A plain
   `curl` of the release zip worked. `xvfb-run` leaves Electron orphaned unless the whole process
   group is signalled.
4. **Miniflare 4.20260730's workerd only accepts compatibility dates up to 2026-08-06**, while
   wrangler 4.152's own workerd is 2026-10-19. The spike pins `2026-08-01`.
5. **The repository root `.gitignore` ignores `**/packages/*`** (a NuGet rule), which silently drops a
   pnpm monorepo's `packages/`. The real rewrite must fix that at the root.
6. **Rebase needed no special cases.** The rewritten A7, A8, A10 and A12 fell out of
   "undo, apply, replay" plus exact mutators and deterministic ids. Each scenario is a property of a
   mutator (`onConflictDoNothing`, a trash check in `purgePresentation`), not of the engine.
7. **Pushes on the DO are about 3× slower than on better-sqlite3 locally** (one `storage.transaction`
   per mutation). That is irrelevant at human rates, but worth batching for an import.

## Recommendation

**Go, with changes.** Keep decision 2 and build `packages/sync` from this code, with these changes:

1. Encode the three atomicity conditions above: the mutator lint rule, every organisation access
   behind its queue, and no `tx.transaction()`. Add the DO probe to CI as a regression test.
2. Before building features on Workers, deploy this spike once to a free Cloudflare account. Run the
   same test file against the deployed URL, since the harness only needs a base URL, to close the
   hosted DO, D1-trigger and hibernation gaps.
3. Run the client in a real browser on wa-sqlite + OPFS in a worker (Playwright) with the same
   scenarios. Those are the riskiest parts left.
4. ~~Choose 409 or 426 for "update required", and fix the root `.gitignore`.~~ Done: 426, and the NuGet `packages` rule is scoped to the .NET solution.
