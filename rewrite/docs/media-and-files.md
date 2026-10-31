# Media and files

## Media

**What is synced and what is not.** A picture is a row in `images` (file name, type, the hashes of its two
blobs, size, `created_at`, `deleted_at`), which syncs like any other row, and two blobs that do not: `full`
(fits 1920×1080) and `thumb` (fits 400×225), each named by the SHA-256 of its bytes. Blobs are immutable, so
the same picture twice is one object, and each is fetched like a file, not replayed through the change log
(the reasoning is the Bibles', in [Bibles](bibles-and-themes.md#bibles)). `media_blobs` (not synced) says which blobs a database knows: on a device
the row holds the bytes (so pictures show offline and survive a reset), on the server it records that the
bytes are in the media storage. `addImage` checks both hashes there and is refused with `media-missing`
otherwise, so a mutator still reads only through its transaction.

**Where the bytes live (D31).** Behind `MediaStorage` (`apps/server/src/media.ts`): put, get, delete, by key
`org/{org}/media/{hash}` (`mediaKey` in core: every key starts with the caller's own organisation, and an
organisation id cannot contain `/` or `.`). Adapters: a folder (`media-disk.ts`; `{dataDir}/media` by default on
Node, so on the desktop host and a self-hosted server), R2 through the `MEDIA` binding on Cloudflare (a bucket
`gp-media` in `wrangler.toml`; without the binding the endpoints answer 503, MEDIA-R18), and memory (tests).
Backing up a self-hosted install is copying `/data`. S3 is not built (see [Not done yet](not-done-yet.md)).

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
device sees the row in a pull and downloads, hash and signature checked, the blobs it should keep (see [Which
files a device keeps](#which-files-a-device-keeps)).

**Clean-up.** Mutators never touch the blobs. After a push that can leave blobs unused (`addImage`,
`purgeImage`, `purgeExpiredTrash`, and for audio, video and slide decks their adds, `purgeAudio`, `purgeVideo`,
`removeItem` and `purgePresentation`), not after every edit, the server removes the blobs nothing names (`ORPHAN_BLOBS_SQL`),
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

## Audio

An audio file is a synced row in `audios` (file name, type, hash, size, `created_at`, `deleted_at`)
and one blob, stored byte for byte as it was picked (MEDIA-R5), through the same storage, upload
and clean-up as pictures. The server takes a blob it recognises by its first bytes as MP3, WAV, Ogg, MP4/M4A or
WebM, up to 20 MiB, and serves it with that type; a picture stays limited to 10 MiB. A device fetches an audio
file as it does a full picture: for a presentation that is open or coming (see [Which files a device keeps](#which-files-a-device-keeps)). Ljud
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

## Video

A video (TODO.md "Video, and which files a device fetches") is a synced row in `videos` (file name, type, codec,
hash, size, length in milliseconds, width, height, the hashes of its still's two pictures, `created_at`,
`deleted_at`; organisation schema 13) and one blob, the file byte for byte as it was picked: MP4 or MOV with H.264
or HEVC, at most 2 GiB, never converted. Its still, the first frame, is stored as a picture is, in both sizes
(`still` fits 1920×1080, `thumb` 400×225). A video item (`type` 'video', `sourceId` the video) has one slide, a
`media` slide whose picture is the still and which carries the video (`videoSlide` in core). Everyone may import,
trash and add videos (`ViewVideos`, `ManageVideos`, as for audio); at most 500, the trash not counted. The trash
holds them with the rest ("Videor"), and the clean-up takes all three blobs once nothing names them.

**What a file is** (`packages/core/src/video.ts`). The import and the server read the same boxes, a range at a
time: the `ftyp` box at the start (brand `qt  ` is MOV, anything else MP4), then the top-level boxes a header at a
time to find `moov`, which may be at either end, and in it the first video track's sample entry (`avc1`/`avc3` is
H.264, `hvc1`/`hev1` HEVC). Anything else is refused: the page names the codec and says to export as MP4 (H.264).

**The import** (`apps/web/src/media/video.ts`, the Video tab in Lägg till, Ctrl/⌘+6). The page checks the type
(the browser's, else the extension), size and name; reads the codec; loads the file once in a `<video>` from an
object URL for its length, size and the still (a device that cannot decode it, HEVC on Linux, is refused: it could
not make the still); hashes it with core's SHA-256 in steps, 8 MiB at a time (`Sha256`, no Web Crypto, as
`crypto.subtle.digest` takes only a whole buffer); then uploads it in parts and records it: the worker keeps the
still's blobs as a picture's, records the video's blob without bytes, and queues `addVideo`, whose still goes up
before it is pushed (`MediaUploads`). The video is never kept on the device, so importing one needs the server; an
upload that cannot reach it waits and goes on by itself.

**The upload in parts** (`apps/server/src/video-routes.ts`, all under ManageVideos):
`POST /api/media/{hash}/upload` with the size starts one, or says where one stands (`received`, always whole
parts) or that the server has the video (`done`); `PUT /api/media/{hash}/upload/{n}` takes part n, 8 MiB but the
last; `POST /api/media/{hash}/upload/finish` checks the hash, makes the object, reads its codec from it and only
then records it in `media_blobs`. The upload is known by the video's hash, in a server-only table of the
organisation (`media_uploads`), with the running SHA-256 of the parts so far, so the server never reads the file
back to check it. A part again is answered with where the upload stands, one out of order is refused (409), and
the first part must start with `ftyp` (the signature, not the claimed type, MEDIA-A6). In storage it is R2's
multipart upload on Workers, and on Node a file beside the key, written at each part's offset and renamed when
finished (`MediaStorage.startUpload`, `putPart`, `finishUpload`, `abortUpload`). An upload left for six days is
given up (R2 drops unfinished ones after seven). The page (`uploadVideo`) asks where the server is, sends the parts
after that, and on a network error or a 5xx waits 1, 2, 5, 10, then 30 s and asks again, for as long as the page
is open; a page that was closed starts over by picking the same file, which hashes to the same name and goes on
from the last part. The phone keeps no copy to go on from.

**Streaming.** `GET /api/media/{hash}` of a video streams it with HTTP Range (206 and `Content-Range`, 416 past
the end), never read into memory on the server (`MediaStorage.read` with a range: a file stream on Node, R2's
ranged get), with `Cache-Control: no-store`. A `<video src>` cannot send the session's header, so a signed-in page
asks `POST /api/media/{hash}/play` for a URL, `/api/play/{token}/{hash}`: a token good for six hours that names one
blob of the caller's organisation, kept hashed in the global tables (`play_tokens`, global schema 7) so the Worker
finds the organisation from it; the desktop host's pairing guard lets it through, as the token is the credential.
The editor's player (`VideoPreview`) loads nothing until played (`preload="none"`) and keeps nothing; the operator
window, the output window and a paired screen stream the same way. `fetchMedia` and `blobUrl` are never used for a
video.

**Files.** A device fetches a video's thumbnail always (with the pictures'), and its still with a presentation's
pictures, ahead or on demand as for pictures; never the video. "Alla bilder och ljud finns på den här enheten"
counts the still. On the desktop host the video is on the server's disk once, and `no-store` keeps Chromium's HTTP
cache in Electron's profile from keeping a second copy (that `immutable` would have done so for video was not
measured; `no-store` rules it out).

## Slide decks

A slide deck (D29) is a presentation item of type
`slides` whose `content` is `{ fileName, pages: [{ full, thumb }] }`: each page a WebP picture fitting 1920×1080
and its thumbnail fitting 400×225, rendered once at import and stored as media blobs like a library picture. It
is a snapshot like a Bible item: there is no deck table, `sourceId` is the item's own id, and the title is the
file name. `addSlides` takes 1 to 100 pages and is refused with `media-missing` if a page's blob is unknown
where it runs; `MediaUploads` uploads a queued deck's blobs before the push, as for `addImage`. A page is
named only by its items, so removing the item, or purging its presentation, lets the clean-up take its blobs
unless another item names them too: a template saved from the presentation, or a presentation made from a
template, copies the item with the same pages (D10);
`SLIDE_PAGES_SQL` lists every page, for the clean-up, the files a device keeps, and which pictures a public
output may serve. Live, each page is one slide showing its picture, like an image item.

The add dialog's PowerPoint tab (Ctrl/⌘+5, `SlidesTab.tsx`) takes only a PDF, picked or dropped, up to 50 MB
and 100 pages; a `.pptx` or `.ppt` is refused with how to save it as PDF. `media/slides.ts` renders each page
with pdf.js, loaded only when an import starts and cached by the service worker like the rest of the build,
so import works offline: drawn at the scale that fits 1920×1080 (a 960×540-point slide at twice its size),
then shrunk to the thumbnail. Pages are WebP, or JPEG on a browser whose canvas cannot encode WebP
(Safari), as a picture is. The database worker keeps the blobs and runs `addSlides` (`addSlides` in
`db/worker.ts`). pdf.js is given no font or wasm files: a PDF that leaves out its fonts is drawn with the
system's, and a page with a JPEG 2000 picture may lose it; PowerPoint, Keynote and Google Slides embed their
fonts and do not use JPEG 2000.

## Which files a device keeps

Every device has every row, but not every file (`syncMedia` and `MediaPolicy` in
`packages/sync/src/client/media.ts`). Always: every picture's and video's thumbnail, which is small and what the
library and the pickers show. Never a video: it streams (see [Video](#video)); its still counts as a full picture. Ahead of time, on a device that keeps its data (OPFS in a browser, the desktop
app, later the tablet app): the full pictures, the audio and the slide decks' pages (both sizes) of every presentation dated from today to seven
days ahead, so Sunday's material is on the computer before anyone leaves for church. On demand, on any device:
what a presentation open on one of its pages needs (the editor, the live page, remote control), fetched at
once. Kept offline, on a device that keeps its data: every file of a presentation marked "Tillgänglig
offline på den här enheten" in the editor, whatever its date, including what is added to it later (a local,
unsynced table, `pinned_presentations`; the list marks them "Offline"). A device
that keeps nothing between reloads shows the choice switched off and says why. Never: audio for a presentation the device only controls, since it plays on the presenting computer.
A device that keeps its data only in memory (a tablet over plain http) fetches nothing ahead, as it would lose
it at the next reload. Files no open or coming presentation needs are kept within 2 GiB (MEDIA-R14), the
oldest dropped first; what is coming, open, kept offline or waiting to be uploaded is never dropped. The editor and the live
page say whether everything is on the device ("Alla bilder och ljud finns på den här enheten") or how much is
being fetched, and, offline, how many files are missing and cannot be. A presentation without a date is
fetched only when it is opened; "coming" is decided by this device's own calendar day.

## The host's own window

The desktop host's own window (`hostWindow` in the worker's session) keeps its database in memory and no
files: the server beside it, on the same machine, holds every row, picture, audio file and Bible text, so a
copy in the window would be the same data twice on one disk (decided with Lars 2026-10-29). On start it pulls
everything before the first page shows (about 0.7 s for 3 000 songs and 50 presentations, see
[Performance](performance.md)); a picture, an audio file or a Bible text is fetched from the server when a
page needs it and held in that window only (`fetchMedia`, `fetchBibleText`). What it uploads (an import) is
kept until the server has it. It shows no "Data sparas bara i minnet" warning and no offline choices: the
editor's media line and Biblar say everything is there. A desktop paired to another host is not a host and
keeps its copy on disk, as a browser does.
