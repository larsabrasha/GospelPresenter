# Gospel Presenter, rewrite

The TypeScript, local-first rewrite decided in `adr/0007-rewrite-on-typescript-local-first.md`,
built from the behaviour spec in `spec/`. It runs beside the current .NET app until it has proved
itself.

Milestone 1 was one song, one presentation, output on a second screen, and sync between two clients,
in Electron with no internet. Milestone 2 makes songs and presentations behave as spec 02 and 03 say:
arrangements, ranked search, the trash, item arrangements, renaming and moving items, and the event
date after create. The output window reads through the operator window's database, so it also works
where OPFS is missing. Milestone 3 brings real sign-in, membership and pairing (spec 01, ADR 0007
decisions 6 and 12), so the desktop host can serve other devices on the LAN. Sign-in is with Google
only: there are no passwords.

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

export GP_GOOGLE_CLIENT_ID=… GP_GOOGLE_CLIENT_SECRET=…   # the host's Google client (see "Sign-in")
pnpm --filter @gp/desktop start            # the desktop app: the host, on 127.0.0.1:47800
GP_LAN=1 pnpm --filter @gp/desktop start   # the host, reachable on the LAN
GP_SERVER=http://127.0.0.1:47800 GP_DATA_DIR=/tmp/gp-second pnpm --filter @gp/desktop start
                                           # a second client of the first; pairing signs it in
pnpm --filter @gp/desktop serve            # the server alone on :8787, then `pnpm --filter @gp/web dev`
```

Needs Node 22 or later and pnpm 12. The e2e opens real windows, and plays the system browser and
Google itself (`apps/server/test/fake-google.ts`), so it needs no internet and no Google client. `?storage=memory` in the page URL
(`GP_STORAGE=memory` for the desktop app) keeps the database in memory, as where OPFS is missing.

### Sign-in, membership and pairing

Sign-in is with Google, and nothing else: no passwords and no generic OIDC provider (ADR 0007
decision 12). A user is linked to a Google account by its `sub`, in `user_logins`; the email is only
filled in, and never used to find a user (spec 01, AUTH-R4). There is no self-registration: a Google
account that is not linked, signing in without an invite, is refused.

The first start of the host shows "Välkommen!": the person names themselves and the church, and setup
answers with an invite for the new SuperAdmin, which they accept by signing in with Google. Setup is
done when that link exists; until then it can be done again, and finishes the same SuperAdmin rather
than making a second church. The host window gets the setup token from the main process; a server
without one prints it (`Setup token: …`) and the setup form asks for it (D19). After that every
account comes from an admin: Användare → Skapa makes the user and an invite link, shown once, valid
for 7 days and once (AUTH-R1). The invited person opens it and signs in with Google, and that account
becomes theirs. A new invite for a user is the reset: the Google account that accepts it replaces the
old one, and the user's sessions end. The same page changes roles and removes users, with spec 01's
rules (PERM-R4–R6, D20, D21) in `packages/core/src/accounts.ts`, which the server and the UI share.

How the sign-in runs (`apps/server/src/google.ts`, `auth.ts`): the authorization code flow with PKCE
(S256), `state` and `nonce`, and `prompt=select_account`. A sign-in in progress is a row in
`login_flows`: single use, 10 minutes, and bound to the browser that started it by a cookie, so a
callback from another browser, a forged `state` or a replay is refused. The ID token is checked with
Web Crypto: RS256 only, against Google's published keys (cached, fetched again for a new key at most
once a minute), then `iss`, `aud`, `exp`, `iat`, `nonce`, `sub` and `email_verified`. Why a sign-in was
refused goes to the server log; the user sees one generic error (spec 01). A browser comes back to
`#/signed-in`, and the page collects its session with a one-time cookie (`POST /auth/google/finish`),
so no token is in a URL.

