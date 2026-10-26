# Song library

## Overview

The song library is an organisation-wide collection of worship songs (lyrics split into labelled
parts, plus metadata such as artist, publisher, year and CCLI number). Members create songs by hand
or import ProPresenter 7 `.pro` files, edit the parts, define *arrangements* (the order parts are
sung in, with repeats) and can roll a song back to an earlier version. Songs are added to
presentations by reference, so a library edit changes every presentation that uses the song. Admins
can switch on CCLI collection: every song with a CCLI number that is shown live for 10 seconds is
logged once per day and presentation, and the CCLI report page lists those entries so they can be
reported to CCLI and ticked off.

Paths in citations are relative to `GospelPresenter/` (the solution folder) unless they start with
`adr/`.

## Concepts

**Song** (`GospelPresenter.Shared/Models/Song.cs:3`, state record `GospelPresenter.Shared/State/Song.cs:108`)
- `Id` (GUID string), `OrganizationId`. Every song belongs to exactly one organisation.
- `Name` (required in UI; max 200), `Author` (shown as "Artist"/"Upphovspersoner"; max 200),
  `Publisher` (max 200), `Year` (int, 0–9999), `Ccli` (string, max 20; free text, not validated as
  a number).
- `DeletedAt`: soft delete (trash). Trashed songs vanish from the library, search, pickers and
  presentation resolution.
- `Parts`: ordered list (by `SortOrder`, 0-based, contiguous after every server mutation).
- `Arrangements`: unordered list (no sort column; order is whatever the DB returns).
- Library list order: `Name`, culture-aware, case-insensitive (`GospelPresenter.Shared/Services/SongService.cs:1082-1084`).

**Song part** (`GospelPresenter.Shared/Models/SongPart.cs:3`)
- `Content`: plain text, max 5 000 chars, may contain newlines. **One part = one slide**; there is
  no automatic splitting of long text into several slides anywhere in this area (see Live area for
  rendering: `whitespace-pre-wrap`, label badge top-right, credits at the bottom).
- `LabelId` (nullable) → a **part label** of the same organisation. Display uses the label's text
  and colour.

**Part label** (`GospelPresenter.Shared/Models/DbSongPartLabel.cs:3`)
- `Text` (max 50, unique per organisation – DB unique index `(OrganizationId, Text)`),
  `Color` (hex `#rrggbb`, max 7 chars, default `#6b7280`), `SortOrder`.
- A new organisation is seeded with 25 default labels (Verse, Verse 1–6, Chorus, Chorus 1–4,
  Bridge, Bridge 1–3, PreChorus, Tag, Intro, Ending, Outro, Interlude, Vamp, Turnaround, Blank)
  with fixed colours (`GospelPresenter.Shared/Services/SongPartLabelService.cs:178-205`).
- Labels referenced by text (import, version restore) are auto-created when missing.

**Arrangement** (`GospelPresenter.Shared/Models/DbSongArrangement.cs:3`)
- `Name` (optional, max 100; blank stored as null), `PartIds`: ordered list of part ids; the same
  part may appear several times (e.g. chorus after each verse). Stored as JSON, max 5 000 chars.
- `Song.GetArrangedParts(arrangementId)`: null or unknown id → all parts in part order; otherwise
  the listed parts in arrangement order, silently skipping ids that no longer exist
  (`GospelPresenter.Shared/State/Song.cs:120-130`).
- Which arrangement is used when a song is shown: the presentation item's `ArrangementId`, else the
  song's first arrangement, else all parts (`GospelPresenter.Shared/Services/LiveSlideBuilder.cs:99-100`).

**Song version (history)** (`GospelPresenter.Shared/Models/SongVersion.cs:3`)
- Snapshot of `Name`, `Author` and the parts (id, label id, label text, label colour, content) —
  **not** publisher, year, CCLI or arrangements. `CreatedAt` UTC.
- Created by every server-side song mutation, with a 30-minute "session window" (see SONG-R20).

**CCLI report entry** (`GospelPresenter.Shared/Models/CcliReportEntry.cs:3`)
- Organisation, `SongId`, snapshot `SongName` and `CcliNumber`, `PresentationId` (nullable),
  snapshot `PresentationName`, `Date` (DateOnly), `Reported` flag + `ReportedAt`.
- Unique `(OrganizationId, SongId, Date, PresentationId)` (`GospelPresenter.Shared/Contexts/PresentationContext.cs:394`).
- Not tied to the song row: survives song deletion and renames.

**Organisation setting `CcliCollectionEnabled`**: `"true"` turns collection on; anything else
(including absent) is off (`GospelPresenter.Shared/Services/CcliReportService.cs:159-165`).

**Presentation song item** (cross-area, see Presentations area): stores `SourceId = song.Id`,
`Title = song.Name` (copied at add time) and optional `ArrangementId`. Slides are resolved from the
library at display time (`GospelPresenter.Shared/Services/LiveSlideBuilder.cs:175-191`,
`GospelPresenter.Shared/Pages/Presentation.razor:1333-1350`).

Lifecycle of a song: created (manual / import / sync push) → edited (each edit may add a history
version) → trashed (`DeletedAt` set) → restored, or purged permanently (manually, "empty trash", or
automatically after 30 days) → gone (parts, arrangements, versions cascade).

## Screens and flows

Permissions: roles `User` and `Admin` both have `ViewSongs` + `ManageSongs`; only `Admin` (and
SuperAdmin) has `ViewCcliReport`/`ManageCcliReport`/`ManageUsers`
(`GospelPresenter.Shared/Models/PermissionMap.cs:7-50`). All admin pages use the admin layout with
a left nav: Sånger, Biblar, Bilder, Ljud | Overlays, Mallar, **Etiketter** | Skärmar, Teman,
**CCLI-rapport** … (`GospelPresenter.Shared/Layout/AdminLayout.razor:27-95`). `/admin` redirects
(replace) to `/admin/songs` (`GospelPresenter.Shared/Pages/Admin/Admin.razor:1-14`). The admin entry
icon is shown only to users with `ManageSongs` (`GospelPresenter.Shared/Components/AdminMenu.razor:1`).

