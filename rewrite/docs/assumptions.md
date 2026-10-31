# Assumptions

Where the spec and ADR 0007 leave a choice open, the conservative one, written down:

- **The admin pages open in a dialog over the page the user is on** (Lars, 2026-10-31), not as pages of their own
  as in the current app: Inställningar can be opened from inside a presentation, which goes on presenting under it.
  The addresses stay under `/admin/`; a link straight to one opens it over the start page. Only Stäng closes it,
  not Escape or a press outside, so nothing half done is lost by a slip; it goes back through the admin pages
  opened since to the page under them. Signing in lands on the start page, not on Sånger, so it does not open
  the dialog.
- **Om Gospel Presenter** (`/admin/about`, Lars, 2026-10-31) is new: at the foot of the admin menu, for everyone,
  with the version (the commit) and links to the website and GitHub. Mina inställningar has no Om card any more.
- **In a presentation the bar has "‹ Presentationer"** in place of the logo and Beta (Lars, 2026-10-31), a way back
  that says where it goes; the current app shows the logo everywhere.

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
- **Skapa in Lägg till opens the new song's editor there** (decided with Lars on 2026-10-30; the current app
  asks for a name first): the song is named as the search ("Ny sång" when nothing was searched for) and has an
  empty first part, where typing starts. Its header has Avbryt, "Ny sång" and Lägg till (Ctrl+Enter), which adds
  it as any song and starts the search over. Avbryt, or closing the dialog, throws the song away for good (not
  to the trash); Avbryt asks first when anything was typed. Escape in the editor there goes back one step, as
  Avbryt or the back button do, and a second Escape closes the dialog (`e2e/editor.spec.ts`).
- **Song search reads a line break as a space** (SONG-R33 as changed with Lars on 2026-10-30): a phrase typed as
  it is sung, over a line break of the lyrics, gets the phrase bonus; the current app gives it none. Otherwise
  the search is the current app's, rule for rule and point for point (`packages/core/src/search.ts`).

Remote control for the whole organisation (LIVE-R38 and R39 as changed on 2026-10-29):

- **The policy is a row of `org_settings`**, `remoteControl` = `never`, `presenter` or `always`; no row (or a
  value this build does not know) is `presenter`, today's behaviour. It is set by `setRemoteControl`, which needs
  `ManageOrganizationSettings`, a new permission that Admin and SuperAdmin have. Spec 01 ORG-R8 has settings
  written with `ManageUsers`; a permission of its own keeps it apart from managing users.
- **The server decides**: the live hub reads the row on every command and every sessions list, so a window
  that reports "Tillåt fjärrstyrning" under "Aldrig" is still refused, and one that does not under "Alltid" is
  still driven. After a push of `setRemoteControl` the hub sends the sessions to everyone, so a running session
  follows at once. The window keeps reporting its own toggle, and keeps it: back under "Presentatören väljer",
  each window is as its presenter left it.
- **The live page follows the policy**: under "Aldrig" the Fjärrstyrning section is gone; under "Alltid" it
  says "Alla i församlingen kan fjärrstyra presentationen." in place of the switch, and the QR code button is
  always there. A controller refused under "Aldrig" sees the same "Fjärrstyrning är inte aktiverad av
  presentatören" as today.
- **The page is new**: the current app has no organisation settings page. "Församlingen" in the admin menu
  (`/admin/settings`, "Församlingens inställningar"), for those with the permission; it looks like "Mina
  inställningar". It is not called "Inställningar", which the admin button in the top bar is already called.

Idle limits on live sessions and screens (LIVE-R42, R43, R50; built 2026-10-31):

- **A session whose owner has not reported for 4 hours is ended, owner online or not** (LIVE-R42). A report is
  sent on every change the window makes (a slide, black, an overlay, the remote toggle, outputs, sound, video)
  and on every reconnect; a controller's command counts once the owner applies it. An open screen or output
  does not keep a session alive, unlike the old app's reads. The server ends only its own copy: a window still
  presenting goes on presenting and brings the session back with its next report, as LIVE-R50 has for a
  mirrored session. It is not told, and its local outputs stay. Checked when anything happens on the hub, not
  every minute, so a phone that has the list open sees the session go with the next event.
