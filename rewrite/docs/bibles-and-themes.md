# Bibles and themes

## Bibles

A translation is two things: a row in `bibles` (name, abbreviation, language, verse count and the
hash of its text), which syncs like any other row, and its text, which does not. The text is one
immutable document, `{"v":1,"books":[{"code":"GEN","verses":[[1,1,"…"],…]},…]}`, named by the
SHA-256 of exactly that JSON. It is kept one row per book in `bible_texts`, plus a row in
`bible_blobs` that says the text is complete, on the server (in the organisation's database or
Durable Object) and on each device that keeps it (below). Import reads the zip on the device (USX from a DBL zip, or
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
stays refused. Every other device sees the row arrive in a pull. Which texts a device keeps is its
own choice, as in the current app (BIBLE-R15): Biblar has "Gör tillgänglig offline" per translation,
and a kept one shows a grey "✓ Tillgänglig offline" that removes the copy ("Ta bort den nedladdade
kopian"). The choice is a local, unsynced table, `kept_bibles` (by translation id, so a re-import stays
kept). A kept text is downloaded once (`GET /api/bibles/{hash}`, any member, only from
its own organisation), its hash checked, and kept; searching and adding verses then needs no network.
"Gör tillgänglig offline" downloads at once, and without a connection says so and keeps nothing. A
translation imported on a device is kept there. One not kept is fetched when Bibeltexter needs it, held
in that window only and never stored; offline it cannot be had, and Bibeltexter says so. A text no kept
translation names is dropped on the next sync, unless a queued import still has to upload it. A desktop
host keeps every text whatever was chosen and shows no button (it serves the LAN, as the current app's
server, which had none); neither does a device that keeps nothing between reloads, which says why.
`syncBibleTexts`, `keepBible` and `dropBible` are in `packages/sync/src/client/bibles.ts`, tested in
`apps/server/test/bibles.test.ts`; the button's states in `apps/desktop/e2e/milestone4.spec.ts`. An added reading is split into slides when it is added and kept on the
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

## Themes

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
