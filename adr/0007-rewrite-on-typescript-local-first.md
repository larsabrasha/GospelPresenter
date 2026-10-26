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
   database is SQLite: on Cloudflare, each organisation's data in its Durable Object's own SQLite and
   global tables (users, logins, organisations, device tokens) in D1; libsql or better-sqlite3 on
   Node, wa-sqlite on OPFS in the browser, better-sqlite3 in Electron, capacitor-sqlite on mobile. One
   schema and one dialect, shared by server and clients.

   Three reasons. It is the stack of the author's other apps. The development loop is fast — Vite
   HMR, Vitest, and no containers needed to develop. And operation is cheap and simple: on Cloudflare
   there is nothing to run; self-hosted it is **one container and a SQLite file**, with Litestream
   recommended for backup, and a folder on disk for media (D31).

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
   - **We build our own engine.** Zero, PowerSync and Electric need Postgres and a separate sync
     service, Replicache is archived, and the rest fail D4 or are not mature
     (`research/sync-engine-evaluation.md`). The protocol follows the one Replicache documents:
     a last mutation id per client, a pull cookie, a reset when the cookie cannot be served, and a
     client-side rebase. A two-day spike proves it before anything else is built on it.
   - **On Cloudflare, an organisation's data lives in its Durable Object** — the same object that
     holds its live state (D2, decision 4). D1 has no interactive transactions, only atomic
     `batch()`, so it cannot run a mutator that reads, checks permission and writes atomically; a
     Durable Object's SQLite can, and it holds up to 10 GB per object on the paid plan. D1 keeps the
     global tables that are not synced per organisation. On Node and in the desktop the same split
     is one SQLite file per organisation beside a global one, so the organisation is one unit for
     data, sync and live on every runtime.

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

7. **Mobile: drop MAUI (D6). Tablets that must work offline run the Capacitor app.** A page that a
   tablet loads from the desktop over plain `http` on the LAN is not a secure context, so the
   browser gives it no OPFS and no `crypto.randomUUID`; the sync spike confirmed this on a real iPad.
   Such a tablet can only work online against the desktop, with its data in memory. The Capacitor
   app has real SQLite and no secure-context rule, so it keeps its data through reloads and outages.
   https on the LAN was rejected: every tablet would have to trust a certificate the desktop makes.
   - **The browser stays a client** for the cloud and for https self-hosting, on OPFS. Where OPFS is
     missing (Safari private browsing, or plain http) it falls back to memory and says so.
   - Driving an external display from a phone or tablet would need a small native plugin, and is out
     of scope unless someone asks for it.

### Rendering, media and import

8. **One slide renderer at a fixed logical 1920×1080, scaled with a CSS transform**, for preview,
   thumbnails, output and print. Themes are data: JSON validated with Zod, carrying the properties of
   ADR 0001 and spec section 5.

9. **Media keys are content-addressed** (a hash of the content) and stored behind a small interface
   with three adapters (D31): R2 through its Workers binding on Cloudflare; a folder on disk in the
   desktop app and, by default, when self-hosted; and the S3 API (Garage, MinIO, AWS) as an option for
   self-hosting. Clients compress before upload. Media is
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

