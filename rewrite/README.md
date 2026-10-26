# Gospel Presenter, rewrite

The TypeScript, local-first rewrite decided in `adr/0007-rewrite-on-typescript-local-first.md`,
built from the behaviour spec in `spec/`. It runs beside the current .NET app until it has proved
itself.

Milestone 1 was one song, one presentation, output on a second screen, and sync between two clients,
in Electron with no internet. Milestone 2 makes songs and presentations behave as spec 02 and 03 say:
arrangements, ranked search, the trash, item arrangements, renaming and moving items, and the event
date after create. The output window reads through the operator window's database, so it also works
where OPFS is missing. Milestone 3 brings real sign-in, membership and pairing (spec 01, ADR 0007
decision 6), so the desktop host can serve other devices on the LAN.

| Package | What it is |
|---|---|
| `packages/core` | Schema and its migrations, mutators with Zod-validated arguments, permissions, slides, song search, live pointer |
| `packages/sync` | The sync engine: client (rebase, pokes) and server (push, pull, change log) |
| `apps/server` | Hono server on Node (one SQLite file per organisation) and on Workers (a Durable Object per organisation) |
| `apps/web` | React + Vite client: wa-sqlite on OPFS in a worker |
| `apps/desktop` | Electron: the embedded server, the main window and the output window |

```sh
pnpm install
pnpm build
pnpm lint && pnpm typecheck && pnpm test   # unit and sync tests, on Node, node:sqlite and local workerd
pnpm e2e                                   # milestones 1–3 in Electron, with real windows

pnpm --filter @gp/desktop start            # the desktop app: the host, on 127.0.0.1:47800
GP_LAN=1 pnpm --filter @gp/desktop start   # the host, reachable on the LAN
GP_SERVER=http://127.0.0.1:47800 GP_DATA_DIR=/tmp/gp-second pnpm --filter @gp/desktop start
                                           # a second client of the first; it pairs, then signs in
pnpm --filter @gp/desktop serve            # the server alone on :8787, then `pnpm --filter @gp/web dev`
```

Needs Node 22 or later and pnpm 12. The e2e opens real windows. `?storage=memory` in the page URL
(`GP_STORAGE=memory` for the desktop app) keeps the database in memory, as where OPFS is missing.

### Sign-in, membership and pairing

The first start of the host shows "Välkommen!": the person sets up the church and becomes its
SuperAdmin. The host window gets the setup token from the main process; a server without one prints
it (`Setup token: …`) and the setup form asks for it (D19). After that every account comes from an
admin: Användare → Skapa makes the user and an invite link, shown once, valid for 7 days and once
(AUTH-R1). The invited person opens it, chooses a password and is signed in. The same page changes
roles and removes users, with spec 01's rules (PERM-R4–R6, D20, D21) in `packages/core/src/accounts.ts`,
which the server and the UI share.

A sign-in gives the device a session token (`gpdt_…`, only its SHA-256 stored). Every request reads
the session and the user's role from the global tables (D22): a demoted user's next pull starts over
with the new role, and a removed user's next request gets 401. A signed-in device opens straight into
its own database with no network; when the server refuses it, sync stops, local edits wait, and the
status bar asks it to sign in again (SYNC-A15).

The desktop host refuses every API request from a device it has not paired, on localhost too: only
the static app and `/pair/status`, `/pair/claim` answer. Its own window's requests carry a host token
that the Electron main process adds and no page sees. On the host, Enheter → Anslut enhet shows a
six-digit code (10 minutes, one use, dead after five wrong guesses); the other device types it and
gets a device token (`gppd_…`). Enheter also disconnects a device, which stops it at once.
`pnpm --filter @gp/desktop serve` has no pairing unless `GP_LAN=1`.

A database records its schema version in `_schema`. One made by an older version (milestone 1 has no
row: version 1) is migrated when it is opened, on the server and on clients; a client then pulls
everything again, because the schema is part of the pull cookie. The server's global database has
its own version (`GLOBAL_SCHEMA_VERSION`, now 2): the placeholder memberships of milestones 1 and 2
are dropped when it migrates, so data made by the old desktop host belongs to no account afterwards.

## Not done yet

Bible, images, themes, templates, English text, mobile, and deploying to Cloudflare. The Workers
adapter is tested in local workerd only.