### Song library — `/admin/songs`
Policy `ManageSongs` (`GospelPresenter.Shared/Pages/Admin/Songs.razor:1-2`).

- Header "Sånger" with **Skapa** button (only when the displayed list is non-empty — see Open
  questions).
- Import card "Importera ProPresenter-sånger", text "Välj en eller flera `.pro`-filer att
  importera.", button "Välj filer..." (multi-select, `accept=".pro"`), hint "eller släpp
  .pro-filerna här" (hidden below `sm`). The whole page is a drop zone ("Släpp ProPresenter-filer
  här"), accepting `.pro`, max 25 MB per file on device apps.
  - While importing: button text "Importerar...", input disabled, progress text "Bearbetar
    filer..." (later "Sparar sånger..." after the duplicate question) and an indeterminate bar.
  - Result line (green), e.g. "3 nya, 1 ersatt, 2 överhoppade (fanns redan), 1 fil saknade
    sångtext." Singular/plural forms: `{0} ny/nya`, `{0} ersatt/ersatta`, `{0} överhoppad (fanns
    redan)/{0} överhoppade (fanns redan)`, `{0} fil saknade sångtext/{0} filer saknade sångtext`;
    nothing at all → "Inga sånger kunde importeras." Errors (red): "Inga .pro-filer att importera",
    "Fel vid import: {message}".
  - Duplicate dialog "Dubbletter hittades": "{n} av {m} sånger finns redan:" + scrollable list of
    names; buttons **Avbryt** (abort whole import, nothing written), **Hoppa över dubbletter**
    (import only new), **Ersätt dubbletter** (import new and overwrite existing).
- Card "Alla sånger (N)" where N = total library count (not the filtered count), button
  **Papperskorg** → `/trash?kind=Song` (Trash area).
- Search box (only when library non-empty): placeholder "Sök", max 100 chars, filters on every
  keystroke (no debounce), clear (×) button when non-empty. Matching word prefixes are highlighted
  in name and author.
- List rows: name (bold, truncated) and author (or blank line); each row links to
  `/admin/songs/{id}`. Order: alphabetical when no query; relevance when searching.
- States: empty library → music-note icon, "Inga sånger i biblioteket ännu" + "Skapa en sång
  manuellt eller importera från ProPresenter (.pro-filer) ovan."; no search hits → "Inga sånger
  hittades".
- **Skapa** → name dialog "Skapa sång" (field "Namn", max 200, autofocus; Enter saves, Escape
  closes; button "Skapa"/"Skapar…" disabled while blank). On save: song created with that (trimmed)
  name and no parts, then navigate to `/admin/songs/{newId}`.
- Live refresh: when another user/device changes data in the organisation the list re-runs the
  current search (keeping the query) (`GospelPresenter.Shared/Pages/Admin/Songs.razor:18-20`).

### Song detail / editor — `/admin/songs/{SongId}`
Policy `ManageSongs` (`GospelPresenter.Shared/Pages/Admin/SongDetail.razor:1-2`). Unknown, trashed or
other-org id → redirect to `/admin/songs` (`SongDetail.razor:44-48`). Header: back arrow to
`/admin/songs`, title = song name (updates after save), transient "saved" indicator after each
save. Body = `SongEditor` (also used inside the add-item modal, see below):

1. **Fields card** (`GospelPresenter.Shared/Components/SongFieldsEditor.razor`): Namn, Upphovspersoner
   (artist), Förlag, År (number input min 0 max 9999), CCLI. Auto-save 500 ms after the last
   keystroke; values trimmed, blanks → null. Saving is skipped while Name is blank. Non-numeric year
   → null.
2. **Parts**: one card per part, in order. Each card: label dropdown (placeholder "Välj..."; first
   option "Välj..." clears the label; then all org labels as coloured pills in label order), move
   up / move down icon buttons (disabled at the ends), 8-row textarea (max 5 000), delete icon.
   Text and label edits auto-save 500 ms after the last change (all pending part edits in one
   call). Delete asks "Vill du ta bort {label}?" (label text, or "Välj..." if unlabelled) and is
   then immediate. Move is immediate. Button **Lägg till del** appends an empty, unlabelled part and
   scrolls to it.
3. **Arrangemang** section (`GospelPresenter.Shared/Components/SongArrangementEditor.razor`):
   - No arrangements → only **Skapa arrangemang**.
   - Each arrangement card: name field "Namn" (only shown when the song has ≥ 2 arrangements;
     auto-save 500 ms); a vertical list of part chips (label pill in label colour, or grey pill with
     the first line of the content cut to 20 chars + "..."); chips are drag-reorderable (saved on
     drop); each chip has × to remove that occurrence (no confirmation); "Lägg till del" dropdown
     lists every song part and appends the chosen one at the end; trash icon deletes the
     arrangement after "Vill du ta bort arrangemanget?".
   - **Skapa arrangemang** shown while fewer than 10 arrangements; creates an unnamed arrangement
     containing every part once, in current part order.
4. Footer: **Historik** button → `/admin/songs/{id}/history`; **Ta bort sång** (danger) → confirm
   "Vill du flytta {name} till papperskorgen? Sången raderas permanent efter 30 dagar." → soft
   delete → navigate to `/admin/songs`.

### Song history — `/admin/songs/{SongId}/history`
Policy `ManageSongs` (`GospelPresenter.Shared/Pages/Admin/SongHistory.razor:1-2`). Unknown song →
redirect to `/admin/songs`. Header "Historik", back to the song.
- Loading "Laddar..."; empty: clock icon + "Ingen historik finns för den här sången."
- Two columns (stacked on mobile): left, versions newest first, each showing the snapshot's name and
  time ("Idag HH:mm", "Igår HH:mm", else "d MMM yyyy HH:mm"); right, preview of the selected
  version (first selected by default): name, author, time, then each part rendered as a slide
  thumbnail (25 % of 1920×1080) using the organisation's default theme with label badge.
- **Återställ version** → dialog "Återställ version" / "Vill du återställa sången till versionen
  från **{time}**? Den nuvarande versionen sparas i historiken." → **Återställ** → restore and
  navigate back to the song editor.

### Labels — `/admin/labels`
Policy `ManageSongs` (`GospelPresenter.Shared/Pages/Admin/Labels.razor:1-2`).
- Title "Etiketter"; **Skapa** in header when at least one label exists.
- Loading "Laddar..."; empty: illustration, "Inga etiketter", "Skapa etiketter för sångdelar.
  Etiketter visas på presentationsbilderna tillsammans med en färg." and a **Skapa** button.
- Rows: coloured pill with the text, up/down buttons (disabled at ends), edit (pencil), delete.
- Create/edit dialog "Skapa etikett"/"Redigera etikett": field "Etiketttext" (max 50, autofocus),
  "Färg" swatch opening a native colour picker (default `#6b7280`), **Avbryt**, **Skapa**/**Spara**
  (disabled while text blank; tooltip "Ctrl+Enter"). Keys in the text field: Ctrl+Enter = save and
  close; Shift+Enter (create only) = create, clear the form, keep dialog open, refocus; Escape =
  close (`Labels.razor:217-234`).