The desktop app never shows Google in its own windows. It opens the server's `/app-login?device=…&
callback_scheme=…` in the system browser (spec 01 device sign-in), or, to accept an invite, a flow its
window began; the server hands the token back on the app's callback scheme in the URL fragment. The
schemes are `gospelpresenter`, `gospelpresenter-test` and `gospelpresenter-local`, compared exactly;
any other is refused before a sign-in even starts, and no token is minted (AUTH-R10). The app waits 5
minutes for one callback and ignores any other. A development build uses `gospelpresenter-local` and
registers it with the operating system only with `GP_REGISTER_SCHEME=1`, so a dev run does not take
over the scheme; on macOS it then arrives as `open-url`, elsewhere as a second launch.

Signing in needs the internet once. After that the host opens straight into its own database with
its session, with no network. On a host, the system browser's sign-in is answered only from the host
machine itself (loopback): a device on the LAN never signs in with Google against the host.

A sign-in gives the device a session token (`gpdt_…`, only its SHA-256 stored). Every request reads
the session and the user's role from the global tables (D22): a demoted user's next pull starts over
with the new role, and a removed user's next request gets 401. A signed-in device opens straight into
its own database with no network; when the server refuses it, sync stops, local edits wait, and the
status bar asks it to sign in again (SYNC-A15).

The desktop host refuses every API request from a device it has not paired, on localhost too: only
the static app and `/pair/status`, `/pair/claim` answer (and the sign-in above, from the host machine).
Its own window's requests carry a host token that the Electron main process adds and no page sees. On
the host, Enheter → Anslut enhet asks who the device signs in as (the admin, or a member they may make
an invite for), and shows a six-digit code (10 minutes, one use, dead after five wrong guesses); the
other device types it and gets a device token (`gppd_…`) and a session as that member. Pairing is how
a device signs in to a host, also after its session ends. Enheter also disconnects a device, which
stops it and ends the session its pairing made. `pnpm --filter @gp/desktop serve` has no pairing
unless `GP_LAN=1`.

**Configuration.** Node (`startNodeServer({ google })`, and `GP_GOOGLE_CLIENT_ID`,
`GP_GOOGLE_CLIENT_SECRET`, `GP_GOOGLE_REDIRECT_BASE_URL` for `serve`): the client id and secret, and
the public origin the redirect URI is built from (`{origin}/auth/google/callback`; without it, the
origin of the request). The desktop host reads `GP_GOOGLE_CLIENT_ID` and `GP_GOOGLE_CLIENT_SECRET`;
its redirect is `http://127.0.0.1:47800/auth/google/callback`. The Worker reads `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` (a secret) and `GOOGLE_REDIRECT_BASE_URL`. Without a client id and secret,
Google is off: `/auth/state` says so, and setup and sign-in are refused (503 `google-disabled`).
Paired devices and sessions already made keep working.

**The fake Google** (`apps/server/test/fake-google.ts`) is an OIDC issuer with its own key, JWKS,
authorization and token endpoints, for the server tests and the e2e. A server uses it only through
`GoogleConfig.testIssuer` (`GOOGLE_TEST_ISSUER`, `GP_GOOGLE_TEST_ISSUER`), and only in a build that
defines `GP_TEST_ISSUER` as true: the Vitest config, the Miniflare harness and the development
desktop build. `pnpm --filter @gp/server build:worker`, `wrangler.toml` and a desktop build with
`GP_RELEASE=1` define it false, and such a build refuses to start with a test issuer set (tested for
the Worker deploy bundle and for `google.ts` bundled with and without the definition). A packaged
desktop app (`app.isPackaged`) also never reads `GP_GOOGLE_TEST_ISSUER`.

**Passkeys later.** `user_logins (provider, subject, user_id)` is the seam: a passkey will be a row with
provider `passkey` and its credential id as `subject` (its public key in a column or table beside it),
linked the same way, through an invite or from a signed-in session. `LOGIN_PROVIDERS` in
`packages/core/src/accounts.ts` names the providers that exist; nothing for passkeys is built.

A database records its schema version in `_schema`. One made by an older version (milestone 1 has no
row: version 1) is migrated when it is opened, on the server and on clients; a client then pulls
everything again, because the schema is part of the pull cookie. The server's global database has
its own version (`GLOBAL_SCHEMA_VERSION`, now 3): the placeholder memberships of milestones 1 and 2
are dropped when it migrates, so data made by the old desktop host belongs to no account afterwards.
Version 3 drops milestone 3's passwords and its per-account lockout, and adds `user_logins` and
`login_flows`; users, memberships and sessions stay. Nobody has a linked login after it, so setup opens
again and finishes the existing SuperAdmin and church; other users need a new invite, or on a host a
new pairing.

## Not done yet

Bible, images, themes, templates, English text, mobile, and deploying to Cloudflare. The Workers
adapter is tested in local workerd only.

