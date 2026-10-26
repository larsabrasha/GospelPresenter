# 7. Rewrite on TypeScript, local-first, deployable to Cloudflare and self-hosted

- **Status:** Accepted
- **Date:** 2026-10-26
- **Scope:** the whole application. Supersedes the technology choices of the current .NET stack:
  Blazor Server, EF Core, PostgreSQL, SignalR, Electron.NET, MAUI and .NET Aspire
- **Builds on:** the behaviour spec in `spec/`, and the decisions D2–D5 recorded in its index
- **Settles:** D6 (drop MAUI) and D29 (PDF and PowerPoint import) in `spec/README.md`, and fixes the
  mechanism for D19 (setup token) and D28 (media caching)

## Context

Gospel Presenter is a Blazor Server app on PostgreSQL, with a desktop app that runs the same ASP.NET
process inside Electron against a local SQLite copy, and a MAUI app that does the same on phones. It
works, and the behaviour spec in `spec/` describes what it does in enough detail to rebuild it
without reading the C#.

Four things make a rewrite worth its cost rather than a matter of taste:

- **Offline is bolted on.** The server owns the data and devices catch up through timestamp
  stamping, tombstones and per-entity conflict policies. `GospelPresenter/CLAUDE.md` spends a full
  section on rules a contributor must remember by hand (`ExecuteUpdateAsync` must stamp
  `ModifiedAt`, child changes must bump the root, every new path needs a pinning test). Offline
  deletes can be resurrected by a merge (06 Q4), presentation fields merge all-or-nothing (06 Q5), and
  a transaction held open longer than the pull overlap can hide rows from a pull (06 Q10, ADR 0006).
- **Everything assumes one server process.** Live sessions, the doorbell groups, the Bible cache and
  the setup flag all live in memory (04 Q16, 06 Q9). ADR 0004 and ADR 0006 both end on "still one web
  instance".
- **Operating it is heavy.** Self-hosting needs PostgreSQL, a migration container, Garage and the
  web app. Development needs Docker for Aspire. The desktop bundle is 380 MB, half of it a
  self-contained .NET runtime that only a release of this app can patch (ADR 0003).
- **It is not the author's stack.** The author's other apps are React, TypeScript, Vite, Hono and
  SQLite on Cloudflare. One person maintains this; sharing tooling, libraries and habits with the
  other apps is worth more than any single property of .NET.

## Decision

**Rewrite the app in TypeScript as a local-first application, deployable both to Cloudflare and as a
self-hosted container, and run it beside the current app until it has proved itself.**

### Stack

1. **React + TypeScript + Vite clients; a Hono server; Drizzle on SQLite everywhere.** The server runs
   on Cloudflare Workers and on Node — Node for self-hosting and embedded in the desktop app. Every
   database is SQLite: D1 on Cloudflare, libsql or better-sqlite3 on Node, wa-sqlite on OPFS in the
   browser, better-sqlite3 in Electron, capacitor-sqlite on mobile. One schema and one dialect,
   shared by server and clients.

   Three reasons. It is the stack of the author's other apps. The development loop is fast — Vite
   HMR, Vitest, and no containers needed to develop. And operation is cheap and simple: on Cloudflare
   there is nothing to run; self-hosted it is **one container and a SQLite file**, with Litestream
   recommended for backup, beside the S3 store it already needs for media.

   The same dialect on both ends is what makes (2) workable: a mutation is one function that runs
   against the client's database and the server's without translation.

### Data and sync

2. **Local-first, with named mutations replayed on the server.** Every client reads from its own local
   SQLite. Writes are named **mutations** — `addSongToPresentation`, `reorderItems` — defined once in
   a shared package. A mutation runs optimistically on the client, is pushed to the server, and the
   server re-runs the same mutation against its latest state, with the authorization check, and
   pushes the resulting changes back. This is the Replicache model.

   This is D4, and it retires `ModifiedAt` stamping, tombstones as a client-visible mechanism, and
   "additions win". A deletion is a mutation that deletes exactly what it names; two edits to
   different fields both land because each mutation sets only its own.

   - **The protocol is versioned from day one.** A mutation carries a version, and the server can
     answer "update first" instead of guessing at an old client's meaning. Local schema migrations
     run on clients too, because every client holds a real database.
   - **Pulls are cursored by server-assigned monotonic sequence numbers, not timestamps.** SQLite and
     D1 serialise writers, so a sequence number assigned inside the write transaction is in commit
     order, and the long-transaction hazard of ADR 0006 cannot occur.
   - **Zero, PowerSync and Replicache are evaluated before we build our own.** See Open questions.

