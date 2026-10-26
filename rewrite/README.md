# Gospel Presenter, rewrite

The TypeScript, local-first rewrite decided in `adr/0007-rewrite-on-typescript-local-first.md`,
built from the behaviour spec in `spec/`. It runs beside the current .NET app until it has proved
itself.

Milestone 1 was one song, one presentation, output on a second screen, and sync between two clients,
in Electron with no internet. Milestone 2 makes songs and presentations behave as spec 02 and 03 say:
arrangements, ranked search, the trash, item arrangements, renaming and moving items, and the event
date after create. The output window reads through the operator window's database, so it also works
where OPFS is missing. Milestone 3 brings real sign-in, membership and pairing (spec 01, ADR 0007
decisions 6 and 12), so the desktop host can serve other devices on the LAN. Sign-in is with Google or
a passkey: there are no passwords. Milestone 4 adds Bibles and themes (spec 05), so a Sunday service
with Bible readings and a chosen look runs offline.

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
                                           # (lint also refuses a REPLACE in a mutator: see Assumptions)
pnpm e2e                                   # milestones 1–4 in Electron, with real windows

export GP_GOOGLE_CLIENT_ID=… GP_GOOGLE_CLIENT_SECRET=…   # the host's Google client (see "Sign-in")
pnpm --filter @gp/desktop start            # the desktop app: the host, on 127.0.0.1:47800
GP_LAN=1 pnpm --filter @gp/desktop start   # the host, reachable on the LAN
GP_SERVER=http://127.0.0.1:47800 GP_DATA_DIR=/tmp/gp-second pnpm --filter @gp/desktop start
                                           # a second client of the first; pairing signs it in
pnpm --filter @gp/desktop serve            # the server alone on :8787, then `pnpm --filter @gp/web dev`
GP_PASSKEY_RP_ID=localhost GP_PASSKEY_ORIGINS=http://localhost:8787 pnpm --filter @gp/desktop serve
                                           # the same with passkeys; open http://localhost:8787 (not 127.0.0.1)
```

Needs Node 22 or later and pnpm 12. The e2e opens real windows, and plays the system browser and
Google itself (`apps/server/test/fake-google.ts`), so it needs no internet and no Google client. Its
passkey tests play the system browser with Playwright's Chromium and its virtual authenticator, so
that browser must be installed once (`pnpm --filter @gp/desktop exec playwright install chromium`). `?storage=memory` in the page URL
(`GP_STORAGE=memory` for the desktop app) keeps the database in memory, as where OPFS is missing.

### Sign-in, membership and pairing

Sign-in is with Google or a passkey, and nothing else: no passwords and no generic OIDC provider
(ADR 0007 decision 12). A user has one or more logins in `user_logins`: a Google account, linked by
its `sub`, and passkeys, by their credential id. One user may have both kinds, and signing in either
way lands on the same user. The email is only filled in, and never used to find a user (spec 01,
AUTH-R4). There is no self-registration: a Google account or passkey that is not linked is refused.

The first start of the host shows "Välkommen!": the person names themselves and the church, and setup
answers with an invite for the new SuperAdmin, which they accept by making a passkey or signing in
with Google. Setup is done when that link exists; until then it can be done again, and finishes the
same SuperAdmin rather than making a second church. The host window gets the setup token from the main process; a server
without one prints it (`Setup token: …`) and the setup form asks for it (D19). After that every
account comes from an admin: Användare → Skapa makes the user and an invite link, shown once, valid
for 7 days and once (AUTH-R1). The invited person opens it and makes a passkey or signs in with
Google, and that becomes their way in. A new invite for a user is the reset: the login that accepts it
replaces every login the user had, passkeys and Google alike, and the user's sessions end.

Under Inloggningsmetoder (click your name in the header) a signed-in user sees their own logins, adds
a passkey, links a Google account, renames a passkey and removes any login but the last. Adding needs
a sign-in from the last 10 minutes, made by the user themselves (not by a pairing); otherwise the page
asks them to sign out and in again. Linking a Google account that is already another user's is
refused (`login-taken`). Nothing takes a user id: no one, an admin included, adds or removes another
user's logins. An admin's new invite is the only way back for someone who lost every login. The same page changes roles and removes users, with spec 01's
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

**Configuration of passkeys.** An explicit RP ID and the exact origins ceremonies may come from;
without both, passkeys are off and `/auth/state` says so. Node: `startNodeServer({ passkeys: { rpId,
origins } })`, and `GP_PASSKEY_RP_ID`, `GP_PASSKEY_ORIGINS` (comma-separated) for `serve`. The Worker:
`PASSKEY_RP_ID`, `PASSKEY_ORIGINS` (vars, not secrets; e.g. `app.example.org` and
`https://app.example.org`). The desktop host always has RP ID `localhost` and origin
`http://localhost:{port}`. A wrong configuration stops the server at start: an IP address as RP ID, an
origin that is not on the RP ID, or plain http anywhere but localhost.