From spec 01 and milestone 3: passkeys (the seam is above); OIDC providers other than Google, which
are not planned (ADR 0007 (12)); any mail at all (an admin's new invite link is the reset); packaging
the desktop app, so its callback scheme is registered by an installer (a development build registers
`gospelpresenter-local` only with `GP_REGISTER_SCHEME=1`) and its Google client is built in; a login
hint or profile picture from Google; more than one Google account per user (ORG-R13 allows 5);
profiles and profile images, `/settings` and the
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

- **Google only.** Spec 01 also has generic OIDC and a mock login; the owner decided on Google now and
  passkeys later, with no passwords and no generic OIDC (ADR 0007 (12)). The tests use the fake Google
  in its place, and there is no mock login in the app.
- **Spec 01 E4 is refused**: an invite accepted with a Google account already linked to another user
  fails (`login-taken`) and leaves the invite unused, rather than signing in as the invited user while
  the login stays with the other.
- **An invite replaces the user's Google account** and ends their sessions: it is how an admin resets
  a lost account, which is why an Admin may not make one for a SuperAdmin (D20, D21). Email is
  required for users an admin makes, lower-cased and unique (01 Q2 limits uniqueness to real
  addresses); the setup SuperAdmin has none until Google fills it in. An email Google gives is filled
  in only when the user has none and no other user has it.
- **Setup is done when a user has a linked login**, not when a user exists, so a setup left before
  Google, or a church migrated from milestone 3, can be finished with the setup token.
- **Throttling** (the spec has none): twenty failures from one address (setup token, pairing code)
  lock that address for 15 minutes. At most 20 unfinished Google sign-ins per address at a time. On
  Node the address is the socket's: behind a reverse proxy every client shares the proxy's.
- **The redirect URI comes from configuration, or from the request.** Without
  `GOOGLE_REDIRECT_BASE_URL` (or `redirectBaseUrl`), the origin of the request that starts the sign-in
  is used; Google refuses any redirect URI that is not registered, so a wrong Host header fails rather
  than leaks. A deploy should set it.
- **Sessions live 90 days from their last use** (spec 01 has device tokens without expiry and web
  sessions of 240 minutes; a local-first browser is a device). At most 10 per user; an eleventh
  sign-in revokes the least recently used. Signing out revokes the session on the server when it can
  be reached (spec 01 only forgets it locally), and keeps the local database (D3).
- **Roles are read on every request, uncached** (D22, AUTH-R7 without the 30 s cache). The client
  refreshes its stored identity in the background and shows a new role at once; its optimistic
  checks use the role from its last start.
- **Removing a user deletes them** (ORG-R12), with their logins, sessions, invites and membership.
- **Pairing is required for every device on the desktop host, localhost included**, so `GP_LAN=1`
  only changes the address it listens on. Codes come only from the host's own window, signed in with
  ManageUsers: whoever pairs a device is at the host, and chooses who it signs in as. Six digits rather
  than spec 04's four, 10 minutes, one at a time, single use, and dead after five wrong guesses. A
  device token never expires; disconnecting it on the host is how it ends, with its session.
- **On a host, an invite is accepted at the host.** Its window offers "Logga in som … här", which
  signs the host window in as the invited person through the system browser. Other devices cannot use
  an invite against a host: they pair.
- **The host listens on a fixed port, 47800** (`GP_PORT` overrides): devices on the LAN reconnect to
  the same address, and the host window's session and OPFS database belong to its origin.
- **Secrets travel in headers and bodies, never URLs**: invite tokens go in a request body (the link
  keeps them in the fragment), and the poke socket carries its tokens as WebSocket subprotocols. The
  exceptions are OAuth's own: `state` and the one-use code in Google's redirect, and the device token
  in the callback URL's fragment (spec 01), which no server sees.
- **The static app has a strict CSP** (`default-src 'self'`, plus `'wasm-unsafe-eval'` for wa-sqlite
  and inline styles for React) on the Node server. The sign-in pages the server renders have their own
  (`default-src 'none'; script-src 'self'`). The Worker serves no static files yet, so a web sign-in
  there comes back to a page it cannot serve.
- **`SPIKE_DEBUG` left `wrangler.toml`**: the debug routes (which mint sessions) and `SETUP_TOKEN`
  belong in `.dev.vars` or secrets, never in a file that ships with a deploy. Without `SETUP_TOKEN`
  the Worker refuses setup.
- **LIVE-R20: the "Visas nu" preview hides the part label too**, as the output does: it shows what
  the screen shows. Thumbnails keep it.