3. **One local database per account and organisation (D3).** Signing in as another account opens
   another database; switching back resumes its unsynced work. Nothing is wiped and nothing is pushed
   under the wrong organisation.

### Live

4. **Live state is a small state object, and output is a pure function of local content plus the live
   pointer.** Only the pointer travels in real time — BroadcastChannel between windows on one machine,
   WebSocket on the LAN and in the cloud, SSE for public `/watch`. Edits made during live therefore
   reach the screen without extra work (D7).

   On Workers, **one Durable Object per organisation** holds every concurrent session, output and
   controller (D2). On Node and in the desktop's embedded server the same code runs in process.
   Public `/watch` fan-out may move to a Durable Object per output if it grows.

5. **Access to live (D5).** Live windows and paired screens carry a capability token. Starting and
   controlling a presentation need `ManagePresentations`. Public `/watch` stays open and read-only.

### Hosts

6. **Desktop: Electron with an embedded Hono server.** Tablets and output screens connect to it over
   the church LAN when the internet is down. Pairing is by QR code or PIN, and the LAN server is never
   open without it. Electron is hardened: `contextIsolation` on, `nodeIntegration` off, a narrow
   preload, and a strict CSP.

7. **Mobile: drop MAUI (D6).** Start as a PWA; wrap it with Capacitor when app-store presence or
   native plugins are needed. Driving an external display from a phone or tablet would need a small
   native plugin, and is out of scope unless someone asks for it.

### Rendering, media and import

8. **One slide renderer at a fixed logical 1920×1080, scaled with a CSS transform**, for preview,
   thumbnails, output and print. Themes are data: JSON validated with Zod, carrying the properties of
   ADR 0001 and spec section 5.

9. **Media keys are content-addressed** (a hash of the content) and stored through the S3 API — R2 on
   Cloudflare; Garage, MinIO or any S3 when self-hosted. Clients compress before upload. Media is
   served `Cache-Control: private, immutable`, which a content-addressed key makes safe (D28).

10. **PDF and PowerPoint import (D29).**
    - **PDF is converted entirely in the client** with pdf.js, within today's limits (PRES-R11).
    - **PPTX goes through LibreOffice** (Gotenberg, which converts PowerPoint today): Cloudflare
      Containers on Cloudflare, an optional sidecar when self-hosted. It returns a PDF, which then
      takes the PDF path. Without the sidecar PPTX import is unavailable and PDF import still works.
    - **Text is also extracted from the PPTX XML at import**, for search and the stage display.
    - **Animations, transitions and embedded video are not supported.** This is an explicit, accepted
      loss, and the import screen says so as it does today.
    - **Cost on Cloudflare.** Containers are included in the $5/month Workers Paid plan: 25 GiB-hours
      of memory, 375 vCPU-minutes and 200 GB-hours of disk a month. At `standard-1` (1/2 vCPU,
      4 GiB) and about two minutes awake per import, memory runs out first, at roughly 190 imports a
      month; after that each costs about $0.0016. These are estimates, to be measured.
    - **Native in-browser PPTX viewers were rejected.** Office Online needs a public URL and cannot
      be driven. The open-source renderers have poor fidelity. The commercial WASM SDKs have licences
      incompatible with GPLv3 self-hosting.

### Code and tooling

11. **A pnpm + Turborepo monorepo.** `apps/server`, `apps/web`, `apps/desktop`, `apps/mobile`;
    `packages/core` (domain, Zod schemas, mutations, and the permission policy as pure functions
    `can(user, action, resource)`), `packages/db`, `packages/sync`, `packages/ui`.
    - End-to-end types through Hono RPC. TypeScript strict mode.
    - **`CLAUDE.md` rules become lint rules where they can**: no raw `<button>`, and a missing
      translation is a type error through typed i18n keys (Lingui or i18next). A rule a linter
      enforces does not depend on a reviewer remembering it.
    - **CI runs the test suite against both the Workers and the Node adapter.**

    One policy module used by both the mutation layer and the UI is how "a visible link always means
    an allowed action" holds, which the spec found false in several places today.

12. **Auth: Google and OIDC, plus the existing device flow with per-scheme callbacks.** better-auth is
    a candidate. First-run setup requires a setup token (D19); the current app now has one too, on
    branch `claude/security-fixes`.

### Getting there

13. **The old and new apps run side by side.** A one-way import moves data from the current
    PostgreSQL database. The new app goes to the test channel first and must survive real services
    before it replaces the old one.

    Build order: the data model and sync first, then live and realtime, then the editing UIs. The
    first milestone is one song, one presentation, output on a second screen, and sync between two
    clients — working in Electron with no network.