- **A screen is let go when its session has not changed slide for 4 hours** (LIVE-R43): another slide, black,
  an overlay, or an edit to what shows; not the remote toggle or sound. Both kinds: a temporary screen shows a
  new code, a saved screen its name. Public outputs are not let go. The owner window hears `released` and
  switches the screen off, and the server will not bind it to that session again until it has been switched
  off, so the operator may switch it on again. Checked by a timer for the screen due first, and whenever
  anything happens.
- **A saved screen whose session expired shows its name** (LIVE-R50's reaper, or LIVE-R42), as the old app
  did. One whose session was stopped (Avsluta, or an ended session from another phone) still draws black, as
  Display.razor does, until its page is opened again.

The ProPresenter import (spec 02 "Import card", SONG-R35–R44; built 2026-10-31):

- **The files are read in the page** (`packages/core/src/propresenter.ts`), with a small reader of protobuf's
  wire format rather than a library, and written in one `importSongs` mutation: there is no
  `/api/upload/import-songs`, and the import is all or nothing as SONG-R44 has it. An import of more than 500
  songs goes in several mutations of 500. A file over 25 MB is not read, on every device.
- **Duplicates are chosen per song, with both texts to compare** (SONG-R42 as changed with Lars on 2026-10-31;
  the current app asks once for all, by name only). A song shares a name with one in the library or earlier
  in the import (case and composition aside, as SONG-R42); it is marked "Likadan" when the text is the same
  word for word (spaces, line breaks and blank lines do not count; labels, arrangements, author and CCLI do
  not either) and "Annan text" otherwise, and asked about either way. Each row has Hoppa över, Ersätt and
  Behåll båda (only the first and last for a name met earlier in the import), "Visa text" shows the library's
  and the file's text side by side, and "Alla:" sets every row. A same song starts as Hoppa över, another
  text as Behåll båda, so no text is lost by default; Behåll båda adds the song beside the other under the
  same name. Of several library songs with the name, the one with the same text is compared with, else the
  first. The choice is made on this device: the mutation replaces the song it names, or adds the song when
  that one is gone or in the trash where it runs, and adds every other song, so a song of that name another
  device added meanwhile is not skipped; nothing is lost, but two songs may then share a name. The texts are
  shown whole, without marking the words that differ.
- **The text is read as the current app does, but better in four ways**, checked on 882 real `.pro` files
  (GP_REAL_PRO_DIR, `packages/core/test/node/real-propresenter.test.ts`): the RTF's header groups (fonts,
  colours, `{\*…}`) go first, so a slide with empty text boxes is no longer read as `;;` and `\*;;` (ten of
  those files were songs of only that; now they count as files without song text); one blank line between
  lines is kept, at most (Lars: one or two breaks in a row), where the current app kept none; spaces at a
  line's end go; and a `\uN` escape is its character (Cocoa writes the line separator U+2028 so, 38 times in
  those files), where the current app dropped it. None of the 882 got "Untitled" (Lars remembered that many did
  in the current app); the title rule is SONG-R36's.
- **A label is matched and made as the song editor makes one** (`labelId`, the default labels' colours, grey
  otherwise), not by SONG-R43's colours from the text.
- **Skapa stays in the header with an empty library**, as it was (the current app shows only the import then).

The labels page (spec 02 `/admin/labels`, SONG-R45–R47; built 2026-10-31):

- **The server writes the 25 default labels once** when it opens an organisation's database (`labelSeedSql`,
  marked in a server-only `server_seeds` table), after its change triggers, so they reach every device as
  changes do and one the organisation deletes stays deleted. Before, the song editor offered the defaults
  without rows and made one when it was picked, so a deleted default came back. An organisation that has
  labels already gets the defaults it lacks once; one whose text a label has (any case) is left as it is.
- **A label is found by its text, case and spacing aside** (`labelKey`): a song's part, an import and the
  editor name a label by its text, so a renamed label is still found. Two labels may not share a text, and the
  dialog says so as it is typed ("Det finns redan en etikett med den texten."); the current app compared case
  sensitively and threw without a message. A new label's id is its text (`labelId`) as before, or with a
  number when a renamed label holds that id. At most 200 labels (the current app has a limit without a number).