- Delete: "Är du säker på att du vill ta bort etiketten {text}?" → parts using it become unlabelled.
- Refreshes when other users/devices change org data (`Labels.razor:16`).

### CCLI report — `/admin/ccli-report`
Policy `ViewCcliReport` (Admin+) (`GospelPresenter.Shared/Pages/Admin/CcliReport.razor:1-2`). The nav
link is shown to everyone in the admin layout (see Open questions).
- Title "CCLI-rapport"; toggle "Aktivera CCLI-datainsamling" with help text "Registrerar
  automatiskt vilka sånger med CCLI-nummer som visas under livepresentationer." Clicking the row or
  the switch flips it and saves immediately (optimistic, no feedback).
- Filter pills: **Alla** (default), **Orapporterade**, **Rapporterade**; switching reloads from the
  first page.
- Loading "Laddar..."; empty: "Inga CCLI-poster" / "När sånger med CCLI-nummer visas live kommer de
  att registreras här för rapportering."
- Content: one card per (date, presentation name), dates newest first, presentations A–Z within a
  date. Card header: presentation name (or "Övrigt" if empty), date `yyyy-MM-dd`, toggle
  "Rapporterad" (on only when all entries in the card are reported). Rows: CCLI number (own column
  ≥ `sm`, under the name on mobile) and song name.
- Toggling a card sets every entry in it to the opposite of "all reported" and stamps/clears
  `ReportedAt`. The entries stay on screen until the next load even if they no longer match the
  filter.
- Paging: 50 entries per page; **Visa fler** ("Laddar..." while loading) appends the next 50 while
  the previous page returned exactly 50.

### Song picker in "Add item" modal (cross-area: Presentations)
`GospelPresenter.Shared/Components/Presentations/AddItem/Song/SongTab.razor`. Shown to anyone who can
edit a presentation.
- Empty library: icon, "Inga sånger i biblioteket ännu", **Hantera sånger** (→ `/admin/songs`, only
  with `ManageSongs`), **Skapa**.
- Search "Sök på titel, författare eller textrad" (max 100, live on every keystroke, × clears);
  search box autofocus except on screens < 768 px. Typing selects the first hit. Virtualised list
  (name + author, highlighted). Right half (≥ md): preview of the selected song with name/author,
  pencil (edit), arrangement pills when the song has ≥ 2 arrangements (unnamed ones read
  "Arrangemang"; first is preselected), and one slide per arranged part rendered in the target
  presentation's theme with matches highlighted. Nothing selected → "Ingen sång vald". No hits →
  "Inga sånger hittades" + **Skapa** (name dialog prefilled with the query).
- Footer: "Lägg till fler" checkbox and **Lägg till {name}**. Keyboard: ↑/↓ moves selection (and
  scrolls), Ctrl/Cmd+Enter adds (closes unless add-more), Shift+Enter adds and keeps the modal open.
  After an add with the modal staying open, the search box is cleared, selection reset, focus back
  to search (`GospelPresenter.UnitTests/Components/AddItemSearchResetTests.cs:51-89`).
- Mobile (< 768 px): tapping a song opens a full-screen preview with back, edit, arrangement pills,
  add-more checkbox and **Lägg till {name}**.
- Edit (pencil) or Create opens the same `SongEditor` inside the modal with a back button; returning
  refreshes the list keeping query and selection.
- Adding creates an item that references the song and the chosen arrangement; toast
  "\"{name}\" har lagts till".

### ProPresenter import (non-UI behaviour)
Web: browser posts all chosen files as one multipart request to `POST /api/upload/import-songs`
(fields `organizationId`, `replaceExisting`, files). Device apps (no upload endpoints) run the same
steps in-process. Flow: parse all files → if not replacing, compute duplicate names; if any, return
them and stop → user answers → second call with `replaceExisting` true/false
(`GospelPresenter.Web/UploadEndpoints.cs:227-268`, `GospelPresenter.Shared/Pages/Admin/Songs.razor:295-411`).

### MCP tools (cross-area: MCP)
`search_songs(query)`, `list_songs()`, `get_song(songId)` expose the same search/list/detail
(`GospelPresenter.Web/Mcp/SongTools.cs:14-57`); `add_song_to_presentation` lives in Presentation tools.

## Rules and invariants

Permissions and scoping
- **SONG-R1** Reading songs, labels, versions and search requires `ViewSongs` + access to the
  organisation; every write (create, edit, parts, arrangements, delete, restore, import, labels)
  requires `ManageSongs`. Enforced in the service layer. `GospelPresenter.Shared/Services/SongService.cs:60-61,123-124,306-307,401-402`; `GospelPresenter.Shared/Services/SongPartLabelService.cs:22-23,34-35`
