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
with Bible readings and a chosen look runs offline. Milestone 5 adds the media library and pictures
(spec 05 Media, ADR 0007 decision 9, D31): import, trash, and a picture as a slide.

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
pnpm lint && pnpm typecheck && pnpm test   # unit and sync tests, on Node, node:sqlite and local workerd, and the host's own
                                           # (lint also refuses a REPLACE in a mutator: see Assumptions)
pnpm e2e                                   # milestones 1–6 in Electron, windows hidden

export GP_GOOGLE_CLIENT_ID=… GP_GOOGLE_CLIENT_SECRET=…   # the host's Google client (see "Sign-in")
pnpm --filter @gp/desktop start            # the desktop app: the host, on 127.0.0.1:47800
GP_LAN=1 pnpm --filter @gp/desktop start   # the host, reachable on the LAN
GP_SERVER=http://127.0.0.1:47800 GP_DATA_DIR=/tmp/gp-second pnpm --filter @gp/desktop start
                                           # a second client of the first; pairing signs it in
pnpm --filter @gp/desktop serve            # the server alone on :8787, then `pnpm --filter @gp/web dev`
GP_PASSKEY_RP_ID=localhost GP_PASSKEY_ORIGINS=http://localhost:8787 pnpm --filter @gp/desktop serve
                                           # the same with passkeys; open http://localhost:8787 (not 127.0.0.1)
```

Needs Node 22 or later and pnpm 12. The e2e runs the real app, with its windows hidden: they are made but never
shown, there is no Dock icon, and the output never takes a second display, so a run takes no focus from whoever
is at the computer (`GP_E2E_VISIBLE=1 pnpm e2e` shows them). It plays the system browser and
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

Under Inloggningsmetoder (in the menu behind the user's picture in the top bar) a signed-in user sees their own logins, adds
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
`/signed-in`, and the page collects its session with a one-time cookie (`POST /api/auth/google/finish`),
so no token is in a URL.

The desktop app never shows Google in its own windows. It opens the server's `/api/app-login?device=…&
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
its own database with no network; when the server refuses it, sync stops, local edits wait, and a
strip under the top bar asks it to sign in again (SYNC-A15).

The desktop host refuses every API request from a device it has not paired, on localhost too: only
the static app and `/api/pair/status`, `/api/pair/claim` answer (and the sign-in above, from the host machine).
Its own window's requests carry a host token that the Electron main process adds and no page sees. On
the host, Enheter → Anslut enhet asks who the device signs in as (the admin, or a member they may make
an invite for), and shows a six-digit code (10 minutes, one use, dead after five wrong guesses); the
other device types it and gets a device token (`gppd_…`) and a session as that member. Pairing is how
a device signs in to a host, also after its session ends. Enheter also disconnects a device, which
stops it and ends the session its pairing made. `pnpm --filter @gp/desktop serve` has no pairing
unless `GP_LAN=1`.

**Configuration of passkeys.** An explicit RP ID and the exact origins ceremonies may come from;
without both, passkeys are off and `/api/auth/state` says so. Node: `startNodeServer({ passkeys: { rpId,
origins } })`, and `GP_PASSKEY_RP_ID`, `GP_PASSKEY_ORIGINS` (comma-separated) for `serve`. The Worker:
`PASSKEY_RP_ID`, `PASSKEY_ORIGINS` (vars, not secrets; e.g. `app.example.org` and
`https://app.example.org`). The desktop host always has RP ID `localhost` and origin
`http://localhost:{port}`. A wrong configuration stops the server at start: an IP address as RP ID, an
origin that is not on the RP ID, or plain http anywhere but localhost.

**Configuration of Google.** Node (`startNodeServer({ google })`, and `GP_GOOGLE_CLIENT_ID`,
`GP_GOOGLE_CLIENT_SECRET`, `GP_GOOGLE_REDIRECT_BASE_URL` for `serve`): the client id and secret, and
the public origin the redirect URI is built from (`{origin}/api/auth/google/callback`; without it, the
origin of the request). The desktop host reads `GP_GOOGLE_CLIENT_ID` and `GP_GOOGLE_CLIENT_SECRET`;
its redirect is `http://127.0.0.1:47800/api/auth/google/callback`. The Worker reads `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` (a secret) and `GOOGLE_REDIRECT_BASE_URL`. Without a client id and secret,
Google is off: `/api/auth/state` says so, and its sign-in is refused (503 `google-disabled`). With neither
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

How a ceremony runs (`apps/server/src/webauthn.ts`, `auth.ts`): `POST /api/auth/passkey/begin` with
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

**The desktop app** runs every ceremony in the system browser, through the same `/api/app-login` device
flow (`?method=passkey`) or a flow its window began (`/api/auth/passkey/start?flow=…`), and the server
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
Version 4 (milestone 5) adds the synced table `images` and the local table `media_blobs`; nothing existing changes.

### Bibles