- **A label made from a song or an import is appended to the order**, in the default label's colour or grey,
  rather than placed at its default position.
- **Order by ↑ and ↓ only**, as the current app; no dragging. A label pill keeps white text on any colour.

Song history (spec 02 `/admin/songs/{id}/history`, SONG-R20–R24, D9; built 2026-10-31):

- **A version is the whole song** (D9; Lars chose "Hela sången"): name, author, publisher, year, CCLI, the parts
  with their ids and labels, and the arrangements (`song_versions.data`, `SongSnapshot`). Restoring gives all of
  it back, the parts with their old ids, so arrangements and presentation items still find them; parts and
  arrangements the version lacks are deleted. The current app kept name, author and parts only, and gave the
  parts new ids, which emptied the arrangements. A part's label is the one it had if that is still there
  (renamed or not), else one with its text.
- **Only the server keeps versions** (when it runs a change, `ctx.now`), and they sync to every device like a
  song does, so the history reads offline and on the desktop host. A restore runs on the device at once.
- **30 minutes per person** (Lars chose "Per person"): a change keeps no new version when the same person made
  the newest one under 30 minutes ago; anyone else's change does keep one. So an edit sent later by a device
  that was offline never hides another's text: that is SONG-R24 here, where the sync does not refuse such a
  push. The window runs from the newest version, not from the last change, so a long session keeps one version
  per half hour; the current app moved the newest version's time on with each change, which would send the
  whole version over the sync with every save.
- **No version of a song without parts** (a new song being written), and **none that equals the newest**.
  An import that replaces a song keeps one first (D9), as a restore does, whatever the window.
- **At most 50 per song**; purging a song deletes its history with it. The list shows the name and "Idag 14:05",
  "Igår 09:30" or "3 okt. 2026 14:05" in the device's time zone; not who made the change.

The CCLI report (spec 02 `/admin/ccli-report`, SONG-R48–R53; built 2026-10-31):

- **The window that presents counts** (`live/ccli.ts`): a song slide shown 10 s without a change of slide, item or
  black screen records the song with `recordCcliUse`, a synced mutation, so it works offline and a session is
  counted once whoever controls or watches it (SONG-R51, with no "reported elsewhere" flag). A new overlay or the
  same pointer sent again does not start the 10 s over. A presentation shown in two windows records once, as the
  entry's id is the song, day and presentation.
- **The day is the presenting device's own** (Lars chose "Datorns lokala datum", 02 Q12), so a service after midnight
  UTC is on the day it is held; the current app took the server's UTC day.
- **A card per day and presentation** (Lars chose "Per presentation", 02 Q13): two presentations of the same name on
  the same day get a card each; the current app merged them by name.
- **Admins only** (Lars chose "Bara admin", 02 Q11): the menu entry, the page, the collection switch and Rapporterad
  are for admins; a user sees no link. Anyone who presents records entries. The entries sync to every device, as
  every other table does; they hold song and presentation names that every member sees anyway.