- **SONG-R2** All song lookups are scoped by organisation id; a song id from another organisation
  behaves as "not found" (silent no-op for writes, null for reads). `SongService.cs:405-406,579-580,596`
- **SONG-R3** The admin pages `/admin`, `/admin/songs`, `/admin/songs/{id}`, `/admin/songs/{id}/history`
  and `/admin/labels` require `ManageSongs`; `/admin/ccli-report` requires `ViewCcliReport`.
  `GospelPresenter.Shared/Pages/Admin/Songs.razor:2`, `SongDetail.razor:2`, `SongHistory.razor:2`, `Labels.razor:2`, `CcliReport.razor:2`
- **SONG-R4** Marking CCLI entries reported requires `ManageCcliReport`; reading requires
  `ViewCcliReport`; toggling collection requires `ManageUsers` (organisation-settings permission).
  `GospelPresenter.Shared/Services/CcliReportService.cs:119,134`; `GospelPresenter.Shared/Services/OrganizationSettingService.cs:26`

Validation and limits (server-enforced; violation throws, nothing saved)
- **SONG-R5** Name ≤ 200, Author ≤ 200, Publisher ≤ 200, CCLI ≤ 20 chars, Year 0–9999 or empty.
  `SongService.cs:644-651`; `GospelPresenter.Shared/AppConstraints.cs:6-28`
- **SONG-R6** Part content ≤ 5 000 chars. `SongService.cs:431,457,485`
- **SONG-R7** Max 5 000 non-trashed songs per organisation (manual create and sync push throw; import
  silently counts extra songs as "skipped"). `SongService.cs:659-661,235-239`; `GospelPresenter.Shared/Sync/SyncService.cs:539-541`
- **SONG-R8** Max 50 parts per song (adding the 51st throws; import keeps the first 50; sync push
  with more throws). `SongService.cs:489-490,174`; `Sync/SyncService.cs:1462-1463`
- **SONG-R9** Max 10 arrangements per song; arrangement name ≤ 100. `SongService.cs:704,711-712`; `SongArrangementEditor.razor:108`
- **SONG-R10** Labels: text 1–50 chars (blank rejected), colour ≤ 7 chars, max 50 labels per
  organisation, text unique per organisation (exact, case-sensitive match; DB unique index).
  `SongPartLabelService.cs:37-52,76-95`; `PresentationContext.cs:335`
- **SONG-R11** Server does not require a non-empty song name; only the UI does (name dialog disables
  save while blank, editor skips saving a blank name). `SongService.cs:646`; `GospelPresenter.Shared/Components/SongEditor.razor:161`

Parts and arrangements
- **SONG-R12** Part order is persisted; after delete or move, `SortOrder` is renumbered 0..n-1.
  New parts go after the current maximum. `SongService.cs:495-501,529-530,564-565`
- **SONG-R13** Part edits/moves/deletes are addressed by index; out-of-range indices are ignored
  silently. `SongService.cs:437,470,521,555`
- **SONG-R14** Deleting a part removes its id from every arrangement of the song (first occurrence
  only — see Open questions). `SongService.cs:532-538`
- **SONG-R15** Creating/updating an arrangement drops any part id that is not a part of that song.
  `SongService.cs:714-715,748-749`
- **SONG-R16** Arrangement names are trimmed; blank → null (no name). `SongService.cs:722,754`
- **SONG-R17** A new arrangement from the UI contains all parts once, in part order.
  `SongArrangementEditor.razor:184-188`
- **SONG-R18** Arranged view: unknown arrangement id → all parts; ids of deleted parts skipped;
  duplicates allowed and rendered as repeated slides. `GospelPresenter.Shared/State/Song.cs:120-130`
- **SONG-R19** When showing a song item: item arrangement → else first arrangement → else all parts.
  `LiveSlideBuilder.cs:99-100`; picker default = first arrangement `GospelPresenter.Shared/Components/Presentations/AddItem/Song/SongTab.razor` (`GetEffectiveArrangementId`).

History
- **SONG-R20** Before every server mutation of an existing song (fields, part edit/add/delete/move,
  arrangement create/update/delete) a snapshot of the *pre-change* state is saved — unless the
  newest snapshot is younger than 30 minutes, in which case only that snapshot's `CreatedAt` is
  bumped to now. So one editing session produces one history entry holding the state from before the
  session. `SongService.cs:795-816`
- **SONG-R21** History keeps at most 50 versions per song; older ones are pruned when a new snapshot
  is added. `SongService.cs:827-835`; `AppConstraints.cs:38`
- **SONG-R22** Restoring a version always saves the current state as a new version first (ignoring
  the 30-minute window), then replaces Name, Author and all parts (new part ids) from the snapshot;
  labels referenced by text are looked up case-/normalisation-insensitively and auto-created if
  missing. Publisher, year, CCLI and arrangements are not touched. `SongService.cs:603-642`
- **SONG-R23** History lists newest first. `SongService.cs:582-586`
- **SONG-R24** A push from an offline device that conflicts with a newer server version is rejected
  (server wins) but its content is appended to the song's history so it can be restored.
  `Sync/SyncService.cs:571-580,1529-1556`

Delete and trash
- **SONG-R25** Deleting a song is a soft delete (`DeletedAt = now`); it disappears from library,
  search, pickers and editors immediately. It is not removed from presentations that use it.
  `SongService.cs:304-316`
- **SONG-R26** Trashed songs list newest-deleted first with "days remaining" =
  max(0, 30 − whole days since deletion). `SongService.cs:318-328,1110-1113`
- **SONG-R27** Restore (single or all) clears `DeletedAt` and puts the song back in the library;
  permanent delete only works on trashed songs and cascades parts, arrangements and versions;
  "empty trash" purges all trashed songs of the org. All require `ManageSongs`; the unified trash
  only lists/empties songs for callers with `ManageSongs`. `SongService.cs:330-397`; `GospelPresenter.Shared/Services/TrashService.cs:97-100,196-197`
