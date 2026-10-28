# Bibles, themes and media

## Overview

- **Bibles**: an organisation imports Bible translations (a `.zip` in USX or USFM format) and then adds
  passages to presentations, either by typing a reference (`Joh 3:16`, `Rom 8:28-30`) or by browsing
  book → chapter → verse. The passage is split into slides once, when it is added, and frozen.
- **Themes**: a theme decides how slides look (fonts, sizes, colours, alignment, shadow, background
  colour/image per slide type). Four built-in themes ship with the product; an organisation picks a
  default, and a presentation may override it. No theme editing exists yet.
- **Media**: an organisation keeps a library of images and audio files that presentations reference.
  Images are resized/re-encoded on upload; deletion moves a file to the trash. Device apps
  (Electron/MAUI) ingest files locally and sync the bytes later; profile pictures and organisation logos
  are small inline images handled separately.

All paths cited below are relative to the repository root.

## Concepts

### Bible translation (`DbBible`)
- Fields that matter: `Id` (GUID, used only for sync/offline download), `Name` (≤200 chars),
  `Abbreviation` (≤50 chars, **the user-facing identity**: unique per organisation, and used as the
  "bible id" everywhere in the UI and services), `VersesJson` (all verses), `VerseCount`,
  `OrganizationId`, `ModifiedAt` (`GospelPresenter/GospelPresenter.Shared/Models/DbBible.cs:3-16`,
  unique index `GospelPresenter/GospelPresenter.Shared/Contexts/PresentationContext.cs:409-414`).
- A verse is `{ b: bookCode, c: chapter, v: verse, t: text }`, serialized with those one-letter JSON
  names (`GospelPresenter/GospelPresenter.Shared/Services/BibleConverter.cs:33-38`). Book codes are USX
  codes (`GEN`, `MAT`, `1CO`, …). Verse ranges in the source (`3-4`) become the first number only.
- The server keeps every organisation's Bibles in an in-memory cache keyed by org and abbreviation,
  loaded at startup and updated on import/delete
  (`GospelPresenter/GospelPresenter.Shared/Services/BibleService.cs:51-98`,
  `GospelPresenter/GospelPresenter.Web/Program.cs:385-386`).
- Lifecycle: import (create or replace by abbreviation) → delete (hard delete + sync tombstone). No trash.
- **Offline state** (device apps only), per translation: `NotAvailable` (metadata only),
  `Downloaded` (user pinned it; kept fresh), `ImportedLocally` (verses exist on the device without a
  pin) (`GospelPresenter/GospelPresenter.Shared/Services/IBibleOfflineStore.cs:3-30`).

### Bible text item / slides (`BibleText`)
- Created from a list of verses: `Title` + `Parts` (HTML per slide). Parts are stored in the
  presentation item and never re-chunked (see Presentations area). Title format uses **Swedish** book
  names regardless of UI language
  (`GospelPresenter/GospelPresenter.Shared/Services/BibleTextService.cs:34-47`).
- The translation used is **not recorded** on the item (title has no abbreviation; UI path sets no
  `SourceId`) (`GospelPresenter/GospelPresenter.Shared/Pages/Presentation.razor:1701-1726`).

### Theme (`Theme`, `SlideTheme`)
- `Theme` row: `Id` (stable slug for built-ins), `OrganizationId` (null = built-in, global), `Name`
  (empty for built-ins; their names come from resources `Theme.Name.{slug}` /
  `Theme.Description.{slug}`), `SortOrder`, `Definition` (JSON), `ModifiedAt`
  (`GospelPresenter/GospelPresenter.Shared/Models/Theme.cs:10-36`).
- `Presentation.ThemeId` nullable: null = follow the organisation default; FK `ON DELETE SET NULL`
  (`GospelPresenter/GospelPresenter.Shared/Contexts/PresentationContext.cs:271-277`).
- Organisation default: org setting key `DefaultThemeId`
  (`GospelPresenter/GospelPresenter.Shared/Models/OrganizationSetting.cs:9`).
- `SlideTheme` has three blocks (`GospelPresenter/GospelPresenter.Shared/State/SlideTheme.cs:12-35`):
  - `Song`: `SlideStyle` = Background + MainText + Credits
  - `BibleText`: `SlideStyle`
  - `Media`: `SlideBackground` only (used for Image and Slides items; any other type — e.g. audio —
    uses `Song.Background`).
- **Every themable property**:

  | Level | Property | Type / values | Default |
  |---|---|---|---|
  | Background | `Color` | any CSS colour | `#000000` |
  | Background | `Image` | `{Source: BuiltInAsset\|OrganizationImage, Value, ContentHash}` or null | null |
  | Background | `Fit` | `Cover` \| `Contain` | `Cover` |
  | Background | `ScrimPercent` | int, clamped 0–100 (black overlay over the image only) | 0 |
  | Text role | `FontSize` | px on the 1920×1080 canvas | 75 (credits default 40) |
  | Text role | `FontFamily` | CSS font stack (7 known: Tahoma, Inter, Lato, Montserrat, Oswald, Playfair Display, Merriweather) | Tahoma stack |
  | Text role | `FontWeight` | int | 400 |
  | Text role | `LineHeight` | double | 1.4 (credits 1.2) |
  | Text role | `Color` | any CSS colour incl. rgba | `#ffffff` (credits `rgba(255, 255, 255, 0.4)`) |
  | Text role | `Align` | `Left` \| `Center` \| `Right` | `Center` (credits `Left`) |
  | Text role | `Shadow` | bool → `text-shadow: 0 0.06em 0.18em rgba(0,0,0,0.65)` | false |

  Sources: `GospelPresenter/GospelPresenter.Shared/State/SlideTheme.cs:62-147`,
  `GospelPresenter/GospelPresenter.Shared/State/SlideTextStyle.cs:13-61`. Text roles per text slide
  type: `MainText`, `Credits`.
- Deliberately not themable (ADR): padding/safe area, positioning, gradients, letter spacing, text
  transform; overlays, the black screen and audio items are outside themes
  (`adr/0001-slide-themes.md` decisions 5–6).

### Built-in themes
(`GospelPresenter/GospelPresenter.Shared/Services/BuiltInThemes.cs:20-178`, names from resx)

| Slug (sort) | EN / SV name | Song main text | Bible main text | Credits | Backgrounds |
|---|---|---|---|---|---|
| `classic` (0) | Classic / Klassisk | Tahoma 75px **700**, 1.4, `#ffffff`, center | Tahoma 75px 400, 1.4, white, **left** | Tahoma 40px/1.2 `rgba(255,255,255,0.4)` left | all `#000000` |
| `midnight` (1) | Midnight / Midnatt | Inter 75px 600, white, center | Inter 75px 500, left | Inter 40/1.2 `rgba(255,255,255,0.45)` left | all `#0b1b3a` |
| `daylight` (2) | Daylight / Dagsljus | Lato 75px 400, `#141210`, center | Lato 400, `#141210`, left | Lato 40/1.2 `rgba(20,18,16,0.55)` left | all `#faf7f2` |
| `aurora` (3) | Aurora / Norrsken | Montserrat 75px 500, white, center, shadow | Montserrat 400, left, shadow | Montserrat 40/1.2 `rgba(255,255,255,0.5)` left, shadow | Song+Bible: `#0d1024` + image `aurora/background` (hash `7bcf41fdc25328d2`), cover, scrim 45%; Media: `#0d1024` only |