12. **Auth: Google and passkeys; no passwords and no generic OIDC.** The device flow with
    per-scheme callbacks stays (spec 01, ADR 0005). First-run setup requires a setup token (D19);
    the current app now has one too, on branch `claude/security-fixes`.

    *Amended after this ADR was written*, by the owner's decision; it replaces "Google and OIDC". It
    was first amended to "Google only, passkeys later", and then again to add passkeys at once, so
    that a church and its users need not depend on Google. A user may have a Google account,
    passkeys, or both. Passwords stay out: on Workers they need a key-derivation function inside a
    request's CPU budget, and Web Crypto offers only PBKDF2, which hosted Workers cap at 100 000
    iterations, below OWASP's 600 000, while scrypt and argon2 need a native module or compatibility
    flags. Milestone 3 built email and password with PBKDF2 for the offline desktop host, and that is
    removed. No generic OIDC: each provider is one more thing to configure and test.
    - **Google with the authorization code flow, PKCE, `state` and `nonce`,** and the ID token
      verified by the server against Google's published keys with Web Crypto, so the same code runs on
      Node, Workers and Electron with no library. better-auth is not used.
    - **Passkeys (WebAuthn) verified by the server with Web Crypto too,** with no library: ES256,
      EdDSA and RS256 keys, user verification required, attestation "none", discoverable credentials so
      sign-in needs no username, and a single-use challenge bound to the browser that began the
      ceremony. A passkey is bound to its RP ID: one made for the cloud's domain does not work on a
      desktop host, whose RP ID is `localhost`, and the reverse.
    - **Logins are linked** in a table of (provider, subject, user) — spec 01's `UserLogin` — by
      Google's `sub` or the passkey's credential id, never matched by email. A signed-in user adds
      and removes their own, but never the last one; an admin's new invite is the way back in, and it
      replaces every login the user had.
    - **The desktop app signs in through the system browser and the device flow,** for passkeys as
      for Google: Electron's support for platform authenticators is unreliable, and its window's
      `127.0.0.1` origin cannot be an RP ID. Google needs the internet once; a passkey on the host
      does not. Other devices on the LAN never sign in against the host — they pair, and the pairing
      code signs them in as the member the host chose.
    - **No generic OIDC provider and no mock login.** Tests use a fake Google that only a test build
      can be pointed at, and a software authenticator.

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
  our own was the fallback, not the default. **Settled after this ADR was written:** the evaluation
  in `research/sync-engine-evaluation.md` found no engine that meets all of these, so we build our own
  (decision 2), with organisation data in the organisation's Durable Object on Cloudflare. **The
  spike passed** (`spike/sync/RESULTS.md`): on Node, on hosted
  Cloudflare, in Chromium, WebKit and Firefox on OPFS, and between a Mac and a real iPad on the LAN.
  Still unproven: Durable Object hibernation, load, Safari on iPad with OPFS, and Capacitor.
- **The PPTX cost figures in (10)** are estimates until measured against real church decks.
- **D8, decided after this ADR was written:** the embedded LAN server does not replace the server
  field. The desktop and mobile sign-in screen gets a discreet "Other server" link, prefilled with the
  hosted server, so one installed app works against the cloud and any self-hosted server (ADR 0002
  (29)). Updates keep coming from GitHub Releases; a server-provided feed waits for code signing.
- **D1, decided after this ADR was written:** one organisation per user for now, with super admins
  switching, but memberships are a table (user, organisation, role) from the start so several
  organisations per user can be enabled without a migration.
- **D30, decided after this ADR was written:** an imported Bible always lives on the server the device
  belongs to: the hosted server, a self-hosted one, or the desktop app's embedded server when someone
  runs alone. Every device of the organisation then gets it. An import made offline is stored on the
  device and uploaded when it is connected again. Device-only Bibles, which the current app has
  (BIBLE-R16), are not built: running alone is already covered by the desktop app, and two kinds of
  Bible would double the cases in the UI, sync and tests. If a translation's licence forbids sharing
  it within a church, this is reopened.
- **D31, decided after this ADR was written:** media is stored in a folder on disk by default when
  self-hosted, and in the desktop app; S3 (Garage, MinIO, AWS) is an option; R2 is used through its
  Workers binding. A content-addressed key needs only put, get and delete, which a folder does as well
  as S3, so a self-hosted install needs no Garage: one container, a SQLite file and a media folder,
  backed up by copying. What a folder cannot do: be shared by several server instances (a SQLite file
  already rules those out) or take uploads straight from clients through presigned URLs, so uploads
  go through the server, which is fine at a church's sizes.