- **SONG-R28** Songs trashed > 30 days ago are purged when the song cache loads (server/app start and
  after a sync that changed songs) — not when the trash is opened.
  `SongService.cs:70-77`; `TrashService.cs:161`
- **SONG-R29** Soft delete syncs as an ordinary row update; permanent delete writes one tombstone for
  the song (children cascade on clients). `GospelPresenter.UnitTests/Services/SyncTrackingCallSiteTests.cs:491-516`

Search
- **SONG-R30** Empty/whitespace query returns the whole library alphabetically.
  `SongService.cs:852-853`
- **SONG-R31** Query is lower-cased, NFC-normalised and split on spaces; **every** term must match as
  a *word prefix* (start of text or preceded by a non-letter/digit) somewhere in name, author or
  lyrics, else the song is excluded. Mid-word matches never count ("vighet" ≠ "evighet").
  `SongService.cs:859-930`; `GospelPresenter.Shared/Utils/TextUtils.cs:59-73`
- **SONG-R32** Matching is accent-insensitive as fallback ("hogst" finds "Högst", "kna" finds "knä").
  `SongService.cs:899-919`
- **SONG-R33** Ranking per term (first that applies): title word-prefix 10 (+5 if title starts with
  it) / accent-stripped 8 (+5); first part 3 / 2.5; any text (name+author+all parts) 1 / 0.5.
  Bonuses: exact title +100 (stripped +90); for multi-term queries the whole phrase as word prefix in
  title +50 (45), first part +25 (22), any text +10 (8). Sort by score descending; ties keep
  alphabetical order. `SongService.cs:880-956`
- **SONG-R34** Search length capped at 100 chars in the UI. `Songs.razor:92`

Import (ProPresenter 7)
- **SONG-R35** Only files whose name ends in `.pro` (case-insensitive) are considered; none →
  "Inga .pro-filer att importera" (device) / HTTP 400 "No .pro files" (web). `UploadEndpoints.cs:241-249`; `Songs.razor:288-303`
- **SONG-R36** Title = first non-placeholder of: the presentation name stored in the file, the file
  name without extension, the CCLI song title; else "Untitled". Placeholder =
  `^untitled([ _-]*\d+)?$` (case-insensitive) or blank. `GospelPresenter.Shared/Services/ProPresenterParser.cs:46-49,198`; `GospelPresenter.UnitTests/Services/ProPresenterTitleTests.cs:12-70`
- **SONG-R37** Author, publisher, CCLI number (if non-zero) come from the file's CCLI block; year is
  never imported. All text is trimmed and NFC-normalised. `ProPresenterParser.cs:38-44,110-114`
- **SONG-R38** Parts: for each cue group in file order, each of its slides (cues) with text becomes
  one part labelled with the group name; slide text is the first text element whose RTF converts to
  non-blank plain text (Windows-1252 escapes decoded, multiple blank lines collapsed to one newline).
  Slides without text and cues outside groups are dropped. `ProPresenterParser.cs:60-84,127-195`
- **SONG-R39** ProPresenter arrangements become song arrangements (group references expanded to all
  parts of that group; empty ones dropped; name kept). `ProPresenterParser.cs:88-103`
- **SONG-R40** A file with no slide text, or that cannot be parsed, is counted as "failed" and does
  not abort the batch. `SongService.cs:143-162`; `GospelPresenter.UnitTests/Services/SongImportNormalizationTests.cs:147-170`
- **SONG-R41** Over-long imported values are truncated to the limits (name 200, author/publisher 200,
  CCLI 20, label 50, part content 5 000) instead of failing. `SongService.cs:164-175`
- **SONG-R42** Duplicates = existing non-trashed song with the same name, compared case-insensitively
  and Unicode-composition-insensitively. Skip → counted "skipped"; replace → existing song keeps id
  and name, gets the file's author/publisher/year(null)/CCLI, parts and arrangements fully replaced.
  `SongService.cs:106-119,185-232`; `SongImportNormalizationTests.cs:68-106`
- **SONG-R43** Part labels from imported files are matched to existing labels case-/normalisation-
  insensitively; missing ones are created appended to the label order with a colour derived from the
  text: contains PRE-CHORUS/PRE CHORUS `#db2777`; CHORUS/REFRÄNG/REFRANG `#e85d04`; VERSE/VERS
  `#0284c7`; BRIDGE/BRYGGA `#7c3aed`; TAG/OUTRO/ENDING `#059669`; INTRO `#ca8a04`; else `#6b7280`.
  The same rule applies to manual creation with label texts and version restore.
  `SongService.cs:1017-1064`; `SongImportNormalizationTests.cs:108-133`
- **SONG-R44** The import is written in one transaction (all or nothing for the DB writes).
  `SongService.cs:289-295`

Labels
- **SONG-R45** Labels list in `SortOrder`; new ones appended; delete renumbers the rest 0..n-1; move
  is index-based and checks that the label at `fromIndex` is the one named, else no-op.
  `SongPartLabelService.cs:20-29,54-56,116-124,128-152`
- **SONG-R46** Deleting a label sets `LabelId = null` on all parts using it (FK SET NULL).
  `PresentationContext.cs:328`
- **SONG-R47** New organisations get the 25 default labels; seeding is skipped if the org already has
  any label. `SongPartLabelService.cs:155-176`; `GospelPresenter.Shared/Services/UserService.cs:248,423`

CCLI
- **SONG-R48** A display is counted when a live session shows a slide of a song item whose song has
  a non-empty CCLI number, continuously for 10 s (any slide change restarts the 10 s; re-sending the
  identical slide does not). `GospelPresenter.Shared/State/SharedAppState.cs:105-127,459-497`
- **SONG-R49** Recorded only while the organisation's collection setting is `"true"` (default off).
  `CcliReportService.cs:31-32,77,159-165`