**Configuration of Google.** Node (`startNodeServer({ google })`, and `GP_GOOGLE_CLIENT_ID`,
`GP_GOOGLE_CLIENT_SECRET`, `GP_GOOGLE_REDIRECT_BASE_URL` for `serve`): the client id and secret, and
the public origin the redirect URI is built from (`{origin}/auth/google/callback`; without it, the
origin of the request). The desktop host reads `GP_GOOGLE_CLIENT_ID` and `GP_GOOGLE_CLIENT_SECRET`;
its redirect is `http://127.0.0.1:47800/auth/google/callback`. The Worker reads `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` (a secret) and `GOOGLE_REDIRECT_BASE_URL`. Without a client id and secret,
Google is off: `/auth/state` says so, and its sign-in is refused (503 `google-disabled`). With neither
Google nor passkeys, setup is refused too. Paired devices and sessions already made keep working.

**The fake Google** (`apps/server/test/fake-google.ts`) is an OIDC issuer with its own key, JWKS,
authorization and token endpoints, for the server tests and the e2e. A server uses it only through
`GoogleConfig.testIssuer` (`GOOGLE_TEST_ISSUER`, `GP_GOOGLE_TEST_ISSUER`), and only in a build that
defines `GP_TEST_ISSUER` as true: the Vitest config, the Miniflare harness and the development
desktop build. `pnpm --filter @gp/server build:worker`, `wrangler.toml` and a desktop build with
`GP_RELEASE=1` define it false, and such a build refuses to start with a test issuer set (tested for
the Worker deploy bundle and for `google.ts` bundled with and without the definition). A packaged
desktop app (`app.isPackaged`) also never reads `GP_GOOGLE_TEST_ISSUER`.

### Passkeys