A translation is two things: a row in `bibles` (name, abbreviation, language, verse count and the
hash of its text), which syncs like any other row, and its text, which does not. The text is one
immutable document, `{"v":1,"books":[{"code":"GEN","verses":[[1,1,"…"],…]},…]}`, named by the
SHA-256 of exactly that JSON. It is kept one row per book in `bible_texts`, plus a row in
`bible_blobs` that says the text is complete, on the server (in the organisation's database or
Durable Object) and on every device. Import reads the zip on the device (USX from a DBL zip, or
USFM; `packages/core/src/bible-import.ts`), stores the text there and runs the `importBible`
mutation, online or not. Before that mutation is pushed, the device uploads the text once
(`PUT /api/bibles/{hash}`, Admin; `BibleTextUploads` in `packages/sync/src/client/bibles.ts`, as the
sync client's `beforePush`), and the server refuses the import unless it has the text. So a
translation imported while the server cannot be reached is there at once on that device, and reaches
the server when it can be: an upload that cannot reach the server or fails on its side holds back
that import and the mutations after it (the ones before go); the server refusing an upload (4xx)
lets the import through to be refused with a reason. A queued import's text is never dropped. If the
server still lacks the text when the import arrives (`bible-text-missing`), the device queues the
import once more while it still has the text, which uploads it again; refused a second time, it
stays refused. Every other device sees the row arrive in a pull and downloads the text
once (`GET /api/bibles/{hash}`, any member, only from its own organisation), checks the hash, and keeps
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

### Media

**What is synced and what is not.** A picture is a row in `images` (file name, type, the hashes of its two
blobs, size, `created_at`, `deleted_at`), which syncs like any other row, and two blobs that do not: `full`
(fits 1920×1080) and `thumb` (fits 400×225), each named by the SHA-256 of its bytes. Blobs are immutable, so
the same picture twice is one object, and each is fetched like a file, not replayed through the change log
(the reasoning is the Bibles' above). `media_blobs` (not synced) says which blobs a database knows: on a device
the row holds the bytes (so pictures show offline and survive a reset), on the server it records that the
bytes are in the media storage. `addImage` checks both hashes there and is refused with `media-missing`
otherwise, so a mutator still reads only through its transaction.

**Where the bytes live (D31).** Behind `MediaStorage` (`apps/server/src/media.ts`): put, get, delete, by key
`org/{org}/media/{hash}` (`mediaKey` in core: every key starts with the caller's own organisation, and an
organisation id cannot contain `/` or `.`). Adapters: a folder (`media-disk.ts`; `{dataDir}/media` by default on
Node, so on the desktop host and a self-hosted server), R2 through the `MEDIA` binding on Cloudflare (a bucket
`gp-media` in `wrangler.toml`; without the binding the endpoints answer 503, MEDIA-R18), and memory (tests).
Backing up a self-hosted install is copying `/data`. S3 is not built (see "Not done yet").

**The endpoints.** `PUT /api/media/{hash}` (ManageImages) takes the bytes, up to 10 MiB, and refuses a body whose
SHA-256 is not the hash (`hash-mismatch`), an empty one, and one that does not start like a JPEG or a WebP
(`invalid-image`: the server trusts the signature, never the type the client claims, MEDIA-A6). The same hash
again is 204 and changes nothing. `GET /api/media/{hash}` (ViewImages) answers only for a blob this organisation's
database knows, with the stored type, `Cache-Control: private, max-age=31536000, immutable` (D28), `ETag`
and `nosniff`; another organisation's hash is 404 (MEDIA-A11).

**The pipeline is in the client** (`apps/web/src/media/process.ts`): the page checks type, size (10 MiB) and
name (200 characters), decodes with `createImageBitmap`, fits within both boxes without upscaling, and
re-encodes: JPEG stays JPEG, PNG, WebP and GIF become WebP (a GIF keeps its first frame). Re-encoding also
drops metadata such as GPS. The worker keeps both blobs in `media_blobs` and queues `addImage`; before that
mutation is pushed, `MediaUploads` (`packages/sync/src/client/media.ts`, chained with the Bibles' uploads by
`chainBeforePush`) uploads them. So importing works offline: the picture shows at once on that device and
reaches the server and the other devices later. An upload that cannot reach the server or fails with 5xx holds
back that add and what follows; one refused with 4xx lets the add go, to be refused with a reason. Every other
device sees the row in a pull and downloads, hash and signature checked, the blobs it should keep (see "Which
files a device keeps").

**Clean-up.** Mutators never touch the blobs. After a push that can leave blobs unused (`addImage`,
`purgeImage`, `purgeExpiredTrash`), not after every edit, the server removes the blobs no `images` row names,
and a device does the same in `syncMedia`, but only for blobs older than an hour (`ORPHAN_GRACE_MS`), so a
blob uploaded just before its `addImage` arrives is never taken away. Uploading a blob the server has already
starts its hour over, and a device uploads a waiting add's blobs again once half an hour has passed, so an add
that waits longer than the hour (a laptop asleep) still finds them. A device also keeps what a queued
`addImage` names. A blob shared by two images stays until both are gone. The server's clean-up runs in the
organisation's queue, as every write does; it is rare enough that this is not worth the race of running it
outside.

**In the app.** Bilder (everyone may see and import: User, Admin and SuperAdmin, as spec 05): a grid of
thumbnails, newest first, import by button or by dropping files on the page, "Importerar i av n...", failures
listed with their reason, search by file name, "⋯" moves to the trash without confirmation. The trash holds
images with songs and presentations (30 days; "Töm" and the lazy purge include them). A picture goes into a
presentation from the add dialog's third tab (Ctrl/⌘+3) and is one slide, the picture contained within the
stage over the theme's media background. Like a song it is a reference by id: a trashed picture still shows
(MEDIA-R8), a purged one leaves an item marked "Bilden finns inte längre". The output reads the bytes through
the operator window's database, like everything else, so it works without OPFS.

### Audio

An audio file is a synced row in `audios` (file name, type, hash, size, `created_at`, `deleted_at`; organisation
schema version 6) and one blob, stored byte for byte as it was picked (MEDIA-R5), through the same storage, upload
and clean-up as pictures. The server takes a blob it recognises by its first bytes as MP3, WAV, Ogg, MP4/M4A or
WebM, up to 20 MiB, and serves it with that type; a picture stays limited to 10 MiB. A device fetches an audio
file as it does a full picture: for a presentation that is open or coming (see "Which files a device keeps"). Ljud
(`/admin/audios`) lists the files, with import, drop, search and the trash; there is no playback there (spec 05).
An audio item has no slides; in the editor it shows a player for the file. The server's CSP now allows `blob:`
for media, which the player needs. One file per item: spec 03's item with several audio files is not built.

**Live** (spec 04 §1b, `apps/web/src/live/audio.ts`). The presenting window has one audio engine: the item it
plays is the session's audio, and it keeps playing while the operator moves on, on any page, until another
audio item plays or the presentation ends. Playing never changes what is shown (LIVE-R6); in stage view, picking
an audio item blacks the screen and plays it, and the preview says "Ljud spelas". Each audio item on the live page
has play and pause, a seek bar (muted while it moves, until 150 ms after), the time, and Tona ut (5 s, ease-out
cubic, then pause, rewind and the volume back). Audio plays only on the presenting computer. The owner reports
its audio with its live state; a controller sees a mirror, its position carried on from when the report arrived,
and its buttons are commands relayed to the owner like the slide commands. **Starting sound from a controller:**
the desktop app allows sound without a click (`autoplayPolicy`). A browser does not until the user has done
something on the page, and Safari only on an element that has played after such a gesture, so the engine plays
a moment of silence at the operator's first click or key. The e2e shows a controller starting the sound first in
the desktop app; the browser case, Safari above all, is not tested.

### Overlays

Text, a picture, or both, shown above the live slide (spec 03 §4, spec 04 LIVE-R15). An overlay is a synced row in
`overlays` (title, text up to 2 000 characters, the id of a library picture, `sort` in the order of creation), and an
item names the one it carries in `presentation_items.overlay_id` (organisation schema version 8). Everyone may make,
change and delete them (ManageOverlays is every role's, as in spec 01), at most 200. Overlays (`/admin/overlays`)
lists them with a preview; one overlay's page has Titel, Textinnehåll and a picture chosen from Bilder, each saved
when the field loses focus, a preview, and Radera, which asks first and is permanent (no trash). Deleting one
leaves no item carrying it.

**During live.** The live pointer carries `overlayId`, so the overlay travels with the slide in the same message
and every output draws it above the slide (text top left, 40 px, 60 % white; the picture over the whole stage,
contained). The live page has Overlays (collapsed, a dot while one is on) with a toggle each, at most one on; the
stage view has the same behind its Overlays button. The rules are one pure function, `applyLiveChange` in
`packages/core/src/live.ts`, which the presenting window runs for its own clicks and for a controller's commands:

- An item that carries an overlay switches it on when it goes live and off when it leaves, if it is still the one
  shown. The overlay shows on every slide of the item (per item, not per slide; decided 2026-10-27).
- A manual toggle lasts until the item changes: switched off, it stays off on the item's other slides; going back
  to the item switches it on again. An overlay chosen by hand that is not the left item's own stays when the item
  is left (Lars's choice, 2026-10-27).
- "Svart skärm" and stopping switch the overlay off (a change from LIVE-R16, TODO.md 2026-10-27). Back from
  black on the same item, it stays off, as after a manual off.
- Switching an overlay on while black ends the black screen, as selecting a slide does (LIVE-R11).

A controller sends `overlayId` only when it toggles; its slide commands leave the overlay to the presenting
window. A public output gets the overlay's text with the slide, centred near the top (spec 04 §6), but not its
picture. The editor has an Overlay choice for the selected item, draws the overlay on the item's tiles, and the
running order and the live page name the overlay an item carries.

**Files.** Every overlay's picture is fetched with the presentation's files: ahead on a device that keeps its
data, else once a presentation is open, since any overlay can be switched on during live. "Alla bilder och ljud
finns på den här enheten" counts them.

### Paired screens

A TV or a PC in the church opens `/display` at the server, the cloud's or the desktop host's, and shows a
session (spec 04 §5). It signs in to nothing and is no paired device; on a desktop host `/api/display/` and
`/api/screen` answer it like `/api/watch/`. Spec 04 has paired screens on the web host only (LIVE-R52); Lars
chose on 2026-10-27 to have them on the desktop host too, so a TV on the church's LAN works without the
internet. A screen renders as a public output does, from the slide as data (`PublicSlideView`, D25), and like
every output never shows an error or reconnection screen (LIVE-R33). Two kinds:

- **A saved screen** is a row in `displays` of kind `screen` (organisation schema 9, no new column; an older
  app must update first, since it would list it as a public output). An admin adds it under Skärmar → Skärmar
  ("Lägg till"), and the TV opens its link, `/display?id={code}&name={name}`, as a QR code or text. Its code
  is in the global index with the public outputs' (`watch_codes`), but each answers at its own path only. It is
  online while its page has a stream open (`/api/display/{code}/stream`); the live hub sends every socket which
  outputs are online, so Skärmar shows Online or Offline and Utgångar can switch it on only then (LIVE-A21). A
  page that closes switches it off (LIVE-R24, LIVE-A20), once it has not come back for 15 s
  (`SCREEN_GRACE_MS`): a TV whose Wi-Fi blinks reconnects within that and stays on, and Lars chose on
  2026-10-27 that a blink should not count as a closed page. Unbound, it shows its name.
- **A temporary screen** is paired for one session. `/display` asks `POST /api/screen` for a code: four digits
  in [1000, 9998], unique among live codes, good for 10 minutes and single use (LIVE-R28), and asks again every
  3 s until paired, getting a new code once the old one has run out. Its id is 32 random bytes, kept in the
  tab (`sessionStorage`), and is its only credential (ADR 0007 decision 5). Since an unpaired screen belongs to
  no organisation, it lives in the global tables (`screens`, `screen_tokens`, global schema 6), and a stream is
  found by its id at `/api/screen/{id}/stream`. "Anslut tillfällig skärm" under Utgångar pairs it, by the four
  digits typed into four boxes (`POST /api/live/screens/claim`; a wrong code counts against the address with
  the setup token and device pairing codes), or by a QR code of `/display?token={token}`: 32 random bytes,
  single use, 10 minutes, renewed every 8 minutes while the dialog is open and dropped when it closes. The TV
  that opens it is paired at once and its address becomes `/display`; the dialog learns which screen used the
  token by asking every 2 s. Either way the screen is switched on, as "Tillfällig skärm (n)". ✕, or the end of
  the session, lets it go: the TV gets `unpaired` and shows a new code. A screen nobody pairs is forgotten after
  a day. Making screens counts against the address too (30 in 15 minutes), so one machine cannot fill the table.

The other QR codes: a public output's (Visa QR-kod, with "Ladda ner som bild": `qr-{code}.png`, 24 pixels per
module, error correction M), remote control's on the live page, and device pairing's under Enheter (on the
LAN), whose code rides in the fragment, `/#pair={code}`, so no server sees it; the pairing page fills its form
from it and takes it out of the address. They are drawn in the page with `uqr` (no service sees a link), and
built against the host's LAN address on a desktop host.

Tested in `apps/server/test/screens.test.ts` (three adapters: code, QR token, single use, letting go, a saved
screen online and off, another organisation) and `apps/desktop/e2e/screens.spec.ts` (LIVE-A17 to A21, a TV
played by Playwright's Chromium); the QR codes in `watch.spec.ts`, `remote.spec.ts` and, through `pair()`,
`https.spec.ts`.

### Which files a device keeps

Every device has every row, but not every file (`syncMedia` and `MediaPolicy` in
`packages/sync/src/client/media.ts`). Always: every picture's thumbnail, which is small and what the
library and the pickers show. Ahead of time, on a device that keeps its data (OPFS in a browser, the desktop
app, later the tablet app): the full pictures and the audio of every presentation dated from today to seven
days ahead, so Sunday's material is on the computer before anyone leaves for church. On demand, on any device:
what a presentation open on one of its pages needs (the editor, the live page, remote control), fetched at
once. Kept offline, on a device that keeps its data: every file of a presentation marked "Tillgänglig
offline på den här enheten" in the editor, whatever its date, including what is added to it later (a local,
unsynced table, `pinned_presentations`, organisation schema version 7; the list marks them "Offline"). A device
that keeps nothing between reloads shows the choice switched off and says why. Never: audio for a presentation the device only controls, since it plays on the presenting computer.
A device that keeps its data only in memory (a tablet over plain http) fetches nothing ahead, as it would lose
it at the next reload. Files no open or coming presentation needs are kept within 2 GiB (MEDIA-R14), the
oldest dropped first; what is coming, open, kept offline or waiting to be uploaded is never dropped. The editor and the live
page say whether everything is on the device ("Alla bilder och ljud finns på den här enheten") or how much is
being fetched, and, offline, how many files are missing and cannot be. A presentation without a date is
fetched only when it is opened; "coming" is decided by this device's own calendar day.

### Remote control

Every window that presents owns its session and drives its own outputs from its own state; only the
selection travels (ADR 0004, ADR 0007 decision 4). This holds for a browser as for the desktop app: there is
no server-side slide and no second kind of session. Each operator window keeps one WebSocket to
`/api/live/socket` (`apps/web/src/live/remote.ts`), reconnecting after 0, 2, 5, 10 s and then every 30 s
(LIVE-R51). Over it the owner reports its whole state on connect, on every reconnect and on every change
(LIVE-R47): presentation, device name, "Tillåt fjärrstyrning" and the pointer. Every member's window gets the
organisation's sessions as they change. A controller sends an absolute command (item, part, black); the server
forwards it to the owner's socket only, never queued (LIVE-R48), and refuses it while remote control is off or
the owner is gone. The owner applies it if it still makes sense (presenting, item exists, not already showing;
LIVE-R49), whichever page is open (`apps/web/src/live/owner.ts`), and its next report is what everyone sees.
A controller's own click shows at once; if the owner has not confirmed it within 2 s, it warns once.

**On the server** (`apps/server/src/live-hub.ts`) the same code runs in process on Node and in the
organisation's Durable Object. Sessions are rows in a server-only table, `live_sessions`, and which socket owns
which session is kept on the socket (a hibernatable socket's attachment), so a Durable Object may hibernate
between messages. Every hub call runs in the organisation's queue, so a live write never lands inside a
mutation's transaction. Only the user who first reported a session id may report it again. A lost owner
freezes the session (LIVE-R50): it stays, cannot be driven, and anyone in the organisation may then end it
("Avsluta presentationen"); after 2 hours without its owner it is ended when the sessions are next read.
Starting and controlling need `ManagePresentations` (ADR 0007 decision 5), which every role has, so any
member may control, as LIVE-R38 says. The poke sockets are now tagged `poke` in the Durable Object, so a
poke never goes to a live socket.

**In the app.** On the live page, "Tillåt fjärrstyrning" (it stays on for the window, LIVE-R39) has a QR code
button beside it, grey while off, for the "Fjärrstyr presentationen" dialog (`RemoteControlInfoDialog.razor`):
the link, `/live/{id}?remote=1&session={id}`, as a QR code, and folded under it the link to copy and how to take
control from the app. The first time it is switched on on a live page, the dialog opens by itself. On a desktop
host the link has its LAN address. Under Presentationer every other
window of the organisation sees "Visas just nu · {name}" with "Ta kontroll" for each session that allows it
(LIVE-A27). The controller's live page has the amber banner, the same grid, the black screen and the stage view,
no "Extern skärm", and "Bara datorn som presenterar kan stoppa presentationen." instead of Avsluta. With
several candidates it asks which; otherwise it says "Ingen aktiv presentation just nu", "Fjärrstyrning är inte
aktiverad av presentatören" or that the presenting computer lost contact. Tested in `apps/server/test/live.test.ts`
(three adapters) and `apps/desktop/e2e/remote.spec.ts` (two desktops).

### Public outputs

An admin makes a public output under Skärmar (`/admin/displays`): a synced row in `displays` with a name and
a 7-character code from `abcdefghjkmnpqrstuvwxyz23456789` (LIVE-R30; at most 50 per organisation). Anyone
opens `/watch/{code}`, signed in or not, on a phone or a tablet. Since a viewer has nothing but the code, the
server keeps a global index of codes (`watch_codes`, global schema version 5), which it brings up to date after
a push that made, renewed or deleted an output (`apps/server/src/watch.ts`). A code another organisation
already holds is not taken over; with 31^7 codes that is unlikely, and "Ny kod" is the way out.

The presenting window chooses its outputs under Utgångar on the live page (kept for the window, as the
current app keeps its output configuration) and sends, with its live report, the slide as data: kind, text,
verses, picture hash, credits and theme id, never HTML (D25). It builds it from its own copy, so viewers see
what its projector shows; black and nothing selected are the waiting screen (LIVE-R14). One session per
output (LIVE-R23): taking an output from another presentation asks first ("Ta över"). The live hub keeps the
binding (`live_bindings`) and the viewers. `GET /api/watch/{code}/stream?v={viewer}` is server-sent events:
the output's name and the organisation's first, then the newest state and every change, a ping every 15 s
(LIVE-R35). At most 500 viewers per output; a reconnect under the same viewer id (kept in the tab) replaces its
old stream and is never refused (LIVE-R36). Viewer counts reach the operators at most every 2 s.
`GET /api/watch/{code}/image/{hash}` serves a picture only while it is on that output (LIVE-R32), with
`private, max-age=3600` rather than spec 04's `public` (LIVE-R34), so no shared cache serves it after it left
the screen. The owner's report alone does not make a picture public: the server also checks that it is a
picture of an item in the presentation the session shows, so a changed client cannot publish any picture of the
library through an output. Guessing codes is slowed: an unknown code counts as a failure for the address, and
after 20 in 15 minutes the address gets 429 for 15 minutes on every `/api/watch/` request (`lookupThrottled`). A
real code never counts, however many viewers share an address. A frozen session keeps its last slide on the outputs; an ended one shows the waiting
screen. A new code or a deleted output disconnects its viewers at once, and their page says the code no
longer exists. On a desktop host, `/api/watch/` answers unpaired devices too (it is the one anonymous API).

The page (`apps/web/src/pages/Watch.tsx`) opens no database. It uses the theme's colours, fonts and
background, and sizes the text from the viewport, never larger than the theme's size (LIVE-R31):
`clamp(18px, min(size/1920·160 vw, size/1080·100 vh), size px)`, credits at least 11 px. It is `noindex`, and its
title is the organisation's name. Tested in `apps/server/test/watch.test.ts` (three adapters) and
`apps/desktop/e2e/watch.spec.ts` (a phone played by Playwright's Chromium).

### A tablet over plain http

A phone or tablet that opens the desktop host at its LAN address over http is not a secure context (ADR 0007
decision 7: https on the LAN was rejected). It has no OPFS, so it keeps its data in memory and says so; no
`crypto.randomUUID`, so ids come from `randomId` (core), which falls back to `getRandomValues`; and no
`crypto.subtle`, so SHA-256 (checking every downloaded picture, audio file and Bible text, and naming an import)
is plain JavaScript (`packages/core/src/sha256.ts`). That runs on the database worker's thread, so it gives
the thread back every 256 KiB: hashed in one go, a 19 MB audio file being fetched held the page's queries, and
"Ta kontroll" took about 830 ms with the CPU slowed four times, against about 125 ms now
(`apps/desktop/e2e/performance.spec.ts` keeps it under 500 ms). `apps/desktop/e2e/remote.spec.ts` opens the
host from Chromium at the machine's LAN address and checks it is not a secure context.

### https on the LAN

The desktop host can serve the LAN over https with a certificate the operator provides, so a tablet that trusts
it is a secure context: its database is a file in OPFS that survives a reload, and it has Web Crypto. ADR 0007
decision 7 rejected https on the LAN as the way for every church, since every device must trust the
certificate; this is an option for whoever is willing to set that up, beside plain http (see "A tablet over
plain http") and the tablet app to come.

```sh
GP_LAN=1 GP_TLS=self-signed pnpm --filter @gp/desktop start                         # the host makes its own certificate
GP_LAN=1 GP_TLS_CERT=cert.pem GP_TLS_KEY=key.pem pnpm --filter @gp/desktop start   # or brings one; https on :47843 (GP_TLS_PORT)
```

`GP_TLS=self-signed` is the way of the author's other apps (`@vitejs/plugin-basic-ssl`): the host makes a
certificate with openssl for its LAN addresses, its `.local` name and localhost, keeps it in its data folder
(`tls/`), and makes it again only when it has an address the certificate does not name (not when its networks are
listed in another order, nor when one goes away; a new one names the old addresses too). Each device accepts it
once in its browser's warning. Whether Safari then counts the page as a secure context and allows its worker
and `wss` is not tested here (the e2e accepts it in Chromium).

With a certificate, the LAN gets https only: plain http stays on 127.0.0.1 for the host's own window, so
Electron, passkeys at `localhost` and Google's redirect URI are as before. Links the host shows for other devices
(remote control, invites) use https on that port, at the LAN address, or at `GP_TLS_HOSTNAME` if set (when the
certificate names the Mac's `name.local` rather than its address). The same app, API and sockets answer on both
(`startNodeServer({ tls })`); `apps/server/test/tls.test.ts` checks pages, the API and both sockets over https,
and that a client that does not trust the certificate cannot connect; `apps/desktop/e2e/https.spec.ts` has a
browser that trusts it pair, keep its database in OPFS through a reload, and keep working when the host goes.

Making a certificate an iPad trusts, with mkcert (`brew install mkcert`): `mkcert -install`, then
`mkcert 192.168.1.59 $(scutil --get LocalHostName).local` (the Mac's LAN address and name) for the two PEM
files. On the iPad: send it `$(mkcert -CAROOT)/rootCA.pem` (AirDrop), install the profile under Settings, and
switch on full trust under Settings → General → About → Certificate Trust Settings. Then open
`https://192.168.1.59:47843`. With the host gone the open page keeps working from its database, and a service
worker keeps the page itself, so a reload starts the app too (see "Starting the app without the host"). Not
tested on a real iPad: whether Safari there gives the database worker OPFS's synchronous access handles, which wa-sqlite uses.

### Starting the app without the host

A device over https on the LAN keeps the built web app in a service worker, so it can reload, or open any
page of the app by its address, while the host is gone; its data is already in OPFS. The worker is
`apps/web/sw/sw.ts`, about 60 lines and no library, built by a small Vite plugin in `apps/web/vite.config.ts` as
`/sw.js`. The plugin writes into it the build's files (index.html and everything under `/assets/`: the scripts,
the database worker, wa-sqlite's wasm, the CSS, fonts and the background) and a hash of their contents.

- **One cache per build**, `gp-app-{hash}`, filled whole when the worker installs; if one file fails, the
  install fails and the old worker and its cache stay. So the kept index.html always has its own assets.
- **Pages come from the network first**, so a host with a newer build is used at once, and the worker's
  index.html only when the network fails or does not answer in 3 s (a host that is off may stay silent rather
  than refuse). Every page address is a page: `/`, `/presentations/{id}`, `/admin/songs`, `/output`,
  `/watch/{code}`.
- **The build's files come from the cache first**: their names carry their contents' hash, so a kept copy is
  never stale. A file the cache does not have goes to the network.
- **Nothing under `/api/` ever goes through a cache** (sync, sign-in, live sockets, media, public outputs); nor
  does anything but GET or another origin.
- **Updating.** Every start registers the worker again, which makes the browser ask the host for `/sw.js`. A new
  build has a new hash in it, so a new worker installs, fills its own cache, takes over at once
  (`skipWaiting`, `clients.claim`) and deletes the old cache. An old page that is still open needs no more
  files from it: the app loads everything at start. A device that started from its kept copy while the host was
  gone, and finds the host back with a newer build (the sync's "update first", 426), gets the new app with a
  reload, since a page comes from the network first.
- **Where it registers** (`apps/web/src/keep-app.ts`): only a built app (not `pnpm dev`), only in a secure context,
  and never in the desktop app's windows, whose page comes from their own server. Not for `/watch/{code}`, as
  a viewer's phone needs no copy of the app; a device that already has the worker gets `/watch/` through it,
  network first. Over plain http on the LAN a browser allows no service worker, so such a tablet still needs the
  host to load the page.
- **On the server**, `index.html`, `/sw.js` and every page address are sent with `cache-control: no-cache`, so a
  new build is seen at once; the CSP's `worker-src 'self'` covers the worker.

Tested in `apps/web/test/sw-route.test.ts` (which requests go where), `apps/server/test/tls.test.ts` (headers)
and `apps/desktop/e2e/https.spec.ts`: a browser over https on the LAN pairs, the host goes, the page reloads and
shows its songs, another page opens by its address, and `/api/` fails rather than coming from a cache; the host
comes back with another build, which one reload brings, and which the worker keeps instead of the old one. The
host's own window has no worker. All in Chromium; not tested in Safari or on a real iPad.

### Behind a reverse proxy

A self-hosted Node server behind nginx or Caddy sees every client at the proxy's address, so the throttles
(setup token, pairing code, public output codes; see Assumptions) would lock out a whole church at once.
`GP_TRUSTED_PROXIES` (for the desktop host and `serve`; `trustedProxies` for `startNodeServer`) names the
proxies, as addresses or CIDR blocks, comma-separated:

```sh
GP_TRUSTED_PROXIES=127.0.0.1,::1 pnpm --filter @gp/desktop serve   # Caddy or nginx on the same machine
GP_TRUSTED_PROXIES=10.0.0.0/8 …                                      # a proxy somewhere on that network
```

Only a request whose socket is one of them has its `X-Forwarded-For` read, from the right: each trusted proxy
is skipped, and the first address that is not one is the client. A client may write anything at the left of the
header, but never past a trusted proxy, which appends the address it saw. So list the proxies only: a block
that also holds the clients would let a client name itself anything. An entry that is not an address or a
block stops the server at start. Without the setting the header is ignored, as before. The address the proxy
names is also what the host's own sign-in (Google, passkeys) is held to: from this machine only
(`isLoopback`). The Worker is not affected: there the address is `CF-Connecting-IP`, which Cloudflare sets.

Code in `apps/server/src/proxy.ts`, tested in `apps/server/test/proxy.test.ts`: the walk, and the setup
throttle locking out one client behind a proxy and not the next, and, without the setting, both.

### Addresses

The app's pages are plain paths through the History API (`apps/web/src/ui/router.ts`): `/` (the
presentations, the start page), `/presentations/{id}`, `/live/{id}`, `/trash?kind=Image`, `/logins`,
`/settings`, `/signin`, `/signed-in`, `/output`, and the admin pages under `/admin/` (as in the current app):
`songs`, `songs/{id}`, `users`, `devices`, `bibles`, `images`, `audios`, `overlays`, `themes`, `displays`;
`/admin` alone is the songs. `/songs`, `/songs/{id}` and `/presentations` from before still open their pages.
Everything the server answers itself is under `/api/`, so no page can collide with it, and an unknown `/api/…`
path is a JSON 404, never the app. An unknown page address is the start page. The one fragment left is an invite's token, `/invite#{token}`, because a
fragment never reaches a server and so never a log. The Node server (and so the desktop host) answers any
GET with no file extension outside `/api/` with `index.html`; a missing file (`/assets/x.js`) is a 404. The
Worker serves no static files yet, so there a reload on a page gives 404, as the web sign-in already did.
Links are ordinary `<a href>`: one click handler (`installLinkHandler`) turns same-origin clicks into
History navigation. For `pnpm dev` the Vite proxy forwards `/api` (and its WebSocket) to the server.

**Moving the API under `/api/` changed the Google redirect URI** to `{origin}/api/auth/google/callback`:
a real Google client registered with the old one must get the new one.

### Look

The web app is to look as the current Blazor app does (its `main` branch, not the pictures in `docs/public`),
on every screen size, light and dark. It uses Tailwind v4 (`@tailwindcss/vite`), set up as the current app's
`tailwind-input.css` (`apps/web/src/app.css`). Dark mode is the current app's: the class `.dark` on `<html>`,
the choice in localStorage `theme` (`light`, `dark`, `system`; the system's when none), chosen under Mina
inställningar (`/settings`) and applied before the first render (`apps/web/src/ui/theme.ts`). The shell is
`MainLayout.razor`'s top bar (logo to the start page, Beta, the sync's cloud, the cog to the admin pages, the
user's menu) and `AdminLayout.razor`'s side menu (`apps/web/src/Shell.tsx`). The shared components are in
`apps/web/src/ui/`: `AppButton` with the current app's variants (the only place a `<button>` is made; the lint
rule says so), `Dialog`, `Modal`, `FloatingInput`/`Select`/`Textarea`, `PillTabs`, the lists, `Dropdown` and
`PageContainer`. The start page (`pages/Presentations.tsx`) is `Dashboard.razor`: Idag, Kommande and the rest.

The presentation (step 2) is `Pages/Presentation.razor` and what it uses: the running order in a white side
column (`Sidebar.razor`; an item is dragged by its handle at the right, and the selected one has a ⋯ menu with
Ta bort), the slides as rounded tiles (`SlideGrid.razor`, `ui/SlideTile.tsx`), the green
Starta presentation, the add modal with its pill tabs and round search (`AddItemModal.razor`, `ui/Picker.tsx`),
the live page's panel at the right (`LivePanel.razor`: Nu visas, Utgångar, Overlays, fjärrstyrning as
switches in `ui/Toggle.tsx`, Scenläge, the red Avsluta) and the dark stage view with its bottom sheets
(`StageView.razor`). The flow is kept: live is still its own page, `/live/{id}`, with every item's slides.
Below `lg` (a phone) it is laid out as the current app's: the running order is a drawer from the left, open when
the page opens and closed by choosing an item or tapping the dimmed page, with the round menu button at the bottom
left and Starta presentation at the right; live's panel floats at the bottom right and folds to its caption and a
small picture; and a song tapped under Lägg till opens its preview full screen, with ✕ (or Escape) and its own add
button, while Bibeltexter keeps its preview in the tab. The live page has no running order, so no menu button.

The songs (step 3) are `Pages/Admin/Songs.razor` and `SongDetail.razor`: the list in a light card with
Papperskorg and the round search, marks in yellow; the editor under `DetailHeader.razor`'s round back button
(`ui/PageContainer.tsx`), the fields as floating fields, a card per part with its label as a pill, ↑ ↓ and
the bin, and the arrangements as stacked chips, each dragged by the whole chip, with the dashed Lägg till del. Song history and the ProPresenter import are not built,
so their pages and buttons are missing.

The admin pages (step 4) are `Pages/Admin/*.razor`, `Trash.razor` and `Profile.razor`: each a title row and
light cards (Biblar, Bilder, Ljud, Overlays, Teman, Skärmar, Användare, Enheter, the trash), the current app's
large grey pictures and small icons when a list is empty (`ui/Empty.tsx`), the dashed sky frame while files hover
over a page that takes them (`DropZone.razor`, `ui/DropZone.tsx`), the overlay under `DetailHeader` with
floating fields, the QR dialogs with the grey link field and its copy button (`ui/CopyField.tsx`), and the
trash under `DetailHeader` with its pill tabs. Inloggningsmetoder (`/logins`) is drawn as Min profil. Where the
new pages do more or less than the current ones (the user row's actions, the overlay's preview), they keep
what they do and only take the look. A public output's row is the current one's: the name, "Sänder från …"
under it while it sends, the viewer count ("0 enheter" too), Visa QR-kod and Ta bort; its link, the copy
button and Ny kod (under a line saying what it is for; the dialog closes after it) are in the QR dialog. The current app's user page,
templates, labels, CCLI report, API keys and super-admin pages have no counterpart yet.

Sign-in, setup, the invite and pairing (step 5) are `Login.razor`, `Setup.razor` and `InvitePage.razor`
(`pages/AuthCard.tsx`): the logo and the two-blue name, the fields as floating fields and the wide sky Kom igång;
the sign-in page in the middle of the screen over the slowly moving blue blobs (`animated-bg` in `app.css`), the
Google button white with its G; an invite that cannot be used as the old envelope picture without the logo.
Anslut till värddatorn has no counterpart and is drawn as setup. Anslut tillfällig skärm is
`PairingCodeDialog.razor`: the QR code in its white frame, "eller", the numbered steps, the grey address field
and the four large digit boxes, and the green tick when a screen is paired. `/display` is `Display.razor`'s
black page (the code huge in mono, the logo and name at the foot); `/watch` is `PublicWatchPage.razor`'s
three faint dots and `PublicSlideView.razor`'s slide, with the credits below the text rather than over it.
A paired screen shows `/watch`'s reflowing slide rather than the canvas. Where the new pages do more than the
current ones (Avbryt and Stäng in the pairing dialog), they keep what they do and only take the look.

Where the look would change what the app does, Lars decided (2026-10-27) to follow the current app: Bilder and
Ljud trash from a ⋯ menu; the editor's details and delete are in a ⋯ menu by the name; Skapa is always under
Lägg till's songs; a song item has Redigera, to the song's page; the song's label and Lägg till del are a list of
coloured pills (`ui/SelectMenu.tsx`, an ARIA select-only combobox, usable by keyboard alone); Rensa and B only
blank, and Rensa is gone while black; Utgångar, Overlays and Fjärrstyrning fold, each with an "i"; sign-in shows
the first way in, the rest behind "Fler alternativ", and the version (the commit: there is no release number yet);
the canvas is centred in a box that is not 16:9, by whole pixels so tiles do not move; text taller than the screen
scrolls on `/watch` and a paired screen, not on the output window.

Dragging, in the running order and an arrangement's chips, is the current app's SortableJS lists redone with
pointer events (`ui/sortable.ts`, no library): the mouse drags at once; a finger drags after holding still
150 ms, so a swipe still scrolls; the rows make room as the dragged one passes; near the edge of a scrolling list it
scrolls; Escape cancels. A drop is saved by the mutators the ↑ ↓ buttons used before (`moveItem`,
`moveArrangementPart`, moved `by` the places it passed), so sync is as before. The current app has no keyboard
way; here Alt+↑/↓ moves the selected item in the running order, and the focused chip in an arrangement (Tab
reaches each chip). Tested in e2e: the mouse and the keys (`milestone2.spec.ts`), and touch through Chromium's
touch input (`drag.spec.ts`); not on a real tablet or in Safari.

The move went in steps, and is finished: 1 the frame, the components and the start page; 2 the presentation
(editor, live, stage view, Lägg till); 3 songs; 4 the admin pages; 5 sign-in, setup, pairing, `/display`,
`/watch` and the output. Everything is Tailwind, except the slide itself: `apps/web/src/styles.css` keeps the
1920×1080 canvas's rules (`ui/SlideView.tsx`, and a verse number, also on `/watch`), in the CSS layer `slide`
below Tailwind's utilities. They are plain CSS on purpose: their sizes are the canvas's own pixels from spec 04
(LIVE-R17, R18), the theme's inline styles go on top of them, and what a screen shows should not move when the
rest of the app's look does.

`GP_CAPTURE=<dir> pnpm --filter @gp/desktop exec playwright test capture` takes a picture of every page, desktop
(1440×900) and phone (390×844), light and dark (`apps/desktop/e2e/capture.spec.ts`), to set beside the
current app's from `node scripts/capture-old-app.mjs <url> <dir>` with that app running in mock mode.
`GP_CAPTURE_ONLY=setup,login,…` takes only the named pictures. Pages with no counterpart in the current app
(setup, which mock mode skips, and Anslut till värddatorn) are taken in the new app only.

## Next steps

Where to pick up. Milestones 1–5, and the live work after them (stage view, remote control, public outputs,
audio, files by need, https on the LAN), are on branch `claude/milestone-1`, which also carries the latest ADR
0007 and spec (decisions up to D32); `claude/rewrite-behavior-spec` is behind it. Overlays, the first step agreed
on 2026-10-27, are built (see "Overlays"), and so are the second, starting the app on a tablet without the host
(see "Starting the app without the host"), and the third, the client's address behind a reverse proxy (see
"Behind a reverse proxy"), and the fourth, paired screens and the QR codes (see "Paired screens"). The rest, in
this order:

1. **PDF and PowerPoint import** (ADR 0007 (10), D29) and templates.
2. **A trial deploy to Cloudflare**, only with Lars's go-ahead: a temporary Worker and D1, measured and then
   deleted, as the sync spike did. Still unproven there: migrating an existing Durable Object (schema and
   triggers), `ALTER TABLE … DROP COLUMN` on D1, Ed25519 passkeys, Google sign-in against a real Google client,
   R2 as the media storage (tested against Miniflare's R2 only), live sockets in a hibernating Durable Object,
   and the Worker serving the web app (it serves no static files yet; when it does, `/sw.js` and index.html
   need `no-cache` there too).
3. **Getting there** (ADR 0007 (13)): the one-way import from the current app, packaging and updates per D32
   (the desktop app for macOS, Windows and Linux, and the Docker image), and the Capacitor app for tablets
   (ADR 0007 (7)), Android first and iOS later. Lars has said the Capacitor app need not come early: https on
   the LAN covers tablets for now.

Also waiting, in TODO.md: remote control as an organisation setting ("Aldrig", "Presentatören väljer",
"Alltid").

To try it with a tablet: `GP_LAN=1 GP_TLS=self-signed pnpm --filter @gp/desktop start`, then
`https://<the Mac's LAN address>:47843` on the tablet, accept the certificate warning once, and pair it under
Enheter → Anslut enhet.

Look work left for later, each as the current app does it: "✓ Sparad" in the song's
header, with saving 500 ms after typing (3.5); Extern skärm as a switch, once the window can be closed from there (2.6); a
paired screen drawing the projector's canvas, which needs the slide as `Slide` rather than `PublicSlide` (5.3);
and a "Gör tillgänglig offline" button per Bible, which needs each device to choose its Bibles (4.10).

The smaller gaps below can be taken along the way.

## Not done yet

Slide-deck pages, profile pictures and logos, templates, English text, mobile, and deploying to
Cloudflare. The Workers adapter is tested in local workerd only.

From milestone 5 and the media library: the S3 adapter of D31 (the interface has room for it; no adapter,
so an install that wants S3 cannot yet); organisation images as a theme's background (a theme's image is
still only a built-in asset, `backgroundImageSchema`, and there is no theme editor to choose one);
a limit on the total size of an organisation's media (only 1 000 pictures and 10 MiB per blob are limited); MEDIA-R14's eviction
by when a file was last used (it is by when it arrived); live and public URLs
(MEDIA-R10) and `/api/watch` with it; HTTP Range for audio; a native file dialog for "Importera" (the page's
file input is used, also in Electron); dropping files onto the add dialog. The page's
image pipeline runs only in Chromium (Electron) in the tests; Safari cannot encode WebP in a canvas, so there
it falls back to JPEG on a white background, which is written but untested.

From overlays: the picture on a public output (only the text is sent); reordering (spec 03 Q11, as there);
saving 500 ms after typing (a field saves when it loses focus, as song fields do); dropping a file onto the
overlay page (the picture comes from Bilder); the 500 ms fade of the black screen, which would cover the overlay.
An overlay deleted while it is shown disappears from the outputs at once (spec 04 keeps it until toggled). The
picture in an overlay is tested in the unit tests (which files are fetched), not drawn in an e2e test.

From the service worker: a tablet over plain http keeps no page (no secure context). Nothing tells the user that
a newer build is waiting while the app runs from its kept copy; the sync's update message is all, and a reload
fetches it. The worker is tested in Chromium only: whether Safari lets it answer the database worker's fetch of
wa-sqlite's wasm (a dedicated worker inherits its page's service worker in Chromium) is not known. A device
whose new build ran from the host, and whose new worker then failed to install before the host went, starts the
older kept build against a database the newer one may have migrated; that is not handled or tested. The Worker
on Cloudflare serves no static files, so there is no worker there yet.

From audio: HTTP Range on `/api/media`
(MEDIA-R9: clients play their own copies, so nothing asks for it yet); an item with several files.

From spec 04's public outputs: the Worker serves no static files yet, so on Cloudflare
`/watch/{code}` and `/display` have no page, though its API works; a viewer whose network is slow gets every event in turn
rather than only the newest (the stream is not a one-slot queue); the 500-viewer cap is not tested; texts are
Swedish only, not per Accept-Language. A Durable Object with open streams does not hibernate; spec 04 and
ADR 0007 leave a Durable Object per output for when that matters.

From spec 04's paired screens: the 4-hour idle unbinding of LIVE-R43; a screen gets what a public output gets,
so an overlay's picture is not shown, only its text; a saved screen
bound to a session that is not live shows its name rather than plain black. In local workerd a closed stream is
never noticed, not even when a ping is written: a saved screen stays Online and a public output's viewer stays
counted after the page has closed (on Node both go at once); whether Cloudflare itself notices is not known. A
four-digit code is unique across every organisation on the server: 8 999 at a time, plenty on a desktop host,
few on a shared cloud. Not tested on a real TV browser.

From spec 04's remote control: `?stage=true` in the link; the
4-hour idle eviction of LIVE-R42 (only an abandoned session, 2 hours without its owner, is ended); the
superadmin's Aktiva sessioner. A session id is per window
(kept for the tab's life), also in the desktop app, rather than derived from the device token (spec 04): a
desktop that restarts starts a new session, and the old one stays frozen until someone ends it or 2 hours
pass. Two operator windows on one machine share their pointer (one BroadcastChannel) and so show as two
sessions that move together. The 2-second warning is written but not tested.

From spec 04: the stage view (Scenläge, a button on the live page, `pages/StageView.tsx`) is built for the
operator's own session and a controller's, with the Overlays button; no `?stage=true` in
the URL. Next and previous stay within the selected
item (LIVE-R41); the page's own step keys, which cross items, are off while it is open. Its keys are a pedal's
or clicker's, as `utils.js`'s: → ↓ PageDown Space Enter next, ← ↑ PageUp previous, `.` `b` `B` blank (only
blank, as Rensa), Esc closes an open sheet or else the view; none of them in a text field. It is tested in
`e2e/milestone6.spec.ts`. The wake lock is requested but not tested.

From spec 05 and milestone 4: creating and editing themes (spec 05 and ADR 0001 have no editor yet;
the Teman page lists the built-ins and sets the default), the stage view and the public output, and
the theme's Media style (there are no media slides). BIBLE-R16's device-local Bibles (a translation
that never leaves the device) are not built, by decision D30: an import made offline is queued and goes
to the server (see "Bibles"). The Biblar page has no per-row "Gör tillgänglig offline": every
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
MCP keys and calendar feeds; the welcome modal; closing
an open poke socket when its session is revoked (it receives only sequence numbers until it closes,
and its next sync is refused); behind a reverse proxy, `X-Forwarded-Proto` and `X-Forwarded-Host`
(the Google redirect URI then needs `GP_GOOGLE_REDIRECT_BASE_URL`; see "Behind a reverse proxy").

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

Milestone 5 (media library):

- **A blob is named by the hash of its bytes, and an image has two** (`full`, `thumb`); spec 05 names objects
  `org/{org}/images/{id}/{variant}` and gives them a row id. Content addressing (ADR 0007 (9), D28) is what
  makes `private, immutable` safe and lets the same file twice be one object.
- **The server decides by signature**, not by a type the client sends, and takes only JPEG and WebP: the client
  has already re-encoded, so a PNG or GIF reaching the server is refused. It does not decode, so a file that
  starts like a JPEG and is not a picture is stored (and fails to draw on a device). Spec 05 decodes on the
  server (MEDIA-R3 "Invalid image file"); the Worker cannot, so the check is the client's decode.
- **No server-side resize.** The 1920×1080 and 400×225 sizes are the client's work; the server does not check
  the dimensions of a blob or that `thumb` is smaller than `full`. A client that lies can store a big
  thumbnail, up to the 10 MiB limit.
- **Everyone may import and trash images** (spec 05: User, Admin, SuperAdmin), and everyone may trash anyone's.
- **A file name over 200 characters is refused**, not shortened (spec 05 names the limit and no rule).
- **A picked file's type is what the browser reports; the extension counts only when it reports none**
  (MEDIA-R13 uses the extension on a device; a browser's own type is the better guide on the web).
- **Purging an image leaves its items**, which say the picture is gone, as a purged song does. The spec's
  "bytes deleted after the row" holds as: row first, blobs at the next clean-up, after the grace period.
- **Restore may exceed the 1 000 limit** (MEDIA-R8), and the limit counts only what is not in the trash.
- **An item's title is the file name** when it is added and can be renamed like any item; the picture's own
  name changes nothing (spec 05 has no rename of images).
- **Blob uploads that were sent before a restart are sent again** (the server takes the same hash twice), as for
  Bibles, and a blob whose add was refused (`media-missing`, the limit) is removed after an hour.

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
- **A translation imported offline is queued and goes to the server** (D30, ADR 0007), rather than
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
- **Throttling** (the spec has none): twenty failures from one address (setup token, pairing code, unknown public
  output code)
  lock that address for 15 minutes. At most 20 unfinished Google sign-ins, and 20 unfinished passkey
  ceremonies, per address at a time. Only failed guesses at a secret are limited in the app, never ordinary use: a
  church often shares one address, and a ceiling on all requests would hit its own members during a service. A
  general limit against floods belongs to the platform (Cloudflare's rate limiting rules, or a reverse proxy). On
  Node the address is the socket's, or behind a trusted proxy the one it names (see "Behind a reverse proxy").
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
- **The service worker keeps the app only, never data or the API**, and only the build it was made with: no
  runtime caching of anything the build did not list. A page waits 3 s for the host before it starts from the
  kept copy. A new build takes over at once rather than waiting for every tab to close, so a tablet whose tab
  stays open for weeks still gets it. As D32 has it for the Capacitor app, the copy always comes from the server
  the device is connected to, so it matches that server's version. Not registered in the desktop app's windows
  (their page comes from their own server) nor for a public output's viewer.
- **LIVE-R20: the "Visas nu" preview hides the part label too**, as the output does: it shows what
  the screen shows. Thumbnails keep it.