- **SONG-R50** At most one entry per (organisation, song, date, presentation); date is the UTC date on
  the server for live counts, and the client-supplied date for entries pushed by devices
  (`POST /api/sync/ccli-reports`, idempotent). `CcliReportService.cs:35-40,72-115`; `GospelPresenter.IntegrationTests/Services/SyncSideChannelIntegrationTests.cs:55-73`
- **SONG-R51** Sessions mirrored from a desktop device are not counted by the server (the device
  counts and syncs its own), so a song is never reported twice. `SharedAppState.cs:187-199,467-468`;
  `GospelPresenter.IntegrationTests/Live/LiveSessionHubIntegrationTests.cs:68`
- **SONG-R52** Entry lists sort by date desc, presentation name, song name; paged 50.
  `CcliReportService.cs:117-130`; `CcliReport.razor:114`
- **SONG-R53** Recording failures never affect the live presentation (errors logged and swallowed).
  `CcliReportService.cs:55-62`; `GospelPresenter.Web/Services/CcliReportBackgroundService.cs:23-35`

Propagation
- **SONG-R54** Presentations reference songs live: editing parts, labels-on-parts or arrangements
  changes what every presentation using the song shows. The item title stays as it was when added.
  `GospelPresenter.Shared/Pages/Presentation.razor:1760-1776`; `LiveSlideBuilder.cs:175-181`
- **SONG-R55** Slide credits line = `Author · © Publisher · Year` (missing pieces omitted; none →
  no credits). `LiveSlideBuilder.cs:194-206`
- **SONG-R56** Any song/part/arrangement change bumps the song's modification stamp so other
  devices pull it and conflicts are detected on the whole song. `SongService.cs:788-793`; `GospelPresenter/CLAUDE.md` ("Offline sync tracking")
- **SONG-R57** Library list and label list reload when another user or device changes organisation
  data; the open song editor does not. `Songs.razor:20`; `Labels.razor:16`

## Edge cases

- Import duplicate detection also covers duplicates *within one batch*: once a name has been added in
  this batch, a later file with the same name is skipped (or, with replace, overwrites the just-added
  song). `SongService.cs:185,283`
- A file that ProPresenter saved as "Untitled 2" is imported under its file name; "Böneämnen.pro"
  with decomposed (macOS) characters is stored NFC. `ProPresenterTitleTests.cs:12-104`; `SongImportNormalizationTests.cs:135-145`
- Songs stored in decomposed Unicode by older imports are still recognised as duplicates and their
  labels reused. `SongImportNormalizationTests.cs:68-133`
- Replace-on-import does not save a history version first; the old content is lost. `SongService.cs:185-231`
- Version restore creates new part ids, so every arrangement that referred to the old parts becomes
  empty (its ids are skipped). `SongService.cs:627-636`; `Song.cs:126-128`
- Restore of a version whose labels were deleted recreates those labels (with derived colours, not
  the snapshot colours). `SongService.cs:622-623,1036`
- The history list's "Idag/Igår" formatting uses the server's local time zone (Blazor Server).
  `SongHistory.razor:173-182`
- The delete-part confirmation names the part by label; unlabelled parts read "Vill du ta bort
  Välj...?". `SongPartsEditor.razor` (`GetCurrentLabel`)
- Arrangement name field is hidden when the song has exactly one arrangement, so a single
  arrangement can't be named in the UI (imported names stay). `SongArrangementEditor.razor:24`
- Removing a chip / appending a part / reordering are immediate saves with no undo or confirmation.
- Editing or deleting a label does not refresh the in-memory song cache: songs keep showing the old
  label text/colour until that song is edited again or the cache reloads (restart or sync).
  `SongPartLabelService.cs:71-125` (no cache call) vs `SongService.cs:975-990`
- The label dropdown in the editor is loaded once when the editor opens; labels created meanwhile
  appear only after reopening. `SongEditor.razor:82-108`
- Label uniqueness check compares untrimmed input with stored trimmed text, and is case-sensitive:
  "chorus" and "Chorus" can coexist, while import treats them as the same label. `SongPartLabelService.cs:49-52`; `SongService.cs:1026`
- Duplicate label name or label count limit: the service throws; the Labels page has no error
  handling around these calls.
- A trashed song still referenced by a presentation: library lookup fails, the fallback rebuilds a
  song from the item's own saved parts (legacy data); items added by the UI have none, so the item
  shows no slides. `LiveSlideBuilder.cs:175-191`
- Search ties keep alphabetical order (stable sort over the alphabetically built index).
- Duplicate dialog on the web shows "{n} av 0 sånger" because the endpoint does not return the file
  count. `UploadEndpoints.cs:259-261` vs `Songs.razor:358`
- The CCLI report groups by presentation *name*; two presentations with the same name on the same
  day are merged into one card and toggled together. `CcliReport.razor:122-128`
- Paging can split one (date, presentation) group across two pages; the toggle then only covers the
  loaded entries.
- After toggling "Rapporterad" under the "Orapporterade" filter, the entries remain visible until the
  filter is changed/reloaded.
- The CCLI number and song name are captured at the moment of display; later edits do not update
  existing entries. `CcliReportService.cs:42-51`
- Two editors of the same song (web): part edits are index-based and the editor does not refresh, so
  the later save can overwrite a moved/deleted part's neighbour.

## Acceptance scenarios

- **SONG-A1** Given an organisation member with role User on `/admin/songs` with an existing song
  list, when they click Skapa, type "Härlig är jorden" and press Enter, then they land on
  `/admin/songs/{id}` with the name filled in, no parts, and the song appears in the library list.
- **SONG-A2** Given the name dialog is open, when the name field is blank or whitespace, then the
  Skapa button is disabled and Enter does nothing.
- **SONG-A3** Given a song in the editor, when the user types in Upphovspersoner, Förlag, År and
  CCLI and waits 1 s, then reloading the page shows the trimmed values; clearing a field stores it as
  empty.