Descriptions (EN): Classic "Bold white text on a black background, with an airy line. The look we
recommend."; Midnight "Deep blue instead of black, with a cleaner typeface. For a dark room.";
Daylight "Dark text on a light background, for LED walls and bright rooms."; Aurora "A soft background
image with a dimmed overlay that keeps the text readable." (SV in
`GospelPresenter/GospelPresenter.Shared/Resources/Localization/SharedResource.sv.resx`).

The Aurora art is a 1920×1080 WebP generated deterministically by
`scripts/generate-theme-backgrounds.py` (rendered at 1080×608, upscaled by `cwebp -q 88`), embedded in
the Shared assembly as `Themes/aurora/background.webp`.

### Media library items
- `OrganizationImage` / `OrganizationAudio`: `Id` (GUID), `FileName` (≤200), `ContentType`,
  `CreatedAt`, `DeletedAt` (null = in library, set = in trash), `ModifiedAt`, `OrganizationId`
  (`GospelPresenter/GospelPresenter.Shared/Models/OrganizationImage.cs:3-23`,
  `GospelPresenter/GospelPresenter.Shared/Models/OrganizationAudio.cs:3-23`). Bytes live in object
  storage, never in the database.
- Lifecycle: upload → library → trash (soft delete, restorable, still served) → purged after 30 days
  or by permanent delete/empty trash (bytes deleted). Trash UI belongs to the Trash area.
- Image variants: `full` (fits 1920×1080) and `thumb` (fits 400×225). Audio: one `file` object.

### Storage keys and URLs
(`GospelPresenter/GospelPresenter.Shared/Services/ImageUrlHelper.cs:15-96`)

| Thing | Object key | Authenticated URL | Live URL (anonymous, session-gated) | Public output URL |
|---|---|---|---|---|
| Org image | `org/{org}/images/{id}/{full\|thumb}` | `/api/images/org-image/{id}/{variant}` | `/api/live-images/{session}/org-image/{id}/{variant}` | `/api/watch/{code}/image/org-image/{id}/{variant}` |
| Overlay image | `org/{org}/overlays/{overlayId}/image` | `/api/images/overlay/{id}/image` | `/api/live-images/{session}/overlay/{id}/image` | `/api/watch/{code}/image/overlay/{id}/image` |
| Audio | `org/{org}/audios/{id}/file` | `/api/audio/org-audio/{id}` | — | — |
| Slide deck page | `org/{org}/slides/{slidesId}/page-{n}.webp` | `/api/images/slides/{slidesId}/{n}` | `/api/live-images/{session}/slides/{slidesId}/{n}` | `/api/watch/{code}/image/slides/{slidesId}/{n}` |
| Theme art | `themes/{slug}/{stem}-{variant}-{hash16}.webp` | `/api/theme-images/{slug}/{stem}-{variant}-{hash16}.webp` (anonymous) | same | same |

### Profile images and organisation logos
- Stored inline as `data:image/webp;base64,…` strings on `User.ProfileImage` (256×256) /
  `User.ProfileImageSmall` (64×64) and `Organization.LogoSmall` (64×64)
  (`GospelPresenter/GospelPresenter.Shared/Services/ProfileImageService.cs:12-47`). Screens belong to
  the Users/Profile area; only the image processing is specified here.

## Screens and flows

### `/admin/bibles` — Bibles (nav "Biblar")
- Access: policy `ManageBibles` (roles User, Admin, SuperAdmin)
  (`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Bibles.razor:1-2`,
  `GospelPresenter/GospelPresenter.Shared/Models/PermissionMap.cs:20-21`).