How a ceremony runs (`apps/server/src/webauthn.ts`, `auth.ts`): `POST /auth/passkey/begin` with
`mode` `signin` or `register` (with an invite, or for the caller's own session) makes a row in
`passkey_flows` with a fresh 32-byte challenge: single use, 5 minutes, bound to the browser by a
cookie, and to its kind, so a registration's challenge never signs anyone in. `POST
/auth/passkey/finish` finds the flow by the challenge in the client data, uses it up, and verifies with
Web Crypto, no library: the client data's type, origin (exactly one of the configured origins) and
`crossOrigin`, the RP ID hash, the user-present and user-verified flags (verification is required), the
signature over the authenticator data and the client data hash, and the user handle (the owner's
random user id). Keys: ES256, EdDSA (Ed25519) and RS256 of 2048 bits or more. Attestation "none" is
asked for and nothing is trusted from a statement; a packed self-attestation is checked. Passkeys are
discoverable, so sign-in names no user. The signature counter: 0 that stays 0 is fine (synced passkeys
keep none); otherwise it must grow, or the sign-in is refused as a possibly cloned passkey. A passkey
row keeps its COSE public key, counter, transports, a name the user chose, and when it was made and
last used. At most 20 unfinished ceremonies per address, as for Google; at most 5 logins per user
(ORG-R13).

**A passkey is bound to its RP ID.** One made for the cloud's domain does not work on a desktop host,
whose RP ID is `localhost`, and one made on a host works only on that host's machine. LAN devices still
join a host by pairing; a page from the host over `http://192.168.…` is not a secure context and could
not use a passkey anyway.

**The desktop app** runs every ceremony in the system browser, through the same `/app-login` device
flow (`?method=passkey`) or a flow its window began (`/auth/passkey/start?flow=…`), and the server
hands the token back on the callback scheme, as for Google. Not in Electron: its support for platform
authenticators (Touch ID, iCloud Keychain) is unreliable, and in the e2e a sign-in with a discoverable
passkey failed in an Electron window while it works in Chromium. The window's origin, `127.0.0.1`,
could not be an RP ID either: browsers refuse IP addresses. So the system browser opens the host at
`http://localhost:47800` for passkeys, while Google's sign-in stays on `127.0.0.1`, where its redirect
URI is registered; each sign-in stays on one host name from start to end, so its cookie holds. Adding
a passkey from the desktop opens the system browser too; the page then watches its list for the new
one. A passkey on the host needs no internet.

A database records its schema version in `_schema`. One made by an older version (milestone 1 has no
row: version 1) is migrated when it is opened, on the server and on clients; a client then pulls
everything again, because the schema is part of the pull cookie. The server's global database has
its own version (`GLOBAL_SCHEMA_VERSION`, now 4): the placeholder memberships of milestones 1 and 2
are dropped when it migrates, so data made by the old desktop host belongs to no account afterwards.
Version 3 drops milestone 3's passwords and its per-account lockout, and adds `user_logins` and
`login_flows`; users, memberships and sessions stay. Nobody has a linked login after it, so setup opens
again and finishes the existing SuperAdmin and church; other users need a new invite, or on a host a
new pairing. Version 4 adds passkeys: columns for the key, counter, transports and name in
`user_logins`, the link columns in `login_flows`, and `passkey_flows`. Every login and session stays.
Organisation schema version 3 (milestone 4) adds `presentations.theme_id`, `presentation_items.content`,
the synced tables `bibles` and `org_settings`, and the local tables `bible_texts` and `bible_blobs`.

### Bibles

A translation is two things: a row in `bibles` (name, abbreviation, language, verse count and the
hash of its text), which syncs like any other row, and its text, which does not. The text is one
immutable document, `{"v":1,"books":[{"code":"GEN","verses":[[1,1,"…"],…]},…]}`, named by the
SHA-256 of exactly that JSON. It is kept one row per book in `bible_texts`, plus a row in
`bible_blobs` that says the text is complete, on the server (in the organisation's database or
Durable Object) and on every device. Import reads the zip on the device (USX from a DBL zip, or
USFM; `packages/core/src/bible-import.ts`), stores the text there and runs the `importBible`
mutation, online or not. Before that mutation is pushed, the device uploads the text once
(`PUT /bibles/{hash}`, Admin; `BibleTextUploads` in `packages/sync/src/client/bibles.ts`, as the
sync client's `beforePush`), and the server refuses the import unless it has the text. So a
translation imported while the server cannot be reached is there at once on that device, and reaches
the server when it can be: an upload that cannot reach the server or fails on its side holds back
that import and the mutations after it (the ones before go); the server refusing an upload (4xx)
lets the import through to be refused with a reason. A queued import's text is never dropped. If the
server still lacks the text when the import arrives (`bible-text-missing`), the device queues the
import once more while it still has the text, which uploads it again; refused a second time, it
stays refused. Every other device sees the row arrive in a pull and downloads the text
once (`GET /bibles/{hash}`, any member, only from its own organisation), checks the hash, and keeps
it; a text that no translation names any more is dropped on the next sync. Searching and adding
verses then needs no network. An added reading is split into slides when it is added and kept on the
item (`content`), so re-importing or deleting the translation leaves it as it was.

Why not rows in the change log: 31 000 verses would be 31 000 changes for every device's first pull,
in every organisation, and an import or a re-import would replay through every client's rebase. A
whole translation is about 5 MB and never changes in place (a re-import is a new text), so it is
fetched like a file. Measured in `apps/server/test/bibles.test.ts` with a generated full-size
translation (66 books, 31 102 verses, 5.09 MB of JSON), on a laptop: upload 125–135 ms; a new
device's first sync is a 3–5 ms pull (one row) plus 80–270 ms to download, verify and store the text
(Node 80 ms, workerd 265 ms); reading every book back 20–25 ms; the device database grows by 5.25 MB.
The server's database grows by about the same. Books are stored separately so no row comes near
a Durable Object's 2 MB limit; a book is refused above 1.8 MB.

To use a real translation: as an admin, open Biblar and choose a zip (or drop it on the page). A
Digital Bible Library or bible.com export (`metadata.xml` with `USX_1/` or `USX_2/`), or an eBible.org
USFM zip (`…_usfm.zip`), works. Many translations are under copyright: import only one the church
may use. The repository has none; the tests use a few public-domain verses of the World English
Bible (`packages/core/test/bible-fixtures.ts`) and generated text.

To check a real translation, point `GP_REAL_BIBLE_ZIP` at its zip (anywhere outside the repository;
never commit one):

```sh
GP_REAL_BIBLE_ZIP=/path/to/bible.zip pnpm --filter @gp/core test real-bible
```

`packages/core/test/node/real-bible.test.ts` imports it as the app does and checks its shape only: the 66
books of the Protestant canon, 29 000 to 60 000 verses, no empty verse, no markup or control
characters left, no space before punctuation, within the server's limits, five known references
(`1 Mos 1:1-5`, `Ps 23`, `Joh 3:16`, `Rom 8:28-30`, `Upp 22:21`) found and split into slides, and every
chapter split into slides with no word lost. It asserts no verse text. Without the variable it is
skipped. Bibel 2000 (`b2000-sv-1.rvbible.zip`, a DBL zip) gave 66 books, 31 127 verses, 3.82 MB of
JSON, 1 189 chapters and 15 034 slides, imported in about 180 ms on a laptop.

### Themes

The four built-in themes of spec 05 (Klassisk, Midnatt, Dagsljus, Norrsken) are code
(`packages/core/src/themes.ts`), not rows. A presentation may name one (`theme_id`, in "Redigera
detaljer"); otherwise it follows the organisation's default (`org_settings`, set on the Teman page),
else Klassisk. An unknown id is Klassisk. Slides are drawn on a 1920×1080 stage with the theme's
background, type and credits, in the editor, the live view and the output alike. Inter, Montserrat
and Lato (OFL, `apps/web/src/assets/fonts/OFL.txt`) and Norrsken's picture ship with the app, so
nothing is fetched from the internet; Klassisk uses Tahoma where the system has it, else Geneva or
Verdana. The three files are Latin subsets (215–232 characters each): `apps/web/test/fonts.test.ts`
reads them and checks that each has every character of a Swedish Bible (ASCII and
`«»ÄÅÖäåéö—’…`) and of common Nordic and European song texts (`ÆØæøÜüÉé–“”‘’•`), and that
`OFL.txt` carries each file's own copyright notice. They lack Latin Extended-A (Polish, Czech,
Hungarian, Finnish `š ž` and the like) and `† ‡`: for those, the browser takes the glyph from the
system's sans-serif, so such a word shows in a mixed typeface. To try them: Teman shows each with a sample slide; pick a default there, or a theme per
presentation in "Redigera detaljer", and start the presentation.

## Not done yet

Images, audio and the media library (so themes have no pictures of the organisation's own), profile
pictures and logos, templates, English text, mobile, and deploying to Cloudflare. The Workers adapter
is tested in local workerd only.

From spec 05 and milestone 4: creating and editing themes (spec 05 and ADR 0001 have no editor yet;
the Teman page lists the built-ins and sets the default), the stage view and the public output, and
the theme's Media style (there are no media slides). BIBLE-R16's device-local Bibles (a translation
that never leaves the device) are not built: an import made offline is queued and goes to the server
(see "Bibles"). The Biblar page has no per-row "Gör tillgänglig offline": every
device keeps every translation, which shows as "Tillgänglig offline" or "Hämtas...".

From spec 01 and milestone 3: OIDC providers other than Google, which are not planned (ADR 0007
(12)); passkey autofill (conditional mediation: the sign-in page has a button, no username field);
ending the sessions a removed passkey made (removing a login ends no session; a new invite ends them
all); trusting attestation (which authenticator made a passkey is never checked); any mail at all (an admin's new invite link is the reset); packaging
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

Milestone 4 (Bibles and themes):

- **Mutators may upsert, never replace.** SQLite lets the statement that fires a trigger override
  the trigger's own conflict clause, so an upsert (`onConflictDoUpdate`) used to turn the `OR IGNORE`
  of the client's undo triggers, and the `OR REPLACE` of the server's change triggers, into a UNIQUE
  failure. Neither trigger has a conflict clause now (`packages/core/src/sync-sql.ts`): the undo
  trigger inserts only where no pre-image exists, and the change trigger deletes the entity's row and
  inserts it again. A server database gets the new triggers when it opens. `INSERT OR REPLACE` and
  `REPLACE INTO` stay out of mutators, because a replace deletes the old row without firing the delete
  trigger, so a rebase cannot bring it back: `pnpm lint` runs `scripts/check-mutator-sql.mjs`, which
  refuses one in `packages/core/src/mutators.ts`. `apps/server/test/triggers.test.ts` shows both, and
  `setDefaultTheme`, an upsert, is rebased and refused in `apps/server/test/bibles.test.ts`.
- **Bibles are imported and deleted by admins only** (D24); everyone can search and add verses. At most
  10 per organisation; a translation is known by its abbreviation (case-insensitive), so importing one
  with the same abbreviation replaces it (BIBLE-R5). Uploaded texts that no import then names are not
  removed from the server.
- **A translation imported offline is queued and goes to the server** (Lars, 2026-10-26), rather than
  staying on the device as BIBLE-R16 describes the current app. Which texts a device has uploaded,
  and which refused imports it has queued again, live only while the app runs: after a restart a
  queued text is uploaded again (the server takes it twice), and an import refused before the restart
  is not queued again.
- **An item's title is the reference with full Swedish book names** ("Johannes 3:16-17", spec 05
  BIBLE-R13) rather than spec 03's abbreviated one, and its credits are "{title} · {abbreviation}"
  (D12). Verse text is stored as data, never HTML (D25).
- **Verse text is cleaned at import**: headings, notes, cross references and introductions are left
  out, and a word followed by punctuation keeps no space before it (the current app writes
  "word ."). The `.usx` files of a zip are used when there is no `USX_1`/`USX_2` folder.
- **A search that finds more than 500 verses asks before adding the first 500** (D13).
- **Themes are not editable** (spec 05, ADR 0001). Lars confirmed on 2026-10-26 that the built-ins
  are enough for now.
- **A new default theme reaches a running output at once**, like a presentation's own theme
  (THEME-R6); spec 05's THEME-R11 keeps a running presentation on its theme until restarted. The black
  screen stays black whatever the theme.
- **The slide layout follows spec 05** (80 px padding, 144 px at the bottom, credits 32 px from the
  bottom), for songs too, so song slides look a little different from milestones 1–3.

Milestone 3 (sign-in, membership, pairing):

- **Google and passkeys.** Spec 01 also has generic OIDC and a mock login; the owner decided on Google
  and passkeys, with no passwords and no generic OIDC (ADR 0007 (12)). Spec 01 has no passkeys; their
  rules here are this README's. The tests use the fake Google and a software authenticator, and there
  is no mock login in the app.
- **Adding a login needs a fresh sign-in**: a session made in the last 10 minutes, by the user signing
  in themselves, not by a pairing. A stolen session that has been around for a while cannot plant a
  passkey of its own and keep access after it is revoked. Removing, renaming and listing need only a
  session (removing not from a paired device).
- **At most 5 logins per user** (ORG-R13), and at most one Google account; passkeys fill the rest.
- **The passkey's default name** is the device's name (the app's, or the browser's guess); the user
  can rename it.
- **Spec 01 E4 is refused**: an invite accepted with a Google account already linked to another user
  fails (`login-taken`) and leaves the invite unused, rather than signing in as the invited user while
  the login stays with the other.
- **An invite replaces all the user's logins**, passkeys and Google alike, and ends their sessions: it
  is how an admin resets a lost account, so whoever held an old passkey is out. That is why an Admin may
  not make one for a SuperAdmin (D20, D21). Email is
  required for users an admin makes, lower-cased and unique (01 Q2 limits uniqueness to real
  addresses); the setup SuperAdmin has none until Google fills it in. An email Google gives is filled
  in only when the user has none and no other user has it.
- **Setup is done when a user has a linked login**, not when a user exists, so a setup left before
  its passkey or Google sign-in, or a church migrated from milestone 3, can be finished with the setup
  token.
- **Throttling** (the spec has none): twenty failures from one address (setup token, pairing code)
  lock that address for 15 minutes. At most 20 unfinished Google sign-ins, and 20 unfinished passkey
  ceremonies, per address at a time. On
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