- **Both switches move at once** and go back if the write is refused (the current app's moved and said nothing). A
  card marked under a filter it no longer matches stays until the filter changes, as it did. "Visa fler" shows 50
  more entries of those already on the device.
- **The names and the number are as shown** and are not tied to the song or presentation, so an entry outlives both.

Templates (spec 03 "Template", screen 3):

- **A template is a row of `presentations`** with `is_template` set, as in the current app: the editor, its
  items and the clean-up of slide pages serve both. Every list and mutator keeps the two kinds apart: the start
  page lists presentations only, the templates page templates only, and a presentation's trash, restore and
  purge never touch a template, nor the other way round (PRES-R24). A template's id under `/presentations/` (or a
  presentation's under `/templates/`) is not found.
- **Editing a template is for admins** (D24): every item mutator asks for `ManageTemplates` when the item's
  presentation is a template, and `/templates/{id}` tells a user it is for admins. Everyone has
  `ViewTemplates` and may make a presentation from a template (PRES-R5).
- **A copy keeps the arrangement and the slide decks** (D10, PRES-R31 as changed on 2026-10-28): a song item
  keeps its `arrangementId`, a deck item its pages, which are content-addressed, so the copy names the same
  blobs and the clean-up keeps them while any item names them. A copied item's overlay goes along too.
- **A copy holds what the user saw**: the client lists the items to copy, each with a new id it makes, so the
  client and the server make the same rows. An item added to the source by someone else before the copy
  reaches the server is left out; one removed meanwhile is skipped.
- **The picker shows the 10 last used, never-used last** (03 Q7, PRES-E12), then by name. The templates page
  lists by name: there is no "last changed" in the rewrite. `UseCount` is left out: nothing shows it.
- **A template's time and place prefill nothing but the date**: presentations have no event time or place yet
  (see [Not done yet](not-done-yet.md)), so a presentation made from a template gets its name, the date of its
  next weekday, its items and its theme.
- **Weekdays start on Monday** in the details dialog, Sweden's first day of the week; the old app took it from
  the culture.

Video (TODO.md "Video, and which files a device fetches", 2026-10-31). Lars decided the formats, the size, the parts,
the streaming and who plays what; these are the choices the implementer made where that leaves one open, not Lars's:

- **A `<video src>` streams with a token in its URL**, `/api/play/{token}/{hash}`, since it cannot send the
  session's header and the API has no cookie. A signed-in caller with ViewVideos asks for it
  (`POST /api/media/{hash}/play`); it names one blob of one organisation, lasts six hours, and is stored hashed in
  the global tables, so the Worker finds the organisation from it. It is the one exception to "secrets travel in
  headers and bodies, never URLs" (Milestone 3 below), as signed URLs are at CloudFront, Cloudflare Stream and Mux
  (Lars chose to keep it, 2026-10-31): it reaches only that video, for a few hours, and ends with the session it was
  minted for (signing out or a revoked session). The server logs no URLs, and `Referrer-Policy: no-referrer` keeps it
  out of other sites' logs; a reverse proxy in front may still log it. A page asks for a new one when fewer than ten
  minutes are left.
- **The server reads the codec too**, at the end of an upload (the `moov` box, read back a range at a time), not
  only the `ftyp` signature; a file whose codec is not taken is removed, so a changed client cannot store one.
- **A part is 8 MiB** (R2 wants at least 5 MiB, one size but the last); 2 GB is read as 2 GiB, so at most 256 parts.
  An unfinished upload is given up after six days. At most 500 videos, the trash not counted, as for audio.
- **The still is taken a bit into the video** (Lars, 2026-10-31: the first frame is often black or a fade): at 1 s or
  a tenth of the length, whichever is earlier, and never at the very end of a short clip (`stillTime`). Videos
  imported before keep their stills. A device that cannot decode the video cannot import it (it could not make the
  still); a `moov` over 64 MiB is refused.
- **Importing a video needs the server**: the video is never kept on a device, so there is nothing to queue it from.
  An upload that loses the network waits and goes on by itself while the page is open, also after the dialog closes.
- **The hash is core's own SHA-256**, in plain JavaScript, 8 MiB at a time on the page's thread: about 180 MB/s on a
  Mac (2 GB in some 11 s), slower on a phone; the server uses the same code to carry its running hash between parts,
  which a Worker could not do with a WebAssembly library. No new dependency.
- **The presenting window is the clock and the sound**: its own element plays with sound; the output window on the
  same machine follows it, muted, from the state on the live channel (within 0.04 s by up to 5 % faster or slower,
  a seek past 0.3 s), whether or not an output window is open. A paired screen follows the same way from its canvas.
  How far the projector's picture and the sound drift apart on real hardware is not measured.
- **A video item that goes live starts from its beginning; leaving it stops it**, also when going back to it (it
  starts over). An audio item plays on after it is left (LIVE-R6); a video's sound belongs with its picture.
- **"Svart skärm" (B, Rensa) pauses a playing video, picture and sound; showing the picture again resumes it where
  it was** (Lars, 2026-10-31). A video paused by hand stays paused when the picture comes back. A window reloaded
  while black, with its video paused by black, does not know that black paused it: the video stays paused (mine).
- **A reloaded presenting window resumes a live video where it was** (Lars, 2026-10-31), from the state it kept with
  the pointer (position and moment, in the tab's `sessionStorage`), playing or paused as it was.
- **A controller drives a video as it drives audio** (mine): its player sends play, pause and seek to the presenting
  computer (`video` messages, relayed like `audio`) and mirrors the state the owner reports. Its warning about a
  codec it cannot play is left out: it plays nothing.
- **Whether a device can play a codec is `canPlayType`** with Main profile strings (`avc1.4D4028`,
  `hvc1.1.6.L120.90`), not `MediaCapabilities`, which answers asynchronously.
- **The Video tab is the sixth in Lägg till (Ctrl/⌘+6)**, after PowerPoint, so the other tabs keep their keys. Videor
  among the admin pages (`/admin/videos`, after Ljud) lists them with still, length, size and codec, imports and
  trashes, as Ljud does; no playback there (mine).
- **Every video response is `no-store`**, the session's `GET /api/media/{hash}` too: the desktop host keeps the
  file once, on the server's disk.

Which files a device fetches, keeping offline and storage (TODO.md, the same section; Lars decided the rules, these
are the implementer's choices within them):

- **Looking around shows thumbnails where the full picture is not here**: tiles, previews and the overlay editor
  draw a picture's `thumb` (every device keeps it) until presenting or keeping offline has fetched the `full`. The
  live preview on a controller does the same, as a controller fetches nothing.
- **"Hämtar bilder och ljud" while presenting is quiet**: said to screen readers only; the line shows only when files
  are missing and cannot be fetched (offline).
- **An object URL of a picture or a sound is let go 30 s after nothing shows or plays it** (`holdBlobUrl`), so a
  slide shown again soon after still has it.
- **A video kept offline lives in the browser's private storage (OPFS) as a file**, `videos/{hash}`, not in the
  database (a row cannot hold 2 GB); a local table, `video_files` (organisation schema 14, not synced), says how much
  of each is here. It is fetched with HTTP Range from where an earlier try stopped, hashed as it comes, and renamed
  from `{hash}.part` only once the hash matches; a mismatch starts it over. A page plays a kept video from that file
  (an object URL of the file reads from the disk), before asking the server for a token.
- **The icon** is a cloud with an arrow (not kept), a ring that fills by files, a video counting by its bytes
  (fetching), and a sky check (all here). It sits after the title in the list and in the editor's side menu; the
  host's own window and templates show none; a device that keeps nothing shows it faded with why. Clicking it again
  stops keeping it, without a question. One kept by "Spara kommande presentationer offline" says so and is undone
  there, not on the icon.
- **"Spara kommande presentationer offline" and the cache limit are kept in the browser's `localStorage`**, as the
  theme is: a choice of the device, sent to the database worker when the app starts and when it changes.
- **What is kept no more becomes cache at once**: its pictures and videos count against the limit, oldest first, a
  video's part at once.
- **The cache limit's slider** goes from 128 MiB, in steps of 128 MiB, to the room the cache could have: the free
  room on the disk (`fs.statfs` in the desktop app) or what the browser grants and has not used
  (`navigator.storage.estimate()`), plus what the cache holds now; 20 GiB when neither answers. 2 GiB until moved.
- **"Lagring på den här enheten" counts the app's files** (pictures, audio, stills, pages and kept videos), not the
  database or the app itself; a file shared by two presentations counts once in the totals and in each
  presentation's size. "Rensa cache" asks nothing first. On a desktop host's own window it says the files are the
  server's.

Milestone 5 (media library):

- **"Importera" uses the page's file input, also in the desktop app** (Lars, 2026-10-31): Electron shows the
  system's own file dialog for it, filtered by the input's `accept`. The current app's own dialog had the title
  "Välj bilder" and the filter "Bilder"; that is all that differs, and a dialog in the main process would send
  the files' bytes to the page, up to 2 GB for a video, where the page now reads a file in parts.
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