- **SONG-A4** Given a song, when the user sets År to 10000 (via API), then the server rejects it and
  nothing changes; 0 and 9999 are accepted.
- **SONG-A5** Given a song with 2 parts, when the user clicks Lägg till del, then a third empty
  unlabelled part appears at the bottom and is scrolled into view; after typing text and choosing
  label "Chorus" and reloading, both are persisted.
- **SONG-A6** Given parts A, B, C, when the user moves C up, then order is A, C, B after reload; the
  up button on the first part and the down button on the last are disabled.
- **SONG-A7** Given a song with 50 parts, when Lägg till del is clicked, then no part is added and
  an error is surfaced (server limit 50).
- **SONG-A8** Given parts A, B and an arrangement [A, B, A], when part A is deleted (after confirming
  "Vill du ta bort …?"), then the remaining arrangement contains only B-derived slides.
- **SONG-A9** Given a song with parts V1, C, V2 and no arrangement, when the user clicks Skapa
  arrangemang, then one arrangement with chips V1, C, V2 appears and no name field is shown.
- **SONG-A10** Given an arrangement, when the user appends "C" via Lägg till del twice and drags the
  last chip to the top, then after reload the chip order is persisted with C repeated.
- **SONG-A11** Given two arrangements, when the user types a name "Kort", then after 500 ms it is
  saved; whitespace-only name saves as unnamed and the picker shows it as "Arrangemang".
- **SONG-A12** Given 10 arrangements, then the Skapa arrangemang button is not shown.
- **SONG-A13** Given a song edited at 10:00 and again at 10:10, then the history shows one version
  (time ≈ 10:10) whose content is the state before 10:00; an edit at 10:45 adds a second version.
- **SONG-A14** Given a song with history, when the user opens Historik, then versions are newest
  first, the newest is preselected and previewed as slides; when they restore an older version and
  confirm, then they return to the editor showing that version's name, author and parts, and the
  history now contains the pre-restore state as the newest entry.
- **SONG-A15** Given a song never edited after creation, then Historik shows "Ingen historik finns
  för den här sången."
- **SONG-A16** Given a song, when the user clicks Ta bort sång and confirms, then they are sent to
  `/admin/songs`, the song is gone from the list and search, opening its URL redirects to the list,
  and it appears in `/trash?kind=Song` with 30 days remaining.
- **SONG-A17** Given a trashed song used in a presentation, when it is restored from the trash, then
  it is back in the library and the presentation shows its slides again.
- **SONG-A18** Given a song trashed 31 days ago, when the server restarts, then the song (and its
  parts, arrangements, history) no longer exists.
- **SONG-A19** Given songs "Majestät", "Högst av allt", "Det är saligt", "Vi vill se Gud", when the
  user searches "hogst av allt", then "Högst av allt" is first; "vighet" finds nothing; "evig" finds
  a song with "evighet"; "kna" finds "Majestät" via lyrics "knä"; "vi vill se" ranks "Vi vill se Gud"
  first; "gud xyz" returns nothing.
- **SONG-A20** Given a search with hits, then the count in "Alla sånger (N)" still shows the total
  library size, matching words are highlighted, and × resets the list to all songs alphabetically.
- **SONG-A21** Given a `.pro` file whose internal name is "Untitled" saved as "Böneämnen.pro", when
  imported, then a song "Böneämnen" exists with one part per slide, labelled with the group names,
  and the result reads "1 ny."
- **SONG-A22** Given an existing song "Amazing Grace", when importing "amazing grace.pro" plus one new
  file, then the dialog "Dubbletter hittades" lists the duplicate; Avbryt writes nothing; Hoppa över
  dubbletter yields "1 ny, 1 överhoppad (fanns redan)."; Ersätt dubbletter yields "1 ny, 1 ersatt."
  and the existing song keeps its id and name but has the file's parts.
- **SONG-A23** Given a batch with one valid file and one corrupt/media-only `.pro`, then the valid
  song is imported and the result includes "1 fil saknade sångtext".
- **SONG-A24** Given a selection containing only `.txt` files, then the import reports "Inga
  .pro-filer att importera" (device) / is rejected (web).
- **SONG-A25** Given an imported file with group "Refräng" and no such label, then a label "Refräng"
  with colour `#e85d04` is created at the end of the label list; a group "chorus" reuses an existing
  "Chorus" label.
- **SONG-A26** Given a ProPresenter arrangement [Verse, Chorus, Verse, Chorus], then the imported song
  has one arrangement whose chips repeat the parts in that order.
- **SONG-A27** Given `/admin/labels` for a new organisation, then 25 default labels are listed in
  order Verse … Blank.
- **SONG-A28** Given the label dialog, when the user types "Coda" and presses Shift+Enter, then the
  label is created, the dialog stays open with an empty field focused; Ctrl+Enter creates and closes;
  Escape closes without saving.
- **SONG-A29** Given label "Chorus" exists, when creating another "Chorus", then it is rejected.
- **SONG-A30** Given a part labelled "Bridge", when the label is deleted on `/admin/labels`, then the
  part shows "Välj..." (after the song reloads).
- **SONG-A31** Given labels A, B, C, when B is moved up, then the order is B, A, C after reload and
  the editor dropdown lists them in that order.
- **SONG-A32** Given a user with role User, then `/admin/ccli-report` is forbidden and the service
  rejects reading entries.
- **SONG-A33** Given CCLI collection is off, when a song with CCLI number is shown live for 15 s, then
  no entry is recorded.
- **SONG-A34** Given collection on, when a song with CCLI "12345" is shown live in presentation
  "Gudstjänst" for 10 s, then one entry (song, 12345, Gudstjänst, today) appears; showing it again the
  same day in the same presentation adds nothing; showing it in another presentation adds a second
  entry.
- **SONG-A35** Given collection on, when the operator leaves a song slide after 5 s, then nothing is
  recorded; a song without CCLI number is never recorded.
