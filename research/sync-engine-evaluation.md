# Sync engine evaluation for the rewrite

- **Date:** 2026-10-26
- **Question:** ADR 0007, Open questions: "Zero, PowerSync or Replicache, or our own"
- **Inputs:** ADR 0007 decision (2) and (3); decisions D2, D3 and D4 in `spec/README.md`; the sync
  rules and conflict cases in `spec/06-sync-desktop-platform.md` (SYNC-R1 to R53, Q1 to Q10)

## Summary and recommendation

**Build our own, as a Replicache-style push/pull mutation log on Drizzle and SQLite, and copy
Replicache's documented protocol instead of inventing one.**

No off-the-shelf engine meets all the hard requirements. The decisive facts:

- **Zero** is the best fit for the mutation model: custom mutators re-run on our server through a
  push endpoint. But its server, `zero-cache`, needs **Postgres 15+ with logical replication** as
  the upstream database ([Connecting to Postgres](https://zero.rocicorp.dev/docs/connecting-to-postgres),
  [Self-Hosting Zero](https://zero.rocicorp.dev/docs/self-host)). That means no D1, no single SQLite
  file, and no Electron LAN server.
- **PowerSync** and **ElectricSQL** are row replication from Postgres-family databases through a
  separate always-on service. PowerSync's bucket storage is MongoDB or Postgres; SQLite storage is
  only a proposal ([changelog June–July 2026](https://powersync.com/blog/powersync-changelog-june-july-2026)).
- **Replicache** has exactly the model we want, and runs on any backend. But it is in maintenance
  mode, its GitHub repo was archived on 2026-06-10 ([rocicorp/replicache](https://github.com/rocicorp/replicache)),
  the last npm release was 15.3.0 on 2025-07-02 (npm registry), and its client store is a key-value
  store, not SQLite. A mutator could then not be "one function that runs against the client's
  database and the server's without translation" (ADR 0007 (1)).
- **LiveStore, Jazz, TinyBase, Triplit and cr-sqlite** are event-log or CRDT/LWW engines. None
  re-executes a named mutation against the server's state with our authorization, and several
  cannot scope reads by permission (SYNC-R2).

The protocol we need is small and well documented by Replicache itself
([push](https://doc.replicache.dev/reference/server-push), [pull](https://doc.replicache.dev/reference/server-pull),
[row-version strategy](https://doc.replicache.dev/strategies/row-version)). Our own version is an
estimated **2,000 lines of product code plus about 1,500 lines of tests**, which we would own, can
run unchanged on Workers, Node and Electron, and can version the way SYNC-R35 needs.

Revisit only if Zero ships a SQLite or D1 upstream. Its docs say other databases will come "in the
future" ([Connecting to Postgres](https://zero.rocicorp.dev/docs/connecting-to-postgres)).

**Method note.** This sandbox could not reach most vendor sites directly. Facts come from web
search results quoting the official docs, from GitHub pages, and from the npm registry
(`registry.npmjs.org`, queried 2026-10-26, for latest versions, dates and licence fields). Anything
not confirmed that way is marked *unverified*.

## Comparison

Requirements: **R1** server re-executes named mutations with our authorization; **R2** SQLite/D1 as
the server database, on Workers and on Node; **R3** self-host as one process, also inside Electron;
**R4** licence compatible with a distributed GPLv3 app; **R5** one local database per account and
organisation, partial and permission-scoped reads; **R6** client SQLite on web (OPFS), Electron and
Capacitor; **R7** maturity.

| Candidate | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
|---|---|---|---|---|---|---|---|
| **Zero** | ✅ custom mutators run in our push endpoint | ❌ Postgres 15+, `wal_level=logical` | ❌ `zero-cache` service + Postgres | ✅ Apache-2.0 | ✅ query-based partial sync | ⚠️ IndexedDB on web, expo-sqlite as KV on RN; not SQL | ✅ 1.0 in June 2026, 1.11.3 on 2026-10-23 |
| **Replicache** | ✅ the reference model | ✅ any backend | ✅ our server | ⚠️ conflicting licence data | ✅ `name` per user/org | ❌ KV store, mutators not SQL | ❌ maintenance mode, repo archived |
| **PowerSync** | ⚠️ writes go to our API; downstream is row replication | ❌ Postgres, MongoDB, MySQL, SQL Server | ❌ separate service + MongoDB/Postgres storage | ⚠️ service FSL-1.1-ALv2 | ✅ Sync Streams | ✅ wa-sqlite/OPFS, Node SDK (beta), Capacitor (alpha) | ✅ service 1.27.2 on 2026-10-24 |
| **ElectricSQL** | ❌ read path only | ❌ Postgres logical replication | ❌ Elixir service + Postgres | ✅ Apache-2.0 | ✅ shapes | ⚠️ HTTP shapes; PGlite is Postgres | ✅ client 1.5.28 on 2026-09-09 |
| **Triplit** | ❌ triple store, attribute merge | ⚠️ unverified | ⚠️ unverified | ✅ AGPL-3.0 (combinable with GPLv3) | ⚠️ | ⚠️ | ❌ last release 2025-07-31 |
| **LiveStore** | ⚠️ named events, but no server state to re-run against | ✅ DO SQLite or D1; ⚠️ no first-party Node backend found | ⚠️ custom backend needed | ✅ Apache-2.0 | ⚠️ store per org fits D3; no permission-scoped reads in a store | ✅ OPFS, Expo, Node; ⚠️ Capacitor unverified | ⚠️ 0.5.0, pre-1.0 |
| **Jazz** | ❌ CRDT CoValues | ⚠️ 2.0 moving to SQLite | ⚠️ | ✅ MIT | ⚠️ | ⚠️ | ❌ 2.0 is alpha, protocol breaks |
| **TinyBase sync** | ❌ HLC last-writer-wins CRDT | ✅ Durable Object server | ✅ | ✅ MIT | ❌ no read scoping | ⚠️ in-memory store persisted to SQLite | ✅ 10.0.1 on 2026-09-24 |
| **cr-sqlite** | ❌ LWW CRDT | ❌ loadable extension; not on D1 | ⚠️ | ✅ Apache-2.0/MIT | ❌ | ⚠️ | ❌ last npm release 2024-01-17 |
| **Build our own** | ✅ by design | ✅ Drizzle on D1/DO, libsql, better-sqlite3 | ✅ part of the Hono server | ✅ ours, GPLv3 | ✅ per-org DB, table scoping by permission | ⚠️ needs Drizzle adapters for wa-sqlite and capacitor-sqlite | ⚠️ bus factor of one, but small and owned |

### Dropped early

- **ElectricSQL** fails R1, R2 and R3. It reads Postgres's logical replication stream and serves
  shapes over HTTP; writes are left to our API ([electric.ax](https://electric.ax/),
  [Postgres Sync](https://electric.ax/sync/postgres-sync)). Reported as 1.0 GA in March 2025 by a
  third party ([QueryPlane](https://queryplane.com/blog/electricsql-postgres-sync-engine/)). Its
  homepage mentions joining Neon at Databricks; *unverified*.
- **Triplit** fails R1 and R7. The co-founder joined Supabase on 2025-10-08 and Supabase said it is
  not folding Triplit into its platform ([Supabase blog](https://supabase.com/blog/triplit-joins-supabase)).
  The last npm release of `@triplit/client` is 1.0.50 on 2025-07-31, licence AGPL-3.0-only.
- **Jazz** fails R1 and R7. Version 2.0 is an alpha (2.0.0-alpha.59 on 2026-10-04) with
  sync-protocol-breaking releases ([alpha.56](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.56)),
  a rewritten SQLite engine ([PR #4190](https://github.com/garden-co/jazz/pull/4190)), and a README
  that describes running "across your frontend, backend and our global storage cloud"
  ([garden-co/jazz](https://github.com/garden-co/jazz)). Permissions are group-based on CRDT values,
  not mutations replayed against server state.
- **TinyBase** fails R1 and R5. A `MergeableStore` is a last-writer-wins CRDT on hybrid logical
  clocks ([Using a MergeableStore](https://tinybase.org/guides/synchronization/using-a-mergeablestore/)).
  It has a ready Durable Object server ([WsServerDurableObject](https://tinybase.org/api/the-essentials/synchronizing-stores/wsserverdurableobject/)),
  but authorization means overriding its WebSocket handlers, and nothing scopes reads.
- **cr-sqlite** fails R1, R2 and R7. It is a runtime-loadable SQLite extension doing LWW CRDT merges
  ([README](https://cdn.jsdelivr.net/gh/vlcn-io/cr-sqlite@main/README.md)). D1 offers no raw
  database access, so no extension loading (inferred from [sqlx-d1](https://docs.rs/crate/sqlx-d1/0.4.1);
  no Cloudflare statement found, *unverified*). Last npm release 0.16.3 on 2024-01-17; last repo
  push October 2024 per a [third-party snapshot](https://awesome.ecosyste.ms/projects/github.com%2Fvlcn-io%2Fcr-sqlite).

## Serious candidates

### Zero (Rocicorp)

- **Model.** Clients run ZQL queries against a local partial copy; `zero-cache` replicates Postgres
  into a SQLite replica and streams query results over WebSocket. Writes are **custom mutators**
  defined once with `defineMutators`; the client runs them optimistically and the server runs them
  through a push endpoint on our own API, transactionally, rolling back if they throw
  ([Mutators](https://zero.rocicorp.dev/docs/mutators), [Writing data](https://zero.rocicorp.dev/docs/writing-data)).
  That satisfies D4 exactly.
- **Server database.** "Only Postgres is supported today"; Postgres 15+, `wal_level = logical`, and
  a direct, non-pooled replication connection ([Connecting to Postgres](https://zero.rocicorp.dev/docs/connecting-to-postgres),
  [Deploying Zero](https://zero.rocicorp.dev/docs/deployment)). No Workers deployment of
  `zero-cache` was found (*unverified*).
- **Licence and maturity.** `@rocicorp/zero` is Apache-2.0 on npm, and so is the
  [rocicorp/mono](https://github.com/rocicorp/mono) monorepo (3.4k stars). 1.0 was declared stable
  in June 2026 ([InfoQ](https://www.infoq.com/news/2026/06/zero-version-1/),
  [release notes](https://zero.rocicorp.dev/docs/release-notes/1.0)); latest is 1.11.3 on
  2026-10-23, with daily canary builds. Rocicorp is a small company; the mono README notes some
  packages are now published from an internal repository.
- **Client.** IndexedDB on the web; on React Native an expo-sqlite provider is passed as a `kvStore`
  ([React Native](https://zero.rocicorp.dev/docs/react-native)). The client store is not a relational
  SQLite database we can query with Drizzle. Capacitor and Electron stories *unverified*.
- **Verdict.** Fails R2 and R3. Adopting it would add Postgres back to self-hosting (the thing ADR
  0007 removes) and leave the Electron LAN server without a database it can run.

### Replicache (Rocicorp)

- **Model.** The model ADR 0007 names: client mutators, `lastMutationID` per client, pull with a
  cookie, server re-runs mutations against its own state. The server is ours, on any database
  ([remote mutations](https://doc.replicache.dev/byob/remote-mutations)).
- **Status.** The homepage says it is in maintenance mode, open-sourced and free, and that users
  should migrate to Zero ([replicache.dev](https://replicache.dev/), as quoted in search results).
  The GitHub repo was archived on 2026-06-10. Last npm release 15.3.0 on 2025-07-02.
- **Licence.** Conflicting: `packages/replicache/package.json` in rocicorp/mono says Apache-2.0
  ([source](https://github.com/rocicorp/mono/blob/main/packages/replicache/package.json)), while the
  published npm 15.3.0 says `https://roci.dev/terms.html`. Earlier, v10 moved from BSL to closed
  source ([releases](https://github.com/rocicorp/replicache/releases)). *Unverified* which applies.
- **Verdict.** Do not depend on it; **copy its protocol**. Its client stores key-value pairs, so
  mutators would be written against `tx.get/set` on the client and SQL on the server, two
  implementations of each mutation.

### PowerSync (JourneyApps)

- **Model.** Server-to-client row replication into client SQLite, filtered by Sync Streams (GA in
  June 2026). Client writes go into an upload queue and `uploadData()` sends them to **our** backend,
  which does validation and authorization ([handling writes](https://docs.powersync.com/handling-writes/)).
  We could send named mutations there, but the client's local view is rebuilt from replicated rows,
  not by replaying pending mutations; on PowerSync Cloud, custom write checkpoints are limited to
  the Team and Enterprise plans ([custom write checkpoints](https://docs.powersync.com/handling-writes/custom-write-checkpoints)).
- **Server.** Source databases are Postgres, MongoDB, MySQL, SQL Server (and Convex)
  ([powersync-service](https://github.com/powersync-ja/powersync-service)). The service is a
  separate Docker image that needs a MongoDB or Postgres bucket store
  ([self-hosted configuration](https://docs.powersync.com/configuration/powersync-service/self-hosted-instances));
  SQLite storage is an experiment ([changelog](https://powersync.com/blog/powersync-changelog-june-july-2026)).
- **Licence.** The service is FSL-1.1-ALv2 (npm `@powersync/service-core`), source-available,
  converting to Apache-2.0 after two years ([fair source](https://powersync.com/blog/powersync-supports-fair-source));
  the SDKs are Apache-2.0. Shipping it inside a GPLv3 Electron app would be mere aggregation of a
  non-free component — legally workable, but against the spirit of a free self-host.
- **Client.** The best client story here: wa-sqlite on OPFS or IndexedDB, a Node SDK (beta) for
  Electron's main process, and a Capacitor SDK (alpha) on `@capacitor-community/sqlite`
  ([Capacitor SDK](https://powersync.com/blog/introducing-the-powersync-capacitor-sdk)).
- **Verdict.** Fails R2 and R3, weak on R1 and R4.

### LiveStore

- **Model.** Event sourcing: clients commit named events, materialise them into SQLite, and sync
  through an ordered event log. On Cloudflare the backend is a Durable Object storing events in DO
  SQLite (D1 opt-in), with `validatePayload` and `onPush`/`onPull` hooks
  ([Cloudflare provider](https://docs.livestore.dev/reference/syncing/sync-provider/cloudflare/)).
- **Against D4.** The server holds a log, not materialised state, so it cannot re-run "add song to
  presentation" against the latest presentation and refuse it on our permission policy. Per-event
  checks in `onPush` would need a server-side materialisation. All clients of a store replay the
  whole log, so a user without ViewSongs cannot be kept from songs inside an org store (SYNC-R2,
  SYNC-A2). No first-party Node sync backend was found (*unverified*).
- **Status.** Apache-2.0; 0.5.0 on 2026-10-15; pre-1.0 with a small core team.
- **Verdict.** Closest in spirit after Replicache, but fails R1 and the permission part of R5.

### Build our own

Meets every requirement by construction; the cost is code we maintain and correctness we must
prove. The design follows.

## Design sketch: our own engine

### Principles

- One `packages/sync` with no framework dependency; mutators live in `packages/core` and receive a
  `tx` (a Drizzle transaction) plus `ctx` (user, organisation, role, `can()`).
- Mutators are **deterministic**: ids, timestamps and random values are arguments, generated on
  the client. They read only through `tx`.
- **Client and server run the same mutator code.** The server is authoritative; the client result
  is a prediction.

### Tables

Client, in each per-account-and-organisation database (D3):

| Table | Columns | Purpose |
|---|---|---|
| `_sync_meta` | `client_id`, `cookie` (last seq + scope hash), `schema_version`, `protocol` | one row |
| `_mutation` | `id` (local, monotonic), `name`, `v`, `args` (JSON), `created_at` | pending queue |
| `_undo` | `tbl`, `pk`, `before` (JSON or null) | pre-image of each row pending mutations touched |

Triggers on every synced table write the first pre-image of a row into `_undo` while pending
mutations exist; pulls run with capture off, so applied rows are never echoed (SYNC-R14).

Server, per database (D1, a Durable Object, or the Node SQLite file):

| Table | Columns | Purpose |
|---|---|---|
| `sync_change` | `seq` INTEGER PRIMARY KEY AUTOINCREMENT, `org_id`, `tbl`, `pk`, `op` (put/del); unique (`tbl`,`pk`) | one row per entity, moved to a new `seq` on each change |
| `sync_client` | `client_id`, `org_id`, `user_id`, `last_mutation_id`, `last_seen` | idempotent push |
| `sync_mutation_result` | `client_id`, `mutation_id`, `error` | rejected mutations, reported once |

`sync_change` rows are written by **SQLite triggers** on the synced tables, so no code path can
forget to record a change, which is the `ModifiedAt` rule of today's `CLAUDE.md` made mechanical.
Upserting by (`tbl`, `pk`) keeps the log compact: it holds the latest change per row, so there is
no 90-day tombstone horizon for live rows. Delete markers older than a retention window can be
pruned, and a cookie older than that window gets a reset.

### Push: `POST /sync/push`

Body: `{ protocol, schemaVersion, clientId, mutations: [{ id, name, v, args }] }`.

1. Authenticate (SYNC-R1). Unknown `protocol` or a mutator version below the floor →
   `426 { error: "update-required" }`; the client stops pushing and keeps its queue (SYNC-R35).
2. Route to the organisation's serialization point (below). For each mutation in order:
   `id <= last_mutation_id` → skip (retry after a lost response); `id > last + 1` → error, client
   resets; otherwise run the mutator inside a savepoint. If it throws or `can()` refuses, roll back
   its writes, record the error, and still advance `last_mutation_id` (SYNC-R28: never retried
   verbatim).
3. Commit the effects and `last_mutation_id` together (Replicache's atomicity rule,
   [server push](https://doc.replicache.dev/reference/server-push)).
4. Poke the organisation, naming the originating client.

### Pull: `POST /sync/pull`

Body: `{ cookie, clientId, schemaVersion }`. Response: `{ cookie, lastMutationId, results, patch, more }`.

- `patch` = rows from `sync_change WHERE org_id = ? AND seq > cookie.seq ORDER BY seq LIMIT 500`
  (SYNC-R9), joined to the current rows, **restricted to tables the caller may read** (SYNC-R2).
- The cookie carries a **scope hash** of (role, permissions, schema version). If it differs —
  the role changed, a permission was gained, or the client migrated — the server answers
  `clear` plus a full patch, as Replicache's reset does ([server pull](https://doc.replicache.dev/reference/server-pull)).
- The client stages all pages, then in one transaction: restore `_undo` pre-images, apply the
  patch with foreign keys deferred (replaces SYNC-R10 ordering), drop mutations
  `<= lastMutationId`, replay the remaining ones, and re-capture `_undo`. This **rebase** is what
  makes SYNC-R26 (end on the server's version, keep pushing) automatic, and it replaces SYNC-R15.
- Sequence numbers are assigned inside the writing transaction by a single-writer SQLite, so they
  are in commit order and ADR 0006's long-transaction hazard (06 Q10) cannot occur.

### Serialization, transactions and realtime (D2)

- **Workers.** The organisation's Durable Object handles both pushes and pokes, so pushes per
  organisation are serial. D1 has no interactive transactions; only `batch()` is atomic
  ([Oskar Dudycz](https://event-driven.io/en/cloudflare_d1_transactions_and_tradeoffs/)), which does
  not fit a mutator that reads, decides and writes. Two options for the spike:
  - **(a) Organisation data in the DO's own SQLite** (Drizzle `durable-sqlite`,
    [docs](https://orm.drizzle.team/docs/connect-cloudflare-do)), 10 GB per object on the paid plan
    ([limits](https://developers.cloudflare.com/durable-objects/platform/limits)), with real
    transactions. D1 keeps global tables (users, memberships, device tokens, globally unique output
    codes for SYNC-R29). **Preferred.**
  - **(b) Data in D1**, with the mutator's writes buffered and committed in one `batch()` together
    with `last_mutation_id`. Keeps one database but needs a write-buffering `tx`.
- **Node and Electron.** An in-process queue per organisation plays the DO's role; better-sqlite3 or
  libsql gives ordinary transactions.
- **Poke.** After a commit the DO (or in-process hub) sends `{ org, seq }` over the WebSocket it
  already holds for live state, coalesced to one per 500 ms (SYNC-R38), skipping the originating
  client (SYNC-R39). Clients pull on a poke and still poll as a backstop (SYNC-R43). On Workers use
  hibernatable WebSockets so idle organisations cost nothing.

### Versioning and migrations

- `protocol` integer for the wire format; each mutator has a version `v`. The server keeps old
  mutator versions for a support window and announces a floor; below it, "update first".
- Server schema changes are expand-then-contract across at least one support window; pulls send
  rows as JSON and clients ignore unknown columns.
- Clients bundle Drizzle migrations and run them when a per-account database opens. A migration
  that changes synced tables changes the scope hash, so the next pull is a reset; the pending queue
  survives because it stores mutation names and arguments, not rows.

### The conflict cases in spec 06

| Today | With mutations |
|---|---|
| SYNC-R20 song changed on both sides, server wins, push saved to history | Field and part mutations merge; a clash on the same part (D18) is detected by a base hash in `editSongPart`; the server keeps its text, saves the pushed text as a version, returns a notice |
| SYNC-R21 / Q4 / Q5 presentation merge, additions beat deletions | `addItem`, `removeItem`, `reorderItems`, `renamePresentation` each touch only what they name: exact |
| SYNC-R22 edited offline, deleted on server | Mutator finds no row: no-op plus a notice naming the right entity (fixes Q2) |
| SYNC-R24 / R25 offline delete vs server edit; trash | `trashPresentation` sets `deleted_at`; a purge requires the row to be in the server trash (D14) |
| SYNC-R18 label text collision, `Remapped` | Deterministic ids: a label id is derived from organisation and normalised text, settings keyed by name; duplicates converge without remapping |
| SYNC-R29 globally unique output codes | Server mutator claims the code in D1 with a conditional insert; on collision it assigns a new one, the pull corrects the client, a notice tells the operator |
| SYNC-R12 85-day watermark | Compacted change log; only pruned delete markers force a reset, after the push |
| Q1 another account on the device | One database per account and organisation (D3); queues never mix |

### Size estimate

| Part | Lines |
|---|---|
| Shared protocol types, mutator registry, versions | 250 |
| Client: queue, undo triggers, rebase, push/pull loop, scheduler (SYNC-R45–R52), poke socket, multi-tab leader | 900 |
| Server: push, pull, scope hash, trigger generation from the Drizzle schema, per-org queue | 650 |
| Durable Object and Node hubs for pokes | 200 |
| **Product code** | **about 2,000** |
| Tests: protocol, rebase property tests, spec 06 acceptance scenarios on both adapters | about 1,500 |

Estimated bundle cost: tens of kilobytes on top of the SQLite WASM build the client needs anyway
(*unverified until measured*).

## Risks

- **Rebase correctness.** Undo, apply, replay must be exact, or clients drift silently (ADR 0007
  Consequences). Mitigate with property tests that replay random mutation interleavings on two
  clients and the server and compare databases byte for byte.
- **Non-deterministic or impure mutators** (clock, random ids, fetches). Mitigate with a lint rule
  on `packages/core/mutators` and arguments generated by the caller.
- **Async mutators against synchronous transaction APIs.** better-sqlite3 and DO SQLite expose
  synchronous transactions; client wa-sqlite is async. The spike must prove one mutator signature
  works on all of them (per-org serial queue with explicit `BEGIN`/`COMMIT` on Node, DO storage
  transactions on Workers).
- **D1 limits** push organisation data into Durable Objects (option a): cross-organisation queries
  (super admin, the PostgreSQL import) and backups need their own path.
- **SQLite triggers on D1 and DO SQLite** are assumed to work; *unverified*, spike item.
- **Drizzle on wa-sqlite/OPFS and capacitor-sqlite** needs `sqlite-proxy` adapters; multi-tab OPFS
  access needs a single writer (SharedWorker or Web Locks leader).
- **Bus factor.** One maintainer owns the engine. It is small, documented by the Replicache protocol
  it copies, and pinned by the spec 06 acceptance scenarios.
- **Large first sync** (871 songs, 3,527 parts measured today): pages of 500 must stage and apply
  fast enough on a low-end tablet.

## Next step: a two-day spike

Goal: prove the protocol, the rebase and the Workers transaction story, or find what breaks them.

**Result (2026-10-26):** passed locally, verdict "go, with changes"; see [`spike/sync/RESULTS.md`](../spike/sync/RESULTS.md).

- **Day 1, Node.** `packages/core` with three mutators (`createPresentation`, `addSongToPresentation`,
  `reorderItems`) and Drizzle schema; Hono push/pull on better-sqlite3 with trigger-written
  `sync_change`; a browser client on wa-sqlite/OPFS with `_mutation`, `_undo` and rebase.
  Tests: two clients, offline edits, scenarios SYNC-A7, A8, A10 and A12 rewritten for mutations, a
  retried push after a lost response, and an old client refused with "update required".
- **Day 2, Workers and Electron.** The same server on Workers with a Durable Object per
  organisation: option (a) in DO SQLite, triggers verified on DO SQLite and D1, a poke over a
  hibernatable WebSocket. Then the Node server embedded in Electron, a second client on the LAN,
  network unplugged.
- **Pass if:** both adapters pass the same test file; clients converge byte for byte; a pull after a
  rejected mutation removes its optimistic rows; a server edit reaches the other client in under
  3 s (SYNC-R42).
- **Fail if:** an async mutator cannot run atomically on DO SQLite or better-sqlite3 without
  duplicating it. Then fall back to option (b) or revisit Zero with Postgres for the hosted edition
  only.
