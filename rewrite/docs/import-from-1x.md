# Import from the current app

The one-way import of ADR 0007 (13): one organisation's data moves from the current app (1.x, PostgreSQL and
Garage) to the new one (2.0). Decided with Lars on 2026-11-03: an export file in two steps, user accounts moved
by e-mail, and all history.

## The two steps

1. **Export**, `apps/legacy`, run where the old database and Garage are reachable. It reads one organisation from
   PostgreSQL in one read-only snapshot and its files from Garage's S3 API, and writes one zip. Nothing in the old
   app changes.

   On the old server, as a Docker image on the old app's compose network, in the folder of its `.env`: the image
   reads `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `S3_BUCKET_NAME` from it and finds `postgres` and
   `garage` by their service names. Docker builds it straight from GitHub, so the server needs no checkout:

   ```sh
   docker build -t gospelpresenter-legacy-export -f apps/legacy/Dockerfile https://github.com/larsabrasha/GospelPresenter.git#main:rewrite
   docker network ls                                # the old app's network, e.g. gospelpresenter_default
   docker run --rm --network gospelpresenter_default --env-file .env -v "$PWD":/out --user "$(id -u):$(id -g)" gospelpresenter-legacy-export
   docker run --rm --network gospelpresenter_default --env-file .env -v "$PWD":/out --user "$(id -u):$(id -g)" gospelpresenter-legacy-export --org <id>
   ```

   The first run lists the organisations, the second writes `gospel-presenter-<id>.zip` beside the `.env`. `--env-file`
   takes the values as they are written, so a value in quotes in `.env` keeps its quotes. Without Docker, the same
   command runs from a checkout (`pnpm install` in `rewrite/`), pointed at the old app by `GP_OLD_*`:

   ```sh
   export GP_OLD_DATABASE=postgres://gospelpresenter:…@localhost:5432/gospelpresenter
   export GP_OLD_S3_ENDPOINT=http://localhost:3900 GP_OLD_S3_ACCESS_KEY=… GP_OLD_S3_SECRET_KEY=…
   pnpm --filter @gp/legacy export                  # lists the organisations
   pnpm --filter @gp/legacy export --org <id> --out kyrkan.zip
   ```

   The names are the ones the old `docker-compose.yml` uses (`GP_OLD_S3_BUCKET` defaults to `gospelpresenter`,
   `GP_OLD_S3_REGION` to `garage`). It prints what it wrote, the files it could not move and the running order
   items it left out; a picture that cannot be read is reported there too. Before it writes the zip it checks the
   rows as the server will (`legacyRowsProblem`), so an export the import would refuse stops there, naming the row. The zip is written as `<out>.partial` and
   moved to `<out>` only when it is whole, so a failed export leaves none. Node runs the TypeScript itself (`--experimental-transform-types`: core has parameter
   properties, which plain type stripping refuses); there is no build.

   The zip (`LEGACY_ENTRIES` in `packages/core/src/legacy.ts`) holds `manifest.json` (format, the organisation's
   name, counts), `users.json`, `rows/{table}.json` already in the new tables' columns, `bibles/{hash}.json` (each
   translation's canonical text) and `blobs/{sha256}` for every file. Entries are stored, not compressed, and
   written one by one, so an organisation's files never have to fit in memory; no ZIP64, so a zip past 4 GB or
   65,535 entries is refused.
2. **Import**, in the new app, by an admin: Inställningar → Organisationen → "Importera från version 1", pick the
   zip, see what it holds, Importera. The organisation may have content already (Lars, 2026-11-04): what it has is
   kept, and the import adds the rows whose ids it does not have. The page reads the zip a slice at a time
   (`apps/web/src/media/legacyImport.ts`) and goes in the order that lets a failed import be run again: it sends the
   users to `POST /api/import/users` (a second run keeps them as they are), uploads the blobs and Bible texts through
   the routes imports already use (`PUT /api/media/:hash`, `PUT /api/bibles/:hash`, four at a time, all stopping when
   one fails), and sends the rows last to `POST /api/import/legacy`, which writes all of them or none. A refused
   import says which row and why (`detail`), and the page shows it.

   The server (`apps/server/src/legacy-routes.ts`) checks the rows as the export did (`legacyRowsProblem`: every
   row names exactly its table's columns, an output's code and kind are 2.0's, Bible and slide deck items read),
   and that every blob and Bible text the rows name was uploaded; then it writes the new rows in one transaction,
   parents first (`ON CONFLICT (id) DO NOTHING`), so the change log has them and every device pulls them as usual.
   A row the database refuses undoes the whole import and is named (`write-failed`). Run again, the import adds
   nothing and changes nothing that was edited since. It registers the outputs' codes, so a saved TV or a public
   output keeps its address; an output whose code another output here or another organisation on the server holds,
   or whose code is not one 2.0 uses, gets a new one. Registering is done after the rows are in: if it fails, the
   import still is, and the next change to an output registers the codes. The users
   (`apps/server/src/global/legacy-users.ts`) are taken one by one: a new e-mail gets an account and a membership,
   an e-mail with an account elsewhere gets a membership, and a member already is left as they are.

The mapping from old rows to new ones lives in the export (`apps/legacy/src/map*.ts`), so the import only checks
shapes it already knows.

## What maps to what

| 1.x | 2.0 | Notes |
|---|---|---|
| `Organization` | (the organisation imported into) | Its name is shown before the import; the organisation keeps its own. `LogoSmall` is not used by 2.0. |
| `User`, `UserLogin` | `users`, `user_logins`, `memberships` (global) | By e-mail, lower-cased. `Admin` and `SuperAdmin` → admin, `User` → user. A Google login keeps its subject, so the first sign-in finds the account (Google's `sub` is the account's, whichever client asks). A subject another account has stays there. A user with no Google login gets an invite, sent from Användare. At most 100 users per organisation; the rest are counted and left out. |
| `SongPartLabel` | `labels` | The id is made from the text in 2.0 (SYNC-A12), so label ids are remapped and parts follow; two labels whose texts compare equal become one. A label the organisation has already, by the same text, keeps its colour. |
| `Song`, `SongPart`, `SongArrangement` | `songs`, `song_parts`, `song_arrangements` | Ids kept. `sort` numbered from 0 per song. 1.x has no order of arrangements: the table's own order (`ctid`) is the closest to how 1.x read them. Part ids an arrangement names that the song no longer has are dropped. |
| `SongVersion` | `song_versions` | `PartsJson` becomes a `SongSnapshot`. A 1.x version keeps name, author and parts; publisher, year, CCLI number and arrangements are the song's as it is now, the arrangements holding only the version's parts. The newest 50 per song (SONG-R21). `user_id` is the importing admin, as 1.x does not record whose change it was. |
| `CcliReportEntry` | `ccli_entries` | Id from `ccliEntryId` (song, day, presentation); `Reported` → `reportedAt` (`ReportedAt`, else `CreatedAt`). |
| `Presentation` | `presentations` | Templates included: `ScheduledDayOfWeek`/`ScheduledTime` → `weekday`/`time`, `LastUsedAt` kept. A presentation's `EventTime` → `time`. A theme id 2.0 does not have is dropped. |
| `PresentationItem` + parts | `presentation_items` | `sort` numbered from 0 per presentation. A song, picture or sound item is a reference; one whose song, picture or sound is gone is left out and reported (1.x showed its copy; 2.0 keeps none). An arrangement that is not the song's is dropped. A Bible item's parts, HTML (`<sup>16</sup>&nbsp;…`), become `BibleItemContent` segments; 1.x's item does not name its translation, so the translation is empty and the credits show none. A slide deck item becomes `SlidesItemContent` with the pages its parts name, in their order. |
| `PresentationSlides` | (none) | Each page `page-{n}.webp` becomes a picture blob and gets a thumbnail fitting 400×225. |
| `Bible` | `bibles` + `bible_texts` | `VersesJson` (`[{b, c, v, t}]`, USX codes) → the per-book text in canonical order, hashed with `bibleTextHash`. Id from the abbreviation (`bibleId`); a second translation with the same abbreviation is left out, and so is one whose abbreviation the organisation has already. `language` is empty. |
| `OrganizationImage` | `images` | `full` and `thumb` kept as they are when they are JPEG or WebP and fit 1920×1080 and 400×225; anything else (PNG, too large) is made again with sharp, JPEG staying JPEG and the rest WebP (MEDIA-R4). Width and height read from the stored `full`. |
| `OrganizationAudio` | `audios` | Kept as it is; the type is read from the bytes (`sniffAudio`). One that is not a sound 2.0 plays, or is over 20 MB, is reported and left out. |
| `OverlaySlide` | `overlays` | `sort` numbered from 0. An overlay's own picture becomes a library picture named after the overlay (`{id}-image`, listed under Bilder), as 2.0's overlay names a picture of the library. |
| `RemoteDisplay` | `displays` | The code is kept (same alphabet and length), so a saved TV keeps working once it points at the new server. 1.x also let a code be typed (`scene`, found in Lundhagskyrkan's data on 2026-11-04); 2.0's addresses take only its own, so such an output gets a new code, as one whose code is taken does. |
| `OrganizationSetting` | `org_settings` | `DefaultThemeId` → `defaultThemeId` when it is a theme 2.0 has; `CcliCollectionEnabled` → `ccliCollection`. A setting the organisation has already keeps its value. |
| `Theme` | (none) | 1.x has only the four built-in themes, with the same ids. |
| Trashed rows | trashed rows | `DeletedAt` → `deleted_at`, so the trash keeps its 30 days from when they were trashed. |

Not moved: sessions, device tokens, invites, MCP keys, calendar subscriptions, user settings, the sync tables, and
the media cache.

## How it is tested

- `apps/legacy/test/map.test.ts`: the mapping, on rows made in the test; `files.test.ts`: an unreadable picture, a
  failed export, and the zip read back by core.
- `apps/legacy/test/export.test.ts`, opt-in (`GP_LEGACY_PG`): the export against a real PostgreSQL with 1.x's
  schema (`test/fixtures/schema-1x.sql`, from `dotnet ef migrations script`) and a seed of every kind of row
  (`seed-1x.sql`), read back from the zip. The command at its top starts the database in Docker.
- `apps/server/test/legacy-import.test.ts`: the import routes on every server adapter.
- `apps/desktop/e2e/legacy-import.spec.ts`: picking a zip under Organisationen and finding its song, presentation,
  Bible and user after; and importing into an organisation with a song, which keeps it.
- Tried by hand on 2026-11-03: the command against that PostgreSQL and a Garage v2.2.0 in Docker, and its zip
  imported in the desktop app; then the image, built locally, on a Docker network where the two are named
  `postgres` and `garage`, with a `.env` as the old app's (a password with `&` in it). Not tried: the build from the
  GitHub URL (the branch was not pushed), nor on the real server.
- On 2026-11-04, on Lars's server: the image built from the GitHub URL, the listing, and Lundhagskyrkan's export
  (908 songs, 3,681 parts, 16 files, nothing left out). Imported on gp-test, the server refused the rows without
  saying why. With the row named, it was an output whose code was typed in 1.x (`scene`); such an output now gets
  a new code.

## Not known yet

- Whether a real organisation's data holds something else the seed does not.
- How the import behaves with a large zip: the rows go in one request and one transaction, which a Durable Object
  has to finish within its CPU limit. Not measured.
- Calendar subscriptions: 2.0 has none yet, so a church using them loses the feed.