From spec 01 and milestone 3: Google and OIDC sign-in (ADR 0007 (12)); password reset by email and
any mail at all (an admin's new invite link is the reset); the device sign-in through the system
browser with callback schemes (AUTH-R10, ADR 0005); profiles and profile images, `/settings` and the
language switch; organisations other than the one setup makes, the SuperAdmin switcher and super admin
pages; a user in several organisations (D1 leaves it for later); listing and revoking your own
devices' sessions (D23; removing the user or pairing again are the ways today); `/admin/devices`;
MCP keys and calendar feeds; the welcome modal; a QR code for pairing (the code is typed); closing
an open poke socket when its session is revoked (it receives only sequence numbers until it closes,
and its next sync is refused); `X-Forwarded-For` behind a reverse proxy (see Assumptions).

From spec 02 and 03 in particular: song history (SONG-R20–R24, D9), the labels page, CCLI, ProPresenter
import, the dashboard's Idag/Kommande sections and "last changed" order, event time, place,
description and theme, multi-select removal, the keyboard help dialog, the song editor inside the add
dialog, the clash warning of D18, and drag and drop (moving is by ↑ and ↓ buttons). Song fields
still save when a field loses focus rather than 500 ms after typing.

## Assumptions

Where the spec and ADR 0007 leave a choice open, the conservative one, written down:

- **The output never opens a database.** It always reads through the operator window's worker over a
  BroadcastChannel, with OPFS or without. If no operator window answers, a read waits and is asked
  again every second, and the output keeps showing what it last had.
- **Expired trash is purged when the trash page opens**, for songs too (unifying 02 Q4). The age is
  measured by the earlier of the client's and the server's clock, so a client clock that runs ahead
  never purges early. When something was trashed is the trashing client's clock.
- **"Töm papperskorgen" purges the entries the user saw**, one by one, not whatever the server holds
  by then: something trashed on another device meanwhile stays.
- **Arrangements have an explicit order** (a `sort` column, new ones last); the first is the default
  (02 Q8). Deleting a part removes every occurrence of it from every arrangement (02 Q7).
- **An item whose arrangement was deleted shows all parts** (SONG-R18 as written), not the song's
  first arrangement. Adding with no arrangement picked stores none, so the item follows the song's
  first arrangement, whatever that becomes; an arrangement that is not the song's (deleted
  meanwhile) is dropped rather than refusing the add.
- **A trashed song can still be added on the server**: an add made offline while someone else trashed
  the song keeps the item, which the editor then flags (D17).
- **Chip edits and item moves are relative**: they name the part (or item) and a place, and apply to
  the list as it is where they run, so quick edits in a row and edits from two devices compose. A
  whole-list `updateArrangement` (no UI uses it) is last writer wins.
- **Limits on the server**: 5 000 songs, 50 parts per song, 10 arrangements per song, 100 items per
  presentation (spec 02, 03), and 500 chips per arrangement (the spec limits the JSON to 5 000
  characters instead).
- **The arrangement name field shows only with two or more arrangements** (SONG-A9, as the current
  app does).
- **A purged song's items stay** in their presentations and say the song is gone.

Milestone 3 (sign-in, membership, pairing):

- **Email and password instead of Google and OIDC.** Spec 01 signs in only through providers, which
  need the internet; a desktop host on a church LAN has none, and OAuth is out of scope here. An
  invite sets a password instead of linking a provider; a new invite is also the password reset, and
  it revokes the user's other sessions. Email is required for new users, lower-cased and unique (01 Q2
  limits uniqueness to real addresses). Passwords need at least 10 characters.
- **The KDF is PBKDF2-HMAC-SHA256 with 600 000 iterations** (OWASP's 2023 figure), a 16-byte random
  salt, and the parameters stored with the hash so they can be raised. Web Crypto is the one API that
  runs unchanged in Node, Workers and Electron with no native module; it has no scrypt or argon2, and
  `node:crypto`'s scrypt is not on Workers without compatibility flags. Measured: about 70 ms in Node
  and 50 ms in local workerd. Not verified on hosted Workers, which has had a 100 000-iteration cap
  on PBKDF2: if it still does, that deploy needs a lower figure, and hashes do not move between them.
- **Sign-in throttling** (the spec has none, because providers do it): five wrong passwords lock an
  account for a minute, doubling per further failure up to 15 minutes; twenty failures from one
  address (sign-in, setup token, pairing code) lock that address for 15 minutes. The lock is checked
  before the password, and an unknown email costs a hash too, so neither timing nor answers tell
  which emails exist. A lock signs no one out. On Node the address is the socket's: behind a reverse
  proxy every client shares the proxy's, and twenty failures lock sign-in for everyone for 15 minutes.
- **Sessions live 90 days from their last use** (spec 01 has device tokens without expiry and web
  sessions of 240 minutes; a local-first browser is a device). At most 10 per user; an eleventh
  sign-in revokes the least recently used. Signing out revokes the session on the server when it can
  be reached (spec 01 only forgets it locally), and keeps the local database (D3).
- **Roles are read on every request, uncached** (D22, AUTH-R7 without the 30 s cache). The client
  refreshes its stored identity in the background and shows a new role at once; its optimistic
  checks use the role from its last start.
- **An Admin may not make an invite for a SuperAdmin**, since an invite sets the password (D20, D21).
  Removing a user deletes them (ORG-R12), with their sessions, invites and membership.
- **Pairing is required for every device on the desktop host, localhost included**, so `GP_LAN=1`
  only changes the address it listens on. Codes come only from the host's own window, signed in with
  ManageUsers: whoever pairs a device is at the host. Six digits rather than spec 04's four, 10
  minutes, one at a time, single use, and dead after five wrong guesses. A paired device still signs
  in. A device token never expires; disconnecting it on the host is how it ends.
- **The host listens on a fixed port, 47800** (`GP_PORT` overrides): devices on the LAN reconnect to
  the same address, and the host window's session and OPFS database belong to its origin.
- **Secrets travel in headers and bodies, never URLs**: invite tokens go in a request body (the link
  keeps them in the fragment), and the poke socket carries its tokens as WebSocket subprotocols.
- **The static app has a strict CSP** (`default-src 'self'`, plus `'wasm-unsafe-eval'` for wa-sqlite
  and inline styles for React) on the Node server. The Worker serves no static files yet.
- **`SPIKE_DEBUG` left `wrangler.toml`**: the debug routes (which mint sessions) and `SETUP_TOKEN`
  belong in `.dev.vars` or secrets, never in a file that ships with a deploy. Without `SETUP_TOKEN`
  the Worker refuses setup.