- **SONG-A36** Given unreported entries for one date/presentation, when the admin toggles
  "Rapporterad" on the card, then all its entries are reported; under the Rapporterade filter after
  reload they appear, under Orapporterade they don't.
- **SONG-A37** Given 120 entries, then 50 are shown with Visa fler; two clicks load all 120 and the
  button disappears.
- **SONG-A38** Given an offline device recorded a display dated 2026-08-23, when it syncs twice, then
  the server has exactly one entry with that date.
- **SONG-A39** Given the add-item modal with "Lägg till fler" checked, when the user searches "maj",
  presses ↓ then Shift+Enter, then the selected song is added, the search box is empty and focused.
- **SONG-A40** Given a song with two arrangements, when the user picks the second arrangement in the
  picker and adds it, then the presentation shows that arrangement's slide order.
- **SONG-A41** Given a song added to a presentation, when a part's text is edited in the library, then
  the presentation's slide shows the new text without re-adding; the item title stays the old name
  after a rename.
- **SONG-A42** Given two browser sessions on `/admin/songs`, when one imports songs, then the other's
  list updates without reload while keeping its search query.

## Implementation artefacts

- **Singleton in-memory song cache** (`SongService.cacheByOrg`, copy-on-write, rebuilt from DB at
  startup/after sync). Exists because the Blazor Server process serves all circuits; search runs
  in-memory. User need: instant search-as-you-type over ≤ 5 000 songs. Its staleness bugs (labels)
  must not be carried over.
- **Index-based part API** (`partIndex`, `fromIndex/toIndex`) and the client-side pending-edit
  dictionary keyed by index — artefact of the Blazor editor. Use part ids in the rewrite.
- **500 ms debounced auto-save** via `Debouncer` (`GospelPresenter.Shared/Utils/Debouncer.cs:9`):
  need = edits are saved without a Save button; pending edits are dropped if the editor is disposed
  within 500 ms (`Debouncer.cs:48-54`), which the rewrite should avoid.
- **`ModifiedAt`/`TouchSong`, `Version`, tombstones, `SyncTombstone`** — EF/Postgres sync plumbing.
  Need: changes to any part of a song propagate as one unit to other devices and offline conflicts
  are detected per song (and the losing side is kept in history).
- **`PartsJson` / `PartIdsJson` JSON columns** — storage choice; need is an ordered list with repeats.
- **Two import routes** (`/api/upload/import-songs` multipart vs in-process on MAUI/Electron,
  `IAppCapabilities.UploadEndpoints`) and JS stream helpers — host plumbing. Need: pick or drop many
  `.pro` files, one duplicate question for the batch.
- **`CcliReportBackgroundService` (web) vs `CcliReportListener` (devices)** subscribing to
  `SharedAppState.CcliSongDisplayed`, and `SetCcliReportedElsewhere` for mirrored sessions — host
  plumbing. Need: each display counted exactly once, also offline.
- **`ccli-reports` side-channel endpoint**: CCLI entries are not a synced table on the server; devices
  push them separately. Need: offline displays reach the report with their real date.
- **SortableJS interop** (`initArrangementSortable`) for chip drag — any accessible DnD will do.
- **`RefreshOnSync` / `IRemoteChangeSignal`** — reload-on-remote-change seam; need is live lists.
- **`ProPresenterParser` protobuf classes and hand-written RTF stripper** — the need is the import
  semantics in SONG-R36…R43, not the implementation.
- **Server-local time zone in history** — Blazor Server artefact; rewrite should use the viewer's.

## Open questions

1. **Skapa button hidden on empty library / zero search hits** on `/admin/songs`
   (`Songs.razor:27`), although the empty state says "Skapa en sång manuellt …". Bug? (The picker in
   the add-item modal does offer Skapa in both states.)
2. Version snapshots exclude publisher, year, CCLI and arrangements; restoring breaks arrangements
   (new part ids). Should history cover the whole song?
3. Replace-on-import keeps the existing name (even if casing differs) and does not snapshot history.
   Intended?
4. 30-day purge of songs only runs at cache load (startup/sync), unlike other kinds which purge when
   the trash is opened. Unify?
5. `DaysRemaining` hard-codes 30 instead of `TrashRetentionDays` (`SongService.cs:1112`).
6. Pruning: `.Skip(50)` runs before the new snapshot is saved, so a song can hold 51 versions.
7. Deleting a part removes only its *first* occurrence from an arrangement (`List.Remove`); later
   occurrences remain as dangling ids (harmless at render). Should all be removed?
8. Arrangement order has no sort column — which arrangement is "first" (the default) is
   DB-order-dependent. Add explicit ordering?
9. Label text uniqueness is case-sensitive on the server but import/restore match labels
   case-insensitively. Pick one.
10. Labels page, song create (limit 5 000), editor saves (e.g. year out of range) and CCLI toggles have
    no error handling — failures are silent or break the circuit. Spec should require Swedish error
    toasts.
11. CCLI collection toggle requires `ManageUsers` while the page requires `ViewCcliReport`; the nav
    link to the CCLI report is visible to Users who cannot open it.
12. CCLI dates: server uses UTC date; a service after 00:00 UTC in Sweden is attributed to the next
    day. Use the organisation's time zone?
13. CCLI report groups by presentation name, not id (merging same-named presentations).
14. Duplicate dialog on the web shows "av 0" files (endpoint omits `FileCount`).
15. No web-side file size limit for `.pro` import (device apps: 25 MB per file).
16. Concurrent editing of one song by two people is last-write-wins at part-index granularity and the
    editor never refreshes; real-time co-editing or conflict warnings needed?
17. Server allows an empty song name (only UI prevents it). Should the server reject blank names?
18. Trashing a song leaves presentation items pointing at it with no slides and no warning. Should
    the UI flag "song in trash" in presentations?
19. Search has no debounce despite the project rule "filter in real time with debounce"; fine
    in-memory, decide for the rewrite.
