# Assumptions

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
- **A save refused by the database says so** (02 Q10): a warning toast "Kunde inte spara", the amber
  kind the current app's toasts have. In the song editor, the field keeps what the user typed, so it
  can be put right and saved again; it shows the stored value again only when a sync moves it. A
  value the editor itself does not write (a blank name, a year out of 0–9999) gets no toast, and the
  field shows the stored value again when left, as before. Every write the user makes says so when
  refused; one that a next step waits for (create, then open; trash, then go back) stops there, and a
  create dialog stays open. The trash's and the themes' buttons keep their "Något gick fel". The trash's lazy purge of expired entries, which the user did not ask
  for, only logs a refusal. A warning already showing is replaced rather than stacked.
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
  refuses one in `packages/core/src/mutators/`. `apps/server/test/triggers.test.ts` shows both, and
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
  rules here are those in [Passkeys](sign-in-and-pairing.md#passkeys). The tests use the fake Google and a software authenticator, and there
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
  Node the address is the socket's, or behind a trusted proxy the one it names (see [Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)).
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
  (`default-src 'none'; script-src 'self'`). The Worker sends the app with the same headers
  (`apps/server/src/static.ts`).
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