14. **The behaviour spec in `spec/` is the requirements baseline.** Rules and acceptance scenarios
    are cited by id (`SONG-R12`, `LIVE-A7`) in commits and tests, and the acceptance scenarios become
    Playwright tests. A section is done when its scenarios pass against the new app.

### What carries over from ADRs 0002–0006

The earlier ADRs mix product decisions with .NET mechanisms. The product decisions are requirements
for the new app; the mechanisms are retired with the stack.

- **ADR 0002 — carries over:** direct download rather than an app store (2); updates that apply at
  the next start and never interrupt a live presentation (16)–(18); the file-system layout's
  reasoning (20)–(23); client version headers and a protocol floor (24)–(25), which become the
  mutation version in (2); the update feed stays compiled in until packages are signed (30).
  **Retired:** nothing beyond what ADR 0003 already retired; the .NET seams that implemented these
  (`IAppUpdater`, `ClientProtocolFloorFilter`) are rebuilt, not ported.
- **ADR 0003 — carries over:** Electron as the desktop host; the projector window placed on the first
  non-primary display and made fullscreen after ready-to-show (7); electron-updater with every
  target updatable, and a pushed tag building a draft release (10)–(12); GitHub Releases as the feed
  (13); the language taken from the operating system as Electron reports it (15). **Retired:**
  Electron.NET, ASP.NET serving Blazor over localhost, and the self-contained .NET runtime.
- **ADR 0004 — carries over:** the device that starts a presentation owns it and drives its projector
  from local state; only a selection travels, never a rendered slide; commands are absolute; losing
  the connection freezes outputs and only the owner ends a session; a desktop's song usage is counted
  once. **Retired:** `LiveSessionHub`, `LiveCommandForwarder`, `MirroredSessionRegistry` and the
  server-side slide rebuild — a pointer plus local content replaces them. Its "authorization is
  unchanged" is replaced by (5).
- **ADR 0005 — carries over:** one installation per environment, each with its own identifier, data
  directory, token and callback scheme, and no runtime server switch; callback schemes declared by
  the client and allow-listed by the server, with an unknown scheme rejected before a token is minted.
  **Retired:** the MSBuild props and the `GP0002`–`GP0004` checks, which need equivalents in the new
  build rather than ports.
- **ADR 0006 — carries over:** an announcement carries only the organisation; the device that caused
  a change is not woken by it; a revoked token stops the client rather than retrying; a periodic pull
  stays as a backstop so the announcement is never load-bearing. **Retired:** the SignalR hub, the
  save-changes interceptor, manual rings after `ExecuteUpdateAsync`, `PullOverlap`, and the
  long-transaction hazard with them.

## Consequences

- **Months before parity.** The current app keeps serving churches throughout, and fixes to it
  continue. Every month of overlap is a month of maintaining two apps.
- **Sync is harder to reason about than a server-owned model.** A mutation runs twice, against two
  different states, and must be deterministic and safe to replay. Bugs show up as clients that
  disagree, not as errors. The acceptance scenarios in section 6 exist for this.
- **Two runtimes to test.** Workers and Node differ in APIs, limits and database drivers. CI runs
  both (11), and that roughly doubles the server half of every CI run.
- **Workers limits push heavy work out of the server.** CPU time per request and bundle size rule
  out image processing and document conversion on a Worker, so it moves to clients (compression,
  PDF rendering) or to containers (PPTX).
- **PPTX needs a container or a sidecar.** A self-hoster who runs one container gets PDF import and
  no PPTX import, and the UI must say why.
- **Electron installers stay over 100 MB.** Dropping the .NET runtime removes about 150 MB of the
  380 MB, but Electron itself is the rest.
- **The desktop's open problems remain.** Linux token storage is a plain 0600 file, and macOS still
  needs a Developer ID certificate and notarization — and their cost — before it can be distributed
  or update itself (ADR 0003). A rewrite does not touch either.
- **Fewer rules to remember.** The sync-tracking section of `CLAUDE.md` has no equivalent in the new
  app, and several UI rules become lint errors rather than review comments.

## Open questions

- **Zero, PowerSync or Replicache, or our own.** Each must be checked against: SQLite on both ends
  and on Workers, a self-hosted server with no external service, GPLv3-compatible licensing, server
  re-execution with our own authorization, and one database per account and organisation. Building
  our own is the fallback, not the default.
- **The PPTX cost figures in (10)** are estimates until measured against real church decks.
- **D8 is still open:** whether the desktop's embedded LAN server changes the plan for a server field
  on the sign-in screen and a server-provided update feed.