- **D32, decided after this ADR was written:** how each platform is packaged and reaches its users.
  - **macOS:** electron-builder makes a `.dmg` to install and a `.zip` for electron-updater, for Apple
    Silicon and Intel. **At first without a Developer ID and without notarization**; both come later.
    Until then the app is only ad-hoc signed: macOS blocks the first start, and the user allows it
    under System Settings → Privacy & Security → "Open Anyway". This sets aside ADR 0002 (7) for
    now. Automatic updates need a real signature on macOS (Squirrel.Mac checks it), so until then
    the app tells the user a new version exists and links to the download.
  - **Windows:** an NSIS installer per user, without admin rights, updated by electron-updater.
    **Not code-signed**: the SmartScreen warning is accepted, as ADR 0002 (3) already did.
  - **Linux:** an AppImage, the format electron-updater can update. `.deb` and `.rpm` can be added,
    without automatic updates.
  - **iOS, later:** the Capacitor app through TestFlight and the App Store, the only practical way
    onto iOS. This is an exception to ADR 0002 (2)'s direct download, and each update goes through
    Apple's review.
  - **Android:** the Capacitor app, as a signed APK to download or through Google Play. Which, or
    both, is still open.
  - **The Capacitor app updates its web part over the air.** Almost the whole app is web, and the
    store rules allow downloaded code that runs in the WebView as long as it does not change what the
    app is for. Only changes to the native shell (new plugins, a new Capacitor, permissions) go
    through the stores and their review. Each web bundle states the shell version it needs; a bundle
    that fails at start rolls back to the previous one; the current bundle is kept on the device so
    the app starts offline. A 426 from the server is a cue to fetch a new bundle. **We host the
    updates ourselves; no third-party update service.** The bundle comes from the server the app is
    connected to, which already serves the same web files (the Worker's static assets, the Docker
    image, the desktop host), so the app's web part always matches its server's version, also on a
    self-hosted server or a desktop host on the LAN. The plugin on the device may be an open-source
    one used against our own server, if its licence allows; otherwise we write the small native part
    ourselves.
  - **Every web bundle is signed, and the app runs only bundles we built.** CI signs each bundle with
    an Ed25519 key; the signature covers a hash of every file, the version and the shell version it
    needs. The public key is built into the native shell, which checks the signature before it
    activates a bundle and refuses to go back to an older version, except to the bundle that came
    with the shell. So it does not matter where a bundle comes from: the cloud, a self-hosted server,
    or a desktop host over plain http on the LAN. Without this, anyone on the LAN could swap a bundle,
    a compromised server could plant code that stays on the device and later runs against another
    server (D8), and an old bundle with a known flaw could be sent again. The private key lives only
    in GitHub Actions' secrets. A modified build of the app needs its own shell with its own key,
    which GPLv3 allows.
  - **Web on Cloudflare:** Vite's static files deployed with the Worker as static assets by
    `wrangler deploy`.
  - **Self-hosted web: a Docker image**, the "one container" of (1): Node, the server and the web
    files, with one volume at `/data` for the SQLite files and the media folder (D31). Built for amd64
    and arm64 in GitHub Actions and published to GHCR; run with `docker run` or a small
    `compose.yaml`. The server in the image should use `node:sqlite`, as the desktop app does, so the
    image needs no native module built per architecture.
  - **The rule behind the update paths: native code comes from one trusted source, web code from the
    server.** A native shell can do anything on the device, so the desktop app updates only from
    GitHub Releases (D8, ADR 0003) and the Capacitor shell only through its store or download; no
    server, self-hosted or not, can push native code. The Capacitor app's web part runs in the
    WebView's sandbox, like the same app in a browser, so its server may serve it. The desktop app's
    web part ships inside the app, because the embedded server must match it.
  - **All of it is built in GitHub Actions:** a macOS runner for macOS and iOS, Linux for Linux,
    Android and Docker, and Windows on Linux or its own runner.