- Header "Biblar". Card "Importera bibel" with text "Importera en bibelöversättning som en
  `.zip`-fil (USX- eller USFM-format)." and button "Välj fil" (accept `.zip`, single file) plus hint
  "eller släpp zip-filen här" (hidden below `sm`). The whole page is a drop zone ("Släpp bibelns
  zip-fil här").
- While importing: button text "Importerar...", file input disabled, "Bearbetar bibelfil..." and an
  indeterminate progress bar. Afterwards an inline message (not a toast):
  - success new: "Importerade {namn} med {n} verser." (green)
  - success replace: "Uppdaterade {namn} med {n} verser." (green)
  - failure: "Importen misslyckades: {fel}" (red); on device, a non-zip pick → "Bara .zip-filer kan
    importeras" (`…/Bibles.razor:40-56, 210-324`).
- List card "Installerade biblar ({count})": one row per Bible: name, then
  `{abbreviation} · {verseCount} verser`, delete icon button. Order = cache order (unspecified).
  Empty state: book icon + "Inga biblar installerade ännu." No loading state (cache is synchronous).
- Delete → confirmation dialog "Är du säker på att du vill ta bort {namn}?" → deletes, toast
  "Bibel borttagen" (`…/Bibles.razor:127-133, 326-346`).
- Device apps only (when `IBibleOfflineStore` is registered), per row (`…/Bibles.razor:87-113`):
  - `NotAvailable`: button "Gör tillgänglig offline" → download; toast "Översättningen är tillgänglig
    offline" or "Nedladdningen misslyckades. Kontrollera uppkopplingen och försök igen."
  - `Downloaded`: button with green check "Tillgänglig offline" (tooltip "Ta bort den nedladdade
    kopian") → removes local verses; toast "Den nedladdade kopian togs bort".
  - `ImportedLocally`: static text "Tillgänglig offline".
  - Only one download/remove at a time (all buttons disabled while one runs).
  - *In the rewrite* the "device apps" are every device except a desktop host: the host serves the LAN, as
    the current web server, so it keeps every text and shows no button (only the state text). A device
    that keeps nothing between reloads shows no button and says why. A translation imported on a device
    is kept there (shown as the `Downloaded` button, removable), since D30 sends every import to the server.
- Web import posts the file to `/api/upload/import-bible`; device apps import in-process (no server
  needed) (`…/Bibles.razor:215-235, 300-324`).

### Add item → "Bibeltexter" tab (Bible part of the add-item modal; modal itself is Presentations area)
(`GospelPresenter/GospelPresenter.Shared/Components/Presentations/AddItem/Bible/BibleTextTab.razor`)
- No Bibles in org: book icon + "Inga biblar än".
- Search box (placeholder "Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)", max 100
  chars) and a translation `<select>` (first Bible preselected). Search runs on every keystroke (no
  debounce). Clear (×) button when non-empty.
- Results: list of "{Swedish book} {c}:{v} {text}"; shows at most **500**; when more,
  "Visar {500} av {total} verser". No match: "Inga verser hittades" + "Sök på bibelställe:" +
  "Joh 3:16 · Ps 23 · Rom 8:28-30".
- Empty query: book picker grouped "Gamla testamentet" / "Nya testamentet" (books named in UI language:
  Swedish if culture starts with `sv`, else English), canonical order; arrow-key roving focus.
- Picking a book enters browse mode: breadcrumb `Book | startChapter : startVerse — endChapter :
  endVerse` (each part clickable to re-edit, current part orange, prompts "Välj bok", "Välj
  startkapitel", "Välj startvers", "Välj slutkapitel", "Välj slutvers"). Flow: chapter grid → verse list
  → end verse (end chapter preset to start chapter; click the end-chapter crumb to change). Picking an
  end before the start swaps them (`…/BibleBrowsePicker.razor:192-223`). Back button returns to search.
- Add button appears when there are results or a complete browse selection: "Lägg till **{label}**".
  Label: `Book c:v`, `Book c:v1-v2`, or `Book c1:v1 - c2:v2`.
- Keyboard: `Ctrl/⌘+Enter` = add (closes unless "add more" is on); `Shift+Enter` = add and keep open,
  then clears search and browse state and refocuses the search box (`…/BibleTextTab.razor:164-182`).
  Search box autofocus is skipped on screens narrower than 768px.
- Changing translation re-runs the search and leaves browse mode.

### `/admin/themes` — Themes (nav "Teman")
(`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Themes.razor`)
- Access: policy `ManageThemes` (Admin, SuperAdmin). The nav link is shown to everyone
  (`GospelPresenter/GospelPresenter.Shared/Layout/AdminLayout.razor` "Nav.Themes").
- Title "Teman" + description "Ett tema styr hur en presentations slides ser ut. Välj det som
  församlingen använder som standard — presentationer som inte har valt eget tema följer det."
- Loading: "Laddar...". Then a 1-column (2 columns ≥640px) grid of cards, built-in themes first in
  sort order, then org themes by sort order and name.
- Each card: a real 1920×1080 song slide scaled to card width with text "Amazing grace\nhow sweet the
  sound" and credits "John Newton · 1779", using the theme's **Song** block; name; badge "Standard" on
  the current default; description; button "Använd som standard" on every non-default card.
- Set default: optimistic (badge moves immediately), buttons disabled while saving, toast "Standardtemat
  sparat"; on error rolls back with toast "Kunde inte spara standardtemat"
  (`…/Themes.razor:124-147`). No org default saved → `classic` is shown as default.
- No create/edit/delete/duplicate.

### Presentation details dialog — theme picker (dialog itself is Presentations area)
- Label "Tema"; options: "Följer församlingens standard" (value = null, preselected when the
  presentation has no own theme) + every theme by name
  (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/PresentationDetailsDialog.razor:28-41`).
- Hidden in the create flow (new presentations follow the default) (`…:66`).
- Saving with a changed theme persists it and pushes the newly resolved theme to everything live for
  that presentation (projectors, stage view, public output) at once
  (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/Sidebar.razor:499-514`,
  `GospelPresenter/GospelPresenter.Shared/Pages/Presentation.razor:1220-1230`).

### `/admin/images` — Images (nav "Bilder")
(`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Images.razor`)
- Access: policy `ManageOrganizationImages` (User, Admin, SuperAdmin).
- Header "Bilder", drop hint, button "Papperskorg" → `/trash?kind=Image` (always visible), button
  "Importera" (multi-select file input, accept `image/jpeg,image/png,image/webp,image/gif`). Whole page
  is a drop zone ("Släpp bilder här").
- During upload: "Importerar {i} av {n}..."; failures accumulate as "{n} bild(er) kunde inte
  importeras" (red, stays until next upload). Each success is inserted at the top immediately.
- Card "Alla bilder ({count})", search field (only when ≥1 image; max 100 chars; substring match on
  file name, case-insensitive, live on every keystroke; × to clear).
- States: loading "Laddar bilder..."; empty: icon + "Inga bilder än" + "Importera bilder för att visa
  under presentationer, t.ex. logotyper eller bakgrunder."; no search hit: "Inga bilder matchar din
  sökning"; content: responsive grid (2/3/4/5/6 columns) of thumbnails (max height 128px) with file
  name below, newest first.
- Each thumbnail has an always-visible "⋯" menu with "Ta bort" → moves to trash without confirmation,
  toast "{filnamn} flyttad till papperskorgen"; error → warning toast "Common.ErrorOccurred"
  (`…/Images.razor:308-326`).
- The list reloads when an organisation sync announcement arrives, keeping the search text
  (`RefreshOnSync`, `…/Images.razor:23, 183-198`).
- No preview step before upload; no rename; no detail view.

### `/admin/audios` — Audio (nav "Ljud")
Identical to Images except: policy `ManageOrganizationAudios`; accept
`audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,audio/x-m4a`; trash link `/trash?kind=Audio`;
list rows (speaker icon + file name + "⋯" menu) instead of a grid; strings "Ljud", "Alla ljudfiler",
"Laddar ljudfiler...", "Inga ljudfiler än", "Importera ljudfiler för att spela upp under
presentationer.", "Inga ljudfiler matchar din sökning", "{n} fil(er) kunde inte importeras"
(`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Audios.razor`). No playback/preview on this page.

### Device file picking (Electron / MAUI)
- "Importera" opens a native picker instead of a file input: title "Välj bilder" / "Välj ljudfiler",
  filter "Bilder" (jpg, jpeg, png, webp, gif) / "Ljudfiler" (mp3, wav, ogg, m4a, mp4, m4b, webm);
  multi-select except for overlay images. Electron presents the dialog on the first-created window (the
  operator window, never the projector)
  (`GospelPresenter/GospelPresenter.Desktop/Services/ElectronMediaUploader.cs:21-86`,
  `GospelPresenter/GospelPresenter/Services/MauiMediaUploader.cs:111-214`).
- Drops on the device apps are handed to .NET and ingested the same way
  (`GospelPresenter/GospelPresenter.Shared/Services/MediaIngestService.cs:118-122`).

### Profile picture / organisation logo crop (processing only)
- File must be JPEG/PNG/WebP/GIF ≤10 MB, else "Bildformatet stöds inte. Använd JPG, PNG, WebP eller
  GIF." / "Bilden är för stor (max 10 MB)" (org logo: "Bilden får vara max 10 MB."). A square cropper
  (drag, wheel/pinch zoom, slider; zoom range 0.5×–10× of fit) exports 512×512 WebP q0.85 on a white
  background (`GospelPresenter/GospelPresenter.Shared/wwwroot/utils.js:532-555`); the server
  center-crops to square and stores 256×256 + 64×64 WebP q80 data URIs (logo: 64×64 only).
- On external sign-in, if the user has no profile image and has not removed it, the provider's
  `picture` claim is downloaded and processed the same way
  (`GospelPresenter/GospelPresenter.Web/Program.cs:1111-1125`).

## Rules and invariants

### Bibles
- **BIBLE-R1** Import requires `ManageBibles` and access to the target organisation; server-enforced
  (`GospelPresenter/GospelPresenter.Shared/Services/BibleService.cs:102-103`). Note: role `User` has
  `ManageBibles` (`GospelPresenter/GospelPresenter.Shared/Models/PermissionMap.cs:20-21`).
- **BIBLE-R2** Upload endpoint `POST /api/upload/import-bible` (multipart: `file`, `organizationId`):
  401 if not signed in; 400 if no/empty file, missing org, file > **50 MiB** (52 428 800 bytes), or name
  not ending `.zip` (case-insensitive); 400 with the message on `InvalidOperationException` (e.g. no
  USX/USFM, max Bibles reached); returns `{ bibleName, verseCount, replaced }`
  (`GospelPresenter/GospelPresenter.Web/UploadEndpoints.cs:199-225`,
  `GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:64-66`).
- **BIBLE-R3** Zip parsing order (`…/BibleService.cs:231-373`):
  1. Root = directory of the first entry named `metadata.xml` (any depth, case-insensitive).
  2. Metadata: `{root}metadata.xml` (DBL): name = `identification/nameLocal` → `name` → "Unknown
     Bible"; abbreviation = `abbreviationLocal` → `abbreviation` → "UNKNOWN". Else first `copr.htm`
     anywhere: name = `<title>` trimmed, abbreviation = initials of words starting with an uppercase
     letter if ≥2 initials, else "UNKNOWN". Else "UNKNOWN"/"Unknown Bible".
  3. Books: USX if any entry starts with `{root}USX_1/` (else `{root}USX_2/`): every non-empty `*.usx`
     under it. Otherwise USFM: every non-empty `*.usfm` / `*.sfm` **anywhere** in the zip. Neither →
     error "No USX or USFM files found in the zip file."
- **BIBLE-R4** Abbreviation is truncated to 50 chars, name to 200 (`…/BibleService.cs:107-108`).
- **BIBLE-R5** Same abbreviation in the same org → **replace** (name, verses, count, `ModifiedAt`
  updated; Id kept) and the result says "Uppdaterade…"; otherwise insert. Max **10** Bibles per org,
  checked only on insert (`…/BibleService.cs:112-144`, `AppConstraints.cs:65`).
- **BIBLE-R6** Verse extraction (USX, `GospelPresenter/GospelPresenter.Shared/Services/UsxParser.cs`):
  book code from `<book code>`; content before the first `<chapter>` ignored; paragraphs with styles
  `ide, rem, h, toc1-3, mt, mt1, mt2, s, s1, s2, ms, ms1, ms2, mr, r, sp, cl, cd` skipped; `<note>`
  (footnotes/cross-refs) skipped; text inside any other element (e.g. `<char>`, nested) kept;
  text after a verse until the next `<verse>` — across paragraphs and poetry lines — joined with single
  spaces; newlines → spaces, each fragment trimmed; verse range `"5-6"` → verse 5. USFM equivalent:
  `\f`, `\x`, `\s`, `\h`, `\mt`, `\toc1-3`, `\ide`, `\rem`, `\r` skipped
  (`GospelPresenter/GospelPresenter.Shared/Services/UsfmParser.cs:39-71`). Tests:
  `GospelPresenter/GospelPresenter.UnitTests/Services/BibleConverterTests.cs`,
  `…/UsfmParserTests.cs`.
- **BIBLE-R7** Delete requires `ManageBibles` + org access; deletes by abbreviation; writes sync
  tombstones in the same transaction; no-op if absent (`…/BibleService.cs:159-193`). No usage check:
  presentations keep their frozen text.
- **BIBLE-R8** Bible content is per organisation: lookups are keyed by (org, abbreviation)
  (`…/BibleService.cs:223-229`); the offline verse download returns 404 for another org's Bible id
  (`GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:427-437`).
- **BIBLE-R9** Book list = distinct book codes of the translation in canonical order GEN…REV; unknown
  codes (e.g. deuterocanonicals) last; chapters ascending; verses ascending
  (`…/BibleService.cs:202-221`, `GospelPresenter/GospelPresenter.Shared/Services/BibleBookNames.cs:183-202`).
- **BIBLE-R10** Testament grouping: the 39 Protestant OT codes are "Gamla testamentet"; **everything
  else** is "Nya testamentet" (`…/BibleBookNames.cs:204-211, 253`).
- **BIBLE-R11 Verse reference syntax** (`GospelPresenter/GospelPresenter.Shared/Services/VerseSearch.cs:20-127`):
  1. Normalise: trim, collapse whitespace runs to one space, remove spaces around `:` and `-`.
  2. Reference form: `^(book)\s+(C)(:(V))?(-(N)(:(V2))?)?[-:]?$` (book = any text, greedy).
  3. Range semantics (inclusive, compared as (chapter, verse) tuples):

     | Query | Meaning |
     |---|---|
     | `B C` | whole chapter C (from verse 0) |
     | `B C:V` | single verse |
     | `B C:` | whole chapter (trailing colon ignored) |
     | `B C:V-` | verse V to end of chapter C |
     | `B C-` | whole chapter C |
     | `B C:V-N` with N ≥ V | verses V..N of chapter C |
     | `B C:V-N` with N < V | C:V through end of chapter N |
     | `B C-N` | chapters C..N complete |
     | `B C:V-N:V2` | C:V through N:V2 |

  4. Book-only form (no numbers after the book): `^[a-zA-ZåäöÅÄÖ0-9: ]+$` and the name must resolve
     (rule 5) → every verse of that book. Otherwise no results.
  5. Book resolution (`…/BibleBookNames.cs:261-285`), case-insensitive: exact alias → else the
     **longest** alias that starts with the input → else (reference form only) any verse whose book
     code starts with the input. Aliases are Swedish full names, abbreviations and ordinal variants
     (`1 mos`, `1:a mos`, `första mos`, `1 mosebok(en)`, `ps`, `joh`, `matteusevangeliet`, `apg`,
     `upp`/`upb`, …) plus a few Latin names (`genesis`, `exodus`, `leviticus`, `numeri`,
     `deuteronomium`) (`…/BibleBookNames.cs:11-151`).
  6. Results are returned in stored verse order; invalid input returns nothing (no error).
  Examples from tests (`GospelPresenter/GospelPresenter.UnitTests/Services/VerseSearchTests.cs`):
  `MAT 3` → 4 verses of ch. 3; `MAT 3:15`; `MAT 3:15-17` → 3; `MAT 3:15-4` → 3:15…4:3;
  `MAT 3-4` → 7; `MAT 3:16-4:2` → 4; `mat 3:15`, `matt 3:15`, `matteus 3:15`,
  `matteusevangeliet 3:15`, `MATT 3:15`; `GE 1:1` → Genesis (prefix); `1 mos 1:1`, `1:a mos 1:1`,
  `första mos 1:1`, `första moseboken 1:1`, `genesis 1:1`, `gen 1:1`; whitespace variants
  `MAT  3:15`, `MAT 3 :15`, `MAT 3: 15`, `MAT 3 : 15`, `  MAT   3:15  `, `MAT 3 : 15 - 17`;
  `""` → none; `MAT abc` → none; `MAT` → all 8 Matthew verses.
- **BIBLE-R12** Slide splitting (`GospelPresenter/GospelPresenter.Shared/Services/BibleTextService.cs:14-131`):
  - Words = verse text split on spaces; the first word of each verse carries the verse number.
  - Plain length per word = text length (+ digits of the verse number + 1 for the first word); one
    space between words counts as 1. Length is measured on **plain** text, never on HTML.
  - `slideCount = max(1, ceil(total / 250))`, `target = ceil(total / slideCount)`; words are added to
    the current slide until adding one would exceed `target` (and the slide is non-empty and it is not
    the last allowed slide) → slides are balanced, the last one takes any remainder.
  - Slide HTML: `<div class="text-left">` + words joined by spaces + `</div>`; verse start renders as
    `<sup class="opacity-40">{n}</sup>&nbsp;{word}`; all verse text HTML-encoded exactly once.
  - No verses → no slides. Empty verse text → verse number still rendered.
- **BIBLE-R13** Item title (`…/BibleTextService.cs:34-47`, Swedish names): same verse
  `Johannes 3:16`; same chapter `Johannes 3:16-18`; same book `Johannes 3:16-4:2`; across books
  `Johannes 21:25 - Apostlagärningarna 1:2`. (The add-button label uses a slightly different format,
  `Book 3:16 - 4:2` with spaces, `…/BibleTextTab.razor:233-244`.)
- **BIBLE-R14** The add-item tab adds at most the **500** verses displayed when a search matched more
  (`…/BibleTextTab.razor:107, 230, 266`).
- **BIBLE-R15** Offline Bibles (device apps): the sync pull carries metadata only (`Id, Name,
  Abbreviation, VerseCount, ModifiedAt`; requires `ViewBibles`) and leaves verses empty `[]`
  (`GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:258-264`). Download = `GET
  /api/sync/bibles/{id}` (requires `ViewBibles`, own org; gzip when `Accept-Encoding` contains gzip;
  404 unknown) (`GospelPresenter/GospelPresenter.Web/SyncEndpoints.cs:71-99`). Download records a pin and
  the downloaded `ModifiedAt`; after every sync, pinned Bibles whose `ModifiedAt` changed are re-downloaded
  once; download never changes the row's `ModifiedAt`; remove sets verses back to `[]` and drops the pin
  (`GospelPresenter/GospelPresenter.Client/Bibles/BibleOfflineService.cs:47-149`,
  `GospelPresenter/GospelPresenter.UnitTests/Client/BibleOfflineTests.cs`).
  *In the rewrite* the text is an immutable document named by its hash (`GET /api/bibles/{hash}`); the pin
  is a local table `kept_bibles` by translation id, so a re-import is fetched after the sync that brings the
  new hash and the old text is dropped. A translation not kept is fetched when the add-item tab needs it,
  held in that window only; offline the tab says it cannot be had. A desktop host keeps every text.
- **BIBLE-R16** Bibles are never pushed from devices: a Bible imported on a device stays local
  (`ImportedLocally`) (push request has no Bible collection,
  `GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:360-380`).
  *The rewrite does not keep this* (D30): an import always goes to the server the device belongs to,
  and an offline import is uploaded when the device is connected again.

### Themes
- **THEME-R1** Resolution for a presentation: its `ThemeId` if set → else org `DefaultThemeId` → else
  `classic`. A theme id that does not exist **or belongs to another org** resolves to `classic` (not
  the org default). If even `classic` is missing, a hard-coded copy of Classic is used
  (`GospelPresenter/GospelPresenter.Shared/Services/ThemeService.cs:57-162`,
  `GospelPresenter/GospelPresenter.UnitTests/Services/ThemeServiceTests.cs:65-123`).
- **THEME-R2** Outside a presentation (song history preview) the org default is used
  (`GospelPresenter/GospelPresenter.Shared/Pages/Admin/SongHistory.razor:134`).
- **THEME-R3** Listing themes requires `ViewThemes` (all roles) + org access; returns built-ins plus
  the org's own, ordered built-in first, then `SortOrder`, then `Name` (`…/ThemeService.cs:43-55`).
- **THEME-R4** Setting the org default requires `ManageThemes` (Admin, SuperAdmin) and a theme that is
  built-in or the org's own, else "Theme not found."; creating the setting counts toward max **50**
  settings per org (`…/ThemeService.cs:84-121`).
- **THEME-R5** Setting a presentation's theme requires `ManagePresentations` + `ViewThemes` + org
  access; non-null id must be usable by the org; `null` = follow default; stamps `UpdatedAt`/
  `ModifiedAt`; announces an org change (`GospelPresenter/GospelPresenter.Shared/Services/PresentationService.cs:1048-1073`).
  Sync push applies the same check and silently falls back to null with a warning
  (`GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:1507-1517`).
- **THEME-R6** Changing the org default is retroactive for all presentations without their own theme
  (`adr/0001-slide-themes.md` Consequences). Presentations created from a template copy the
  template's `ThemeId` (`…/PresentationService.cs:854, 928`).
- **THEME-R7** Built-in themes are upserted on every deploy/start by slug; an existing built-in row is
  overwritten with the code definition and sort order; rows for slugs no longer shipped are kept;
  org themes untouched (`GospelPresenter/GospelPresenter.Shared/Services/BuiltInThemeSeeder.cs:18-45`,
  `GospelPresenter/GospelPresenter.UnitTests/Services/BuiltInThemeSeederTests.cs`).
- **THEME-R8** Built-in invariants enforced by tests (`GospelPresenter/GospelPresenter.UnitTests/Services/BuiltInThemeTests.cs`):
  every main text uses 75px / 1.4; no theme's line box (size × line height) exceeds Classic's; a
  250-character Bible slide and a 7-line song part fit the canvas; ids unique; `classic` exists; every
  slug has `Theme.Name.{slug}` and `Theme.Description.{slug}` in both languages; each embedded asset's
  SHA-256 (first 16 hex, lower case) equals its `ContentHash`.
- **THEME-R9** Rendering: the theme applies to the inner 1920×1080 canvas (so `cover` behaves the same
  in thumbnails and full screen); background CSS = colour, plus — if an image — optional scrim layer
  `linear-gradient(rgba(0,0,0,s), rgba(0,0,0,s))` over `url(...)`, `background-size: cover|contain`,
  centered, no repeat; the URL is escaped for quotes/backslashes
  (`GospelPresenter/GospelPresenter.Shared/State/SlideTheme.cs:94-114`). A slide with no theme renders
  Classic, never unstyled.
- **THEME-R10** Public output (responsive phone view) uses font-size
  `clamp(18px, min(size/1920·100·1.6 vw, size/1080·100 vh), size px)`; credits minimum 11px; overlays
  ignore the theme (fixed 40px style)
  (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/PublicSlideView.razor:88-116`).
- **THEME-R11** Real time: changing a presentation's theme in the details dialog updates live outputs
  immediately (THEME flow above). Changing the **org default does not** push to running sessions
  (`NotifyPresentationThemeChanged` is only called from `Sidebar.razor:513`).
- **THEME-R12** Theme art endpoint `GET /api/theme-images/{slug}/{fileName}`: anonymous (also in
  mock-auth mode); asset path = `{slug}/{fileName up to first '-' without extension}`; slug containing
  `/` or `.` or fileName containing `/` → 404; unknown asset → 404; variant = `thumb` if fileName contains
  `-thumb-`, else `full`; the **hash in the URL is ignored** (stale hash still serves current art);
  served from object storage key `themes/{asset}-{variant}-{currentHash}.webp`, else (missing or no
  storage) the embedded original; `Content-Type: image/webp`; `Cache-Control: public,
  max-age=31536000, immutable` (`GospelPresenter/GospelPresenter.Web/Program.cs:759-794`,
  `GospelPresenter/GospelPresenter.Shared/Services/ThemeAssetService.cs:52-60`,
  `GospelPresenter/GospelPresenter.IntegrationTests/Services/ThemeImageEndpointTests.cs`).
- **THEME-R13** Deploy-time upload of theme art: for each distinct built-in image, resize via the
  image pipeline (MEDIA-R4) into `full`/`thumb` and upload only if the key does not exist yet; failure
  is logged, not fatal (`GospelPresenter/GospelPresenter.Shared/Services/ThemeAssetUploader.cs:21-70`,
  `GospelPresenter/GospelPresenter.MigrationService/Program.cs:82-102`).
- **THEME-R14** Themes sync to devices (built-in + own org, requires `ViewThemes`), definition as JSON
  with enums as names (`GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:205-219`).

### Media
- **MEDIA-R1** Accepted image types (by MIME the client reports): `image/jpeg`, `image/png`,
  `image/webp`, `image/gif`; max **10 MiB** (10 485 760 bytes). Audio: `audio/mpeg`, `audio/wav`,
  `audio/ogg`, `audio/mp4`, `audio/webm`, `audio/x-m4a`; max **20 MiB**. File name ≤ **200** chars
  (`GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:23, 69-82, 101-102`).
- **MEDIA-R2** Validation runs three times: in the browser before posting (type/size → counted as a
  failure, no request) (`GospelPresenter/GospelPresenter.Shared/wwwroot/utils.js:9-48`), in the upload
  endpoint, and in the domain service (name length, count, audio size).
- **MEDIA-R3** `POST /api/upload/org-image` (multipart `file`, `organizationId`): 401 not signed in;
  400 no/empty file, missing org, "File too large", "Unsupported file type", "File name too long",
  "Invalid image file" (undecodable); 503 if object storage is not configured; returns
  `{ id, fileName, contentType, createdAt }` (`GospelPresenter/GospelPresenter.Web/UploadEndpoints.cs:15-54`).
  `POST /api/upload/org-audio` is the same with audio limits, no decoding check
  (`…/UploadEndpoints.cs:99-128`). Requires `ManageOrganizationImages`/`ManageOrganizationAudios` and
  own org (service), max **1 000** images / **500** audio files per org, trashed files not counted
  (`GospelPresenter/GospelPresenter.Shared/Services/OrganizationImageService.cs:89-97`,
  `GospelPresenter/GospelPresenter.Shared/Services/OrganizationAudioService.cs:63-73`).
- **MEDIA-R4** Image processing (`GospelPresenter/GospelPresenter.Shared/Services/ImageResizeService.cs:12-53`):
  - PNG, WebP, GIF → re-encoded as **WebP**; JPEG → **JPEG**. Stored `ContentType` is the output type.
  - `full`: fit within 1920×1080, quality 90; `thumb`: fit within 400×225, quality 80. Aspect kept;
    scale = min(maxW/w, maxH/h), rounded; never upscaled; Mitchell cubic resampling.
  - GIFs lose animation (first frame).
- **MEDIA-R5** Audio is stored byte-for-byte with the client-reported content type
  (`…/OrganizationAudioService.cs:82`).
- **MEDIA-R6** Upload writes bytes first, then the row; if the row save fails, the uploaded objects are
  deleted (`…/OrganizationImageService.cs:106-119`).
- **MEDIA-R7** Library listing: requires `View…` permission + own org; excludes trashed; newest
  (`CreatedAt`) first (`…/OrganizationImageService.cs:55-74`).
- **MEDIA-R8** Delete = soft delete (`DeletedAt = now`), no confirmation, bytes kept; a trashed file is
  still served by id so presentations using it keep working; restore may exceed the quota; purge after
  **30 days** (lazy, when the trash is opened), permanent delete and empty trash remove row + all
  objects under the prefix, objects deleted after the row (`…/OrganizationImageService.cs:124-226`,
  `GospelPresenter/GospelPresenter.UnitTests/Services/MediaTrashTests.cs`).
- **MEDIA-R9** Authenticated media endpoints `GET /api/images/{org-image|overlay}/{id}/{variant}`,
  `GET /api/images/slides/{slidesId}/{page}`, `GET /api/audio/org-audio/{id}`: org taken from the
  caller's claim; entity must exist in that org (trashed included) else 404; missing permission → 403;
  unknown type → error; `Cache-Control: public, max-age=31536000, immutable`; audio is buffered and
  supports HTTP Range (206) for iOS Safari (`GospelPresenter/GospelPresenter.Web/Program.cs:667-717,
  719-754, 853-890`).
- **MEDIA-R10** Live media `GET /api/live-images/{sessionId}/…` is anonymous but answers 404 unless that
  session's presentation is active; org from the session; `max-age=3600`
  (`GospelPresenter/GospelPresenter.Web/Program.cs:798-850`). Public output proxy `/api/watch/{code}/image/…`
  answers only while the output is broadcasting; `max-age=3600`
  (`GospelPresenter/GospelPresenter.Web/PublicOutputEndpoints.cs:133-180`). Live/public URLs never
  expose the authenticated URL; live URLs are rewritten to watch URLs for visitors
  (`…/ImageUrlHelper.cs:42-43`).
- **MEDIA-R11** Org isolation is by key: every key starts `org/{orgId}/`, built from the caller's or
  session's org, never from input (`…/Program.cs:820-822`).
- **MEDIA-R12** Overlay image upload `POST /api/upload/overlay-image/{overlayId}`: same image type/size/
  name checks, overlay must exist in the org, **no resize**, stored as sent at
  `org/{org}/overlays/{id}/image`, sets `HasImage = true` (`…/UploadEndpoints.cs:56-97`). (Overlays area.)
- **MEDIA-R13** Device ingest (`MediaIngestService`) applies the same type/size/name rules and resize;
  type is derived from the **extension** (`.jpg/.jpeg/.png/.webp/.gif/.mp3/.wav/.ogg/.m4a→audio/x-m4a,
  .mp4/.m4b→audio/mp4, .webm→audio/webm`); one failing file does not stop the batch; per-file
  callbacks mirror the web uploader (`GospelPresenter/GospelPresenter.Shared/Services/MediaIngestService.cs:41-176`).
- **MEDIA-R14** Device media store: blobs on disk under the same keys; locally created blobs are
  `PendingUpload` and never evicted until pushed; downloaded blobs are `Cached`; pinned = every image
  (`full`), audio and slide page referenced by any local presentation item, every overlay image, and every
  library thumbnail (trashed included); unpinned cached blobs evicted LRU above **2 GiB**; access time
  updated at most every 10 min (`GospelPresenter/GospelPresenter.Client/Media/MediaStore.cs:20-191`,
  `…/MediaPinService.cs:53-102`).
- **MEDIA-R15** Device blob upload `PUT /api/sync/media/{key}`: key must match
  `^org/{org}/(images|audios|overlays|slides)/{[A-Za-z0-9-]{1,64}}/{[A-Za-z0-9._-]{1,64}}$` with the
  caller's org, else 403; permission by kind (images → `ManageOrganizationImages`, audios →
  `ManageOrganizationAudios`, overlays → `ManageOverlays`, slides → `ManagePresentations`); body
  required and ≤ kind's limit (10/20/10/50 MiB) else 400; 503 without storage; 204 on success; refused
  blobs stay queued and retry next cycle (`GospelPresenter/GospelPresenter.Web/SyncEndpoints.cs:21,
  114-158`, `GospelPresenter/GospelPresenter.Client/Media/MediaSynchronizer.cs:24-61`).
- **MEDIA-R16** A missing blob on a device is fetched once from the authenticated server URL and cached;
  device deletes are local only (server deletes its own bytes when the metadata change arrives)
  (`GospelPresenter/GospelPresenter.Client/Media/LocalObjectStorageService.cs:18-45`).
- **MEDIA-R17** Profile/logo images: JPEG/PNG/WebP/GIF ≤10 MiB client-checked; stored as WebP data
  URIs 256×256 + 64×64 (q80), center-cropped square (`…/ProfileImageService.cs:12-47`).
- **MEDIA-R18** Object storage is optional: without `S3:Endpoint` all storage calls fail with
  "Object storage is not configured", surfaced as 503 by upload endpoints
  (`GospelPresenter/GospelPresenter.Shared/SharedServicesSetup.cs:68-77`,
  `GospelPresenter/GospelPresenter.Shared/Services/ObjectStorageService.cs:148-167`).

## Edge cases

- `John 3:16`, `Psalm 23`, `1 John 1` (the **English** placeholder/example strings) find nothing: there
  are no English aliases except a few Latin ones, and "john"/"psalm" are not prefixes of any alias or
  code (`…/BibleBookNames.cs:11-151`; resx `BibleTab.SearchPlaceholder`, `Bible.SearchExamples`).
- Ambiguous prefixes pick the longest alias: `jo 3` → Johannes (via "johannesevangeliet"), `ma 1` →
  Matteus, `mar 1` → Markus, `1 jo 1` → 1 Johannesbrevet (`…/BibleBookNames.cs:272-284`).
- `Matt 3:2-4` means verses 2–4 of chapter 3 (not through chapter 4); `Matt 3:20-4` means through
  chapter 4 (`…/VerseSearch.cs:100-116`).
- `Joh 3 16` (space instead of colon) finds nothing (book becomes "Joh 3").
- A book-only query (`Ps`) returns the whole book, but only the first 500 verses are shown **and
  added** (BIBLE-R14).
- Book codes outside the 66-book canon appear under "Nya testamentet" at the end, displayed by raw code.
- USX zips without a `USX_1/`/`USX_2/` folder (loose `.usx` files) fail with "No USX or USFM files found"
  unless they also contain USFM (`…/BibleService.cs:246-261, 363-373`).
- A corrupt zip / malformed XML throws a non-`InvalidOperationException` → 500 → web UI shows
  "Importen misslyckades: Upload failed" (`…/UploadEndpoints.cs:220-223`, `…/Bibles.razor:307-308`).
- Two translations without metadata both get abbreviation "UNKNOWN" → the second import **replaces**
  the first.
- Re-importing a translation does not change existing presentation slides (frozen parts).
- An empty verse produces a slide word with only the verse number.
- Bible import on the web through Kestrel is effectively limited by the default 30 000 000-byte request
  body limit (no override in `GospelPresenter/GospelPresenter.Web/Program.cs`), below the 50 MiB
  constant.
- Theme art endpoint serves the full-size embedded file for a `-thumb-` request when storage is missing
  (`…/Program.cs:786-793`).
- Admin Themes page previews only the Song block; Bible and Media looks are not previewed
  (`…/Themes.razor:39-46`), contrary to ADR 0001 (20).
- Classic Bible text is left-aligned twice: theme `Align = Left` and the frozen `<div class="text-left">`
  wrapper; for text stored before themes, alignment can never follow the theme
  (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/BibleTextSlide.razor:11-13`).
- Uploading the same image twice creates two library entries (no dedup).
- Web uploads skip files of the wrong type/size silently except for the failure counter; device pickers
  silently drop files with unknown extensions without counting them, while device drops count them as
  failures (`…/ElectronMediaUploader.cs:76-86` vs `…/MediaIngestService.cs:118-122`).
- A trashed image remains visible in presentations and on devices (pinned thumbnails include trash).
- Authenticated media responses are `public, immutable`: browsers keep showing purged images and shared
  caches may store org media.
- `MediaByteRange`: only single ranges; malformed/unsatisfiable → full body 200; `bytes=-N` suffix
  supported (`GospelPresenter/GospelPresenter.Client/Media/MediaRequestHandler.cs:58-103`).

## Acceptance scenarios

### Bibles
- **BIBLE-A1** Given an Admin on `/admin/bibles` with no Bibles, Then the page shows "Inga biblar
  installerade ännu." and "Installerade biblar (0)".
- **BIBLE-A2** Given a DBL zip with `metadata.xml` (`nameLocal` "Svenska Folkbibeln",
  `abbreviationLocal` "SFB") and `USX_1/*.usx`, When the user imports it, Then "Importerade Svenska
  Folkbibeln med {n} verser." appears and the list shows "Svenska Folkbibeln" / "SFB · {n} verser".
- **BIBLE-A3** Given SFB is installed, When the same zip with changed text is imported, Then the
  message reads "Uppdaterade …", the list still has one SFB row, and newly added passages use the new text.
- **BIBLE-A4** Given an eBible USFM zip with `copr.htm` titled "King James Version", When imported,
  Then the abbreviation is "KJV".
- **BIBLE-A5** When a `.txt` file is posted to `/api/upload/import-bible`, Then 400 "Only .zip files are
  supported"; a zip > 50 MiB → 400 "File too large"; a zip with no USX/USFM → 400 with "No USX or USFM
  files found in the zip file." and the UI shows "Importen misslyckades: …".
- **BIBLE-A6** Given 10 Bibles in the org, When an 11th with a new abbreviation is imported, Then it is
  rejected with "The maximum number of Bibles (10) has been reached."; re-importing an existing one
  still works.
- **BIBLE-A7** When the user deletes a Bible and confirms "Är du säker på att du vill ta bort {namn}?",
  Then toast "Bibel borttagen" and the row disappears; existing presentations with its text still show
  their slides.
- **BIBLE-A8** Given a user of org B, When requesting `/api/sync/bibles/{org A bible id}`, Then 404.
- **BIBLE-A9** In the add-item Bible tab, typing each test query of BIBLE-R11 shows the listed verse
  counts; typing `MAT abc` shows "Inga verser hittades" with the hint lines.
- **BIBLE-A10** Typing `Joh 3:16` and pressing Ctrl+Enter adds an item titled "Johannes 3:16" with one
  slide containing `<sup>16</sup>` and the verse, and closes the modal.
- **BIBLE-A11** Typing `Ps 23` then Shift+Enter adds "Psaltaren 23:1-6", keeps the modal open, clears the
  search box and focuses it.
- **BIBLE-A12** Browse: pick "Romarbrevet" → chapter 8 → verse 30 → verse 28; Then the selection is
  8:28–30 (swapped) and the button reads "Lägg till Romarbrevet 8:28-30".
- **BIBLE-A13** Adding a passage of ~600 plain characters produces 3 slides of roughly 200 characters
  each; no word is lost or duplicated; each verse number appears once.
- **BIBLE-A14** A verse containing `<script>` is rendered as text on the slide.
- **BIBLE-A15** Typing `Ps` shows "Visar 500 av {N} verser" and adding inserts 500 verses only
  (documents current behaviour; see Open questions).
- **BIBLE-A16** (Device) Given a synced Bible in state NotAvailable, When "Gör tillgänglig offline" is
  pressed while online, Then toast "Översättningen är tillgänglig offline", the button becomes
  "Tillgänglig offline", and search works with the network off. When pressed again, the copy is removed
  with toast "Den nedladdade kopian togs bort".
- **BIBLE-A17** (Device) Given a pinned Bible re-imported on the server, When the device syncs, Then the
  new verses are downloaded once and not again on the next sync.

### Themes
- **THEME-A1** Given an Admin on `/admin/themes` in Swedish, Then four cards appear in order Klassisk,
  Midnatt, Dagsljus, Norrsken, and Klassisk carries the "Standard" badge when nothing was chosen.
- **THEME-A2** When the admin clicks "Använd som standard" on Midnatt, Then the badge moves immediately,
  toast "Standardtemat sparat", and after reload Midnatt is still default.
- **THEME-A3** Given a presentation without its own theme, When the org default is Midnatt, Then its
  slides render on `#0b1b3a` with Inter; switching default to Dagsljus changes the same presentation to
  `#faf7f2` background with `#141210` text after reopening.
- **THEME-A4** Given a presentation live on a display, When the operator sets "Tema" = Norrsken in the
  details dialog and saves, Then the display, stage view and public output show the Aurora background
  image with 45% scrim and shadowed Montserrat text without changing slide.
- **THEME-A5** When "Följer församlingens standard" is chosen, Then the presentation's `ThemeId` is
  null and it follows later default changes.
- **THEME-A6** A User-role account opening `/admin/themes` is denied; the same user can still pick a
  theme in the details dialog of their presentation.
- **THEME-A7** Setting a presentation's or org's theme to another org's theme id via the API fails with
  "Theme not found."; a presentation whose theme was deleted renders as Classic.
- **THEME-A8** Anonymous `GET /api/theme-images/aurora/background-full-7bcf41fdc25328d2.webp` → 200
  `image/webp`, `Cache-Control` immutable, max-age 365 days; same with hash `0000000000000000` → 200;
  `/api/theme-images/nosuchtheme/background-full-abc.webp` → 404; `..%2f` traversal → 404/400.
- **THEME-A9** Classic: song text bold 75px Tahoma centered white on black; Bible text 75px regular
  left-aligned; credits 40px `rgba(255,255,255,0.4)` left.
- **THEME-A10** On a 390px-wide phone, the public output's main text is at least 18px and never larger
  than the theme size.

### Media
- **MEDIA-A1** Given an empty library, `/admin/images` shows "Inga bilder än" and the hint; no search
  field.
- **MEDIA-A2** When a 4000×3000 JPEG (3 MB) is imported, Then it appears first in the grid; `full` is
  1440×1080 JPEG, `thumb` 300×225 JPEG.
- **MEDIA-A3** A PNG with transparency is stored as WebP (`contentType` `image/webp`) in both variants.
- **MEDIA-A4** A 200×100 image is not upscaled (`full` and `thumb` stay 200×100).
- **MEDIA-A5** Importing a `.bmp`, an 11 MB JPEG and a valid PNG together shows "Importerar 3 av 3..."
  then "2 bild(er) kunde inte importeras", and only the PNG is added.
- **MEDIA-A6** A file named `x.jpg` containing text → 400 "Invalid image file".
- **MEDIA-A7** Typing "logo" in search shows only images whose file name contains "logo" (any case);
  "Inga bilder matchar din sökning" when none; × restores all.
- **MEDIA-A8** "Ta bort" on an image removes it from the grid with toast "{filnamn} flyttad till
  papperskorgen", no dialog; it appears under `/trash?kind=Image`; a presentation using it still shows it.
- **MEDIA-A9** Given 1 000 non-trashed images, a further upload fails; after trashing one, it succeeds.
- **MEDIA-A10** Audio: importing an `.mp3` (≤20 MB) adds a row; a 25 MB file fails; `GET
  /api/audio/org-audio/{id}` with `Range: bytes=0-99` → 206 with 100 bytes.
- **MEDIA-A11** A user of org B requesting `/api/images/org-image/{org A image}/full` → 404; an anonymous request is
  not served (401 or sign-in challenge).
- **MEDIA-A12** `/api/live-images/{session}/org-image/{id}/full` → 200 while the session presents, 404
  after the presentation stops.
- **MEDIA-A13** Without object storage configured, `POST /api/upload/org-image` → 503 and
  `PUT /api/sync/media/...` → 503.
- **MEDIA-A14** (Device) Importing an image offline shows it immediately; after reconnecting the blob is
  `PUT` to `/api/sync/media/org/{org}/images/{id}/full` and `/thumb` and other devices display it.
- **MEDIA-A15** `PUT /api/sync/media/org/{other org}/images/{id}/full` → 403; empty body → 400.
- **MEDIA-A16** Profile picture: choosing a 12 MB JPEG shows "Bilden är för stor (max 10 MB)"; a
  `.bmp` shows "Bildformatet stöds inte. Använd JPG, PNG, WebP eller GIF."; a valid image opens the
  cropper and saves a 256×256 avatar.

## Implementation artefacts

- **In-process Bible cache** (`BibleService` dictionary, startup load): needed because verses are one
  multi-MB JSON blob per translation. User need: instant search. Not valid with several server
  instances (an import on one node is invisible to the others). The rewrite should store verses
  queryably (rows or per-book chunks).
- **`VersesJson` blob + metadata-only sync + `/api/sync/bibles/{id}` gzip side channel**: exists because
  of the blob size. Need: device can use Bibles offline, opt-in per translation, kept fresh.
- **Bible "id" = abbreviation** in the UI/service API while the row has a separate GUID used only by sync.
  Pick one identity in the rewrite.
- **Frozen slide HTML** (`<div class="text-left">`, `<sup class="opacity-40">`) inside presentation
  parts. Need: stable slides once added. Prefer storing structured verses per part and rendering
  at display time.
- **Theme `Definition` JSON with value converter / ValueComparer, enums as names**: EF detail. Need:
  forward-compatible stored theme definitions.
- **ThemeService singleton cache of built-ins**, `SlideTheme.Fallback`: performance/robustness detail.
- **Embedded resource + Garage upload + content hash in URL** for theme art: delivery detail. Need:
  anonymous, cache-forever theme art that changes URL when the art changes.
- **`ImageUrlHelper.HostUrlTransform` / `gpmedia://` scheme handler / Electron media routes**: MAUI/
  WebKit specifics. Need: same media URLs work offline on devices.
- **`IMediaUploader` vs JS `uploadFiles`, `MediaUploadCallbacks`, `[JSInvokable]`**: Blazor interop.
  Need: one upload flow with per-file progress and failure count on every platform.
- **`NullObjectStorageService` throwing `NotSupportedException` → 503**: environment quirk.
- **`ImageDataMigrator`** (moves legacy `FullData/ThumbnailData` and overlay `ImageData` columns from
  Postgres to S3, 8 parallel uploads, runs before EF migrations) and **`GarageInitializer`** (creates
  Garage layout with 1 GiB capacity, imports the access key, creates bucket `gospelpresenter`, grants
  read/write/owner): one-off/infra; no user-facing requirement beyond "media survives upgrades".
- **Legacy `ImageService`/`State.Image` with a hard-coded `media/swish.jpg`**: dead code
  (`GospelPresenter/GospelPresenter.Shared/Services/ImageService.cs:10-25`).
- **`BibleConverter.ConvertUsxToJson`**: developer tool, not reachable from the UI.
- **`bibles/` directory mounted read-only at `/app/data/bibles`** in docker-compose and README step 3:
  no code reads it (`GospelPresenter/docker-compose.yml:92`). Bibles come only from in-app import.
- **`ModifiedAt`/tombstones on Bible delete and `ExecuteUpdate` replace + explicit change notifier**:
  sync plumbing. Need: other devices see imports/deletes.

## Open questions

1. English reference search: the English UI promises "John 3:16 or Psalm 23" but English book names
   do not resolve. Add English (and other language) aliases, ideally per translation's language?
2. The 500-verse cap silently truncates what is added (a book-only query such as `Ps` adds only the
   first 500 verses). Intended?
3. Bible slides are always titled with Swedish book names, and the translation is not stored on the item
   nor shown as credits, although themes define a Bible `Credits` role that is never filled. Should the
   translation abbreviation/name be recorded and shown?
4. Role `User` has `ManageBibles` (can import and delete organisation Bibles). Intended?
5. Translations without metadata collide on "UNKNOWN" and replace each other. Should import require or
   ask for a name/abbreviation?
6. Bible delete has no trash, unlike media; and on devices a delete creates a tombstone that is never
   pushed — what happens to the server copy and the device state?
7. Effective upload limit for Bible zips (and 50 MiB slide decks) is Kestrel's ~28.6 MiB default. Decide
   the real limits.
8. Should changing the org default theme update running live sessions in real time (currently only a
   per-presentation change does)?
9. `/admin/themes` link is visible to users without `ManageThemes`; ADR's Bible/Media previews are not
   implemented.
10. Theme art endpoint ignores the requested hash and falls back to the full-size original for thumbs.
    Keep "stale hash still served"?
11. Authenticated media served with `Cache-Control: public, immutable` — acceptable for congregation
    data behind auth, and for purged files?
12. GIF animation is lost; overlay images are not resized/re-encoded at all; audio is not validated
    beyond the client-reported MIME. Intended?
13. CLAUDE.md requires "always show a preview before upload" for images; the media library uploads
    immediately. Requirement or not?
14. Unhandled exceptions in `org-image`/`org-audio` endpoints (quota reached, permission denied) return
    500 rather than a 4xx with a message; the UI just counts a failure. Specify error responses.
15. Device picker drops unknown-extension files silently; MAUI on Windows lists `.aac` in the picker
    but `.aac` has no MIME mapping and is rejected.
16. `bibles/` volume in docker-compose/README is unused — remove, or implement pre-installed Bibles?
