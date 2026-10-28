# Presentations (planning and editing a service)

Path legend for citations (all relative to the repo root):
`S/` = `GospelPresenter/GospelPresenter.Shared/`, `W/` = `GospelPresenter/GospelPresenter.Web/`,
`UT/` = `GospelPresenter/GospelPresenter.UnitTests/`, `IT/` = `GospelPresenter/GospelPresenter.IntegrationTests/`,
`RESX` = `S/Resources/Localization/SharedResource(.sv).resx`.

## Overview

A *presentation* is the running order of one service or meeting: an ordered list of items (songs,
Bible passages, images, audio files, imported PDF/PowerPoint slide decks), plus event metadata
(date, time, place, description, theme). Users land on a dashboard listing the organisation's
presentations (today, upcoming, everything else), create new ones blank or from a *template*, and
edit them in a two-pane editor (running order on the left, slide grid of the selected item on the
right). Templates are presentations flagged as reusable starting points with a weekly slot.
*Overlays* are an organisation-wide library of text/image layers that can be shown on top of the
live slide. Deleted presentations, templates (and songs, images, audio) go to a shared 30-day
*Trash*. Starting/running the presentation on screens is the "Live presentation and displays"
area; this spec stops at the "Start presentation" button and at "clicking a slide tile".

## Concepts

### Presentation (aggregate root) — `S/Models/Presentation.cs`
| Field | Behaviour |
|---|---|
| `Id` | GUID string, assigned on create. |
| `Name` | Required in UI (trimmed, non-blank); max 200 chars (server). |
| `IsTemplate` | `false` = presentation, `true` = template. Same table, separate lists, separate permissions. |
| `EventDate` (date), `EventTime` (time), `EventLocation` (≤100), `Description` (≤5000) | Presentation event metadata. All optional. For templates, `EventLocation` holds the template's location. |
| `ScheduledDayOfWeek` (0=Sunday…6=Saturday, .NET `DayOfWeek`), `ScheduledTime` | Template weekly slot. Optional. |
| `ThemeId` | `null` = follows the organisation's default theme; otherwise an explicit theme (built-in or the org's own). |
| `CreatedAt/By`, `UpdatedAt/By` | `UpdatedAt` = user-visible "last changed"; bumped by every edit including child edits. Drives list ordering. `UpdatedBy` is only set at creation (never updated afterwards). |
| `DeletedAt` | Non-null = in the trash (soft delete). |
| `LastUsedAt`, `UseCount` | Templates only: stamped/incremented each time a presentation is created from it. |
| `Items` | Ordered by `SortOrder`. |
| `SlideDecks` | `PresentationSlides` rows owned by this presentation. |

### PresentationItem — `S/Models/PresentationItem.cs`
`Id`, `Type` ∈ {Song, BibleText, Image, Audio, Slides}, `Title` (≤200), `SortOrder`,
`SourceId`, `ArrangementId` (songs only), `Parts` (ordered by `SortOrder`). Meaning per type:

| Type | `SourceId` | Parts (`Content`) | Snapshot or reference |
|---|---|---|---|
| Song | Song id in the song library | none (legacy rows may carry lyric parts) | **Reference**: slides are rendered from the current song, in the arrangement `ArrangementId` (fallback: song's first arrangement, then parts as stored) — `S/State/PresentationEditorState.cs:249-259` |
| BibleText | none | one part per slide, HTML (`<sup class="opacity-40">N</sup>&nbsp;text`) | **Snapshot** of the verses at add time |
| Image | id of the first image | one part per image, content = organisation image id | Reference to org image library |
| Audio | id of the first audio | one part per file, content = `"{audioId}|{fileName}"` | Reference to org audio library |
| Slides | `PresentationSlides.Id` | one part per page, content = 0-based page index as string | Owned deck (files live in object storage) |

Default title on add: song name; Bible reference label (e.g. "Joh 3:16-18"); single image/audio →
file name; several → `"{n} bilder"` / `"{n} ljudfiler"` (localised word); slides → uploaded file name.

### PresentationItemPart — `S/Models/PresentationItemPart.cs`
`Id`, `Content` (≤5000 chars server-side when added via `AddItemPartsAsync`), `SortOrder`.

### PresentationSlides (imported deck) — `S/Models/PresentationSlides.cs`
`Id`, `FileName`, `PageCount`, `PresentationId`. Each page stored as WebP at
`org/{orgId}/slides/{slidesId}/page-{n}.webp` (`S/Services/ImageUrlHelper.cs:92-96`).

### OverlaySlide — `S/Models/OverlaySlide.cs`
Organisation-scoped: `Title` (≤200, required), `Content` (text ≤2000, optional), `HasImage` (image
stored at a fixed key per overlay), `SortOrder` (append order; no reorder UI).

### Template
A `Presentation` with `IsTemplate = true`. Has a weekly slot (day/time) and location instead of an
event date; has items like a presentation. Lifecycle: create (Admin → Templates or "Save as
template" from a presentation) → edit at `/templates/{id}` → used to create presentations → trash →
restore / purge.

### Trash entry — `S/Services/TrashService.cs:7-31`
Kinds: Presentation, Template, Song, Image, Audio. Fields shown: name, kind, detail (event date for
presentations; weekday + time + location for templates; author for songs), days remaining.

### Lifecycle of a presentation
create (blank or from template) → edit (items added/reordered/renamed/removed, details changed) →
optionally run live (other area) → "Delete" moves to trash (`DeletedAt` set, nothing else touched,
slide files kept) → restore (back in all lists) or purge (rows, items, parts, decks and slide files
removed for good; manually, by "Empty trash", or automatically after 30 days when someone opens the
trash).

## Screens and flows

### 1. Home / Dashboard — `/` (`S/Pages/Home.razor`, `S/Components/Dashboard.razor`)
- Unauthenticated: logo + sign-in (auth area). Authenticated: Dashboard.
- Header "Presentationer" with **Skapa** button (tooltip `Skapa (N)`) — only when there is at least
  one presentation (`Dashboard.razor:25-31`).
- **Live banners**: one emerald card per *remote-control-enabled* live session in this
  organisation, excluding the viewer's own session, sorted by presentation name
  (case-insensitive) then session id: "Visas just nu" + presentation name (or "Aktiv
  presentation") + **Ta kontroll** linking to `/presentations/{id}?remote=true&session={sessionId}`
  (`Dashboard.razor:34-56, 242-254`). Behaviour behind that link → "Live presentation and displays".
- States: loading → "Laddar..."; empty → SVG + "Inga presentationer ännu" + description + **Skapa**;
  content → three lists:
  1. **Idag** — presentations whose `EventDate == today`, ordered by `EventTime` (undated time
     last), then `UpdatedAt` desc. Row subtitle omits the date.
  2. **Kommande** — `EventDate > today`, ordered by date then time (no-time last). Uncapped.
  3. **Unlabelled list** — everything dated before today *or* undated, ordered by `UpdatedAt` desc,
     then `Id`; paged 20 at a time with **Visa fler** ("Laddar..." while loading). Server clamps
     page size to 1..200 (`S/Services/PresentationService.cs:159-200`).
  Each row: name; subtitle joins with " · ": date ("Idag"/"Imorgon"/"ddd d MMMM" — with year in the
  third list), time `HH:mm`, location; tooltip = full date. A red **Live** pill if *this browser
  session* is presenting it (`S/Components/Presentations/PresentationRow.razor`). Row links to
  `/presentations/{id}`.
  4. **Papperskorg** button → `/trash?kind=Presentation`, always shown in the content state for
     users with ManagePresentations (`Dashboard.razor:125-137`). (Not shown in the empty state.)
- **Create flow** (`Dashboard.razor:378-469`):
  - If the org has ≥1 template (10 most recent: `LastUsedAt` desc, then `UpdatedAt` desc), a picker
    dialog "Skapa presentation" shows **Tom presentation** and a "Mallar" list (name + "weekday
    HH:mm · location"). Otherwise skip straight to the details dialog.
  - Details dialog (`PresentationDetailsDialog`): name (focused; prefilled with template name or
    "Presentation"), date, time, location (placeholder "Plats"), description ("Beskrivning"). No
    theme picker on create. Prefill from template: date = next occurrence of the template's weekday
    (today if the weekday is today and the template time has not passed yet or has no time; else +7),
    time and location from template. **Skapa** disabled while name is blank or saving ("Skapar…").
    Enter in the name field saves; Escape closes.
  - Success → navigate to `/presentations/{newId}`.
- **Welcome modal** shown once per user on first dashboard load (onboarding; not re-triggered by sync).
- Real-time: list reloads on any organisation sync signal, keeping as many rows as are currently
  shown (`Dashboard.razor:282-298`); live banners refresh on session activation / remote-control
  changes in this org.
- Keyboard: `n` = new presentation; ↑/↓/Home/End move focus through one flat sequence
  Today→Upcoming→list (no wrap); Enter opens; Tab enters the list at a single stop (roving tabindex).

### 2. Presentation editor — `/presentations/{id}` and `/templates/{id}` (`S/Pages/Presentation.razor`)
Requires sign-in. Query params: `remote=true`, `session=…`, `stage=true` (all belong to the live
area). Template mode = route `/templates/{id}`: shows a sky banner "Du redigerar en mall", hides
Start, hides "Spara som mall", no overlays/displays loaded, remote/stage ignored.

Layout: left sidebar (running order), main area (header + slide grid), and when live a right live
panel (live area). On narrow screens the sidebar is a slide-in menu, opened automatically when a
presentation is loaded (`Presentation.razor:1037`), toggled by a menu button bottom-left.

**Load** (`Presentation.razor:1042-1105`): fetch presentation (or template) incl. items and parts;
resolve theme (own or org default); load overlays and saved displays (not for templates). If not
found / trashed / wrong org: sidebar shows "Presentationen hittades inte". Selection after load:
the item currently live in this session wins; otherwise the previously selected item (by id); else
nothing.

#### 2a. Sidebar (`S/Components/Presentations/Sidebar.razor`)
- Header: presentation name (2-line clamp) and a "⋯" options menu:
  - **Redigera detaljer** — presentation: details dialog with name, date, time, location,
    description and **Tema** select ("Följer församlingens standard" + all themes usable by the org,
    built-ins named from resources). Template: name, weekday select (ordered from the culture's
    first day of week; "Ingen dag vald"), time, location.
  - **Spara som mall** (presentations only, ManageTemplates only) → name dialog prefilled with the
    presentation name → toast "Sparad som mall".
  - **Markera** — toggles multi-select mode.
  - **Radera presentation** / **Radera mall** (red) — no confirmation; moves to trash, toast
    "{name} flyttad till papperskorgen", navigates to `/` (template: `/admin/templates`).
- Under the name: schedule line (presentation: short date + short time in UI culture; template:
  weekday + `HH:mm`) and location.
- Item list: icon by type (note, book, photo, speaker, stack), title, a pulsing red dot on the item
  currently live (only while showing a presentation slide, not black screen). Selected item is
  highlighted and gets a "⋯" menu with **Ta bort** (opens confirm dialog). Every row has a drag handle;
  drag-and-drop reorders (persisted immediately).
- Multi-select mode: checkboxes per row, Shift+click selects a range from the last toggled row,
  **Markera alla** toggles all/none, **Klar** exits. Bottom shows "Välj objekt att radera" or a red
  **Ta bort markerade (n)** → confirm dialog ("Vill du ta bort detta objekt?" / "Vill du ta bort {n}
  objekt?") → toast "Objekt borttaget" / "{n} objekt borttagna". Leaving the presentation resets the mode.
- Bottom (normal mode): sticky **Lägg till** button → Add modal.
- Selecting an item: closes the mobile menu, scrolls the slide grid to top.
- Keyboard in the list: ↑/↓/Home/End *select* (not just focus) the previous/next item (no wrap);
  ignored with modifier keys and in multi-select mode. (Rewrite: Alt+↑/↓ moves the selected item one
  place, the keyboard's way to do what the drag handle does; the current app has none.)

#### 2b. Header (`S/Components/Presentations/PresentationHeader.razor`)
- Selected item title; on desktop (≥lg) clicking it (or F2) turns it into an input: Enter or blur
  saves (trimmed; blank or unchanged = no-op), Escape cancels.
- Song selected: **Redigera** → modal "Redigera" with the full song editor (songs area) and an
  autosave "Sparad" indicator; closing re-reads the song and, if its name changed, renames the item
  to the new song name.
- Image item selected: **Redigera**/**Klar** toggles image-order edit mode (see 2c).
- Desktop: green **Starta presentation** button when not template, not remote, and this session is
  not already presenting (mobile: floating button bottom-right). Pressing it → live area.

#### 2c. Slide grid (`S/Components/Presentations/SlideGrid.razor`)
- Song → one tile per part of the effective arrangement (label + colour from song area).
- BibleText → one tile per stored part. Image / Slides → one tile per image/page.
- Audio → instead of the grid, a list of audio players (file name each).
- Tile scale: <768px wide ≈ full width; ≤1024px three per row; otherwise 0.2× of 1920×1080.
- The tile equal to the session's live slide is marked selected; tiles are rendered "live" style
  while the session is presenting and not blacked out.
- Clicking a tile (or Enter on a focused tile) asks the page to put that slide live (live area).
  Arrow keys/Home/End only move focus across tiles (grid, no wrap), never change the live slide.
  Focus resets to the first tile when the selected item changes.
- Empty presentation → SVG + "Presentationen är tom" + "Klicka på **Lägg till** i sidopanelen…".
  Items but none selected → a random Swedish quote/verse from a fixed list of 38
  (`SlideGrid.razor:237-286`), re-rolled each time the selection becomes empty.
- Image order edit mode: tiles become draggable; each has a red × (confirm "Vill du ta bort den här
  bilden?"); a dashed "+" tile opens "Lägg till bilder" (image tab only, add-modal rules apply).
  Removing the last image removes the whole item. Arrow navigation disabled in this mode.

#### 2d. Add modal (`S/Components/Presentations/AddItem/AddItemModal.razor`)
Title "Lägg till". Pill tabs: **Sånger**, **Bibeltexter**, **Bilder**, **Ljud**, **PowerPoint**
(Ctrl/⌘+1…5; tooltips show the shortcut). Opens on Sånger; the search box of Sånger/Bibeltexter is
focused on open and on tab switch (not on screens <768px). Each tab has a bottom-right **Lägg till
&lt;label&gt;** button (shown only when something is selected) next to a **Lägg till fler** checkbox with an
"i" info popover ("När ikryssad stannar modalen öppen…"). The checkbox state is shared across tabs
for the life of the modal and starts unchecked.
- Add button: if "Lägg till fler" unchecked → add and close; checked → add, stay open, reset the
  tab (clear search/selection, refocus search).
- **Shift+Enter** (inside the tab): add and stay open regardless of the checkbox.
- **Ctrl/⌘+Enter**: same as clicking the Add button (so it *also* stays open if the checkbox is checked).
- New items are inserted directly **after the currently selected item** (appended if nothing is
  selected or the selected item is last) and the new item becomes selected
  (`Presentation.razor:1972-2011`). Toast per add: `"{title}" har lagts till`, `{n} bilder har lagts
  till`, `Lade till {n} ljudfiler`, `Lade till {file}`.
- The modal pushes a blocking shortcut scope: page shortcuts (a, Delete, F2, ?) are inert while open.

**Sånger tab** (`AddItem/Song/SongTab.razor`): no songs in library → "Inga sånger i biblioteket ännu"
+ **Hantera sånger** (ManageSongs only) + **Skapa**. Otherwise search input (max 100 chars,
placeholder "Sök på titel, författare eller textrad", clear ×) filtering on every keystroke (search
semantics → songs area); matches are highlighted. Typing selects the first hit. List (virtualised)
left, preview right (desktop): name, author, pencil → in-modal song editor with Back; arrangement
pills when the song has >1 arrangement (default first); slide previews in the presentation's theme.
↑/↓ move the selection. "Inga sånger hittades" + **Skapa** when no hits. **Skapa** opens a name dialog
prefilled with the search text, creates the song, and opens it in the in-modal editor. On mobile,
tapping a song opens a full-screen preview with its own Add button. The chosen arrangement is stored on
the item.

**Bibeltexter tab** (`AddItem/Bible/*`): no Bible → "Inga biblar än". Otherwise reference search
(placeholder "Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)") + Bible select (first
Bible preselected). Results list shows up to 500 verses ("Visar {n} av {total} verser" when capped);
the Add label is the reference of first..last result; Add adds **all shown results**. No hits →
"Inga verser hittades" + "Sök på bibelställe:" + examples. Empty query → book picker (Gamla/Nya
testamentet, localised names) → browse picker: breadcrumb `Book ch:v — ch:v` where each part is
clickable to re-pick; sequence: chapter → start verse → end verse (end chapter defaults to start
chapter; end chapter re-pickable); start/end swap if reversed; selected range highlighted; Add appears
only once both start and end verse are picked. Changing the Bible resets browse state. Verse parsing,
book names and search → "Bibles, themes and media" area. Slide splitting: max ~250 chars per slide,
balanced across slides, verse numbers as superscripts (`S/Services/BibleTextService.cs:14,68-107`).

**Bilder / Ljud tabs**: library grid (images, thumbs 3–5 columns) / list (audio). Click toggles
selection (multi). **Importera** uploads (multi-file, drag-and-drop zone), progress "Importerar {i} av
{n}...", failures "{n} bild(er)/fil(er) kunde inte importeras"; new uploads appear first. Each entry has
a menu with **Ta bort** → moves the file to the trash (toast "{name} flyttad till papperskorgen"). Add
creates **one item** containing all selected files in library order. Empty: "Inga bilder än" /
"Inga ljudfiler än". Upload validation/compression → "Bibles, themes and media" area.

**PowerPoint tab** (`AddItem/Slides/SlidesTab.razor`): **Importera bildspel** (accept `.pdf,.pptx,.ppt`)
or drop a file; help text "Importera en PowerPoint- eller PDF-fil… Animeringar och videor följer inte
med. Filen sparas bara i den här presentationen." While uploading: "Importerar...". On hosts without
upload endpoints (device apps): "PowerPoint- och PDF-import görs i webbappen…" and no picker. Errors:
"Filen har för många sidor. Maximum är 100 sidor." or "Kunde inte importera filen. Försök igen.".
Success always closes the modal (no "add more"), inserts after selection, toast "Lade till {file}".

#### 2e. Remove item
"⋯ → Ta bort" or **Delete** key on the selected item → dialog titled "Radera" / "Vill du ta bort
**{title}**?" with **Avbryt** / **Radera** (bulk removal uses the same buttons). Removal is permanent (no trash for items). Removing a Slides item
also deletes its deck and page files.

### 3. Templates admin — `/admin/templates` (`S/Pages/Admin/Templates.razor`)
Policy ManageTemplates (Admin, SuperAdmin). Title "Mallar"; **Papperskorg** → `/trash?kind=Template`
(always visible); **Skapa** (when list non-empty). States: "Laddar...", empty (SVG, "Inga mallar",
"Med mallar kan du snabbt skapa presentationer med fördefinierat innehåll.", **Skapa**), list of all
templates by `UpdatedAt` desc linking to `/templates/{id}`. Create → template details dialog
"Skapa mall" (name, weekday, time, location) → navigate to the template editor. Reloads on sync.

### 4. Overlays admin — `/admin/overlays`, `/admin/overlays/{id}`
Policy ManageOverlays (all roles). List: 16:9 thumb (image or placeholder), title, first line of
text; empty state "Inga overlays" + "Overlays visas ovanpå den aktiva bilden under en presentation,
t.ex. ett Swish-nummer vid kollekt." + **Skapa**. Create → name dialog "Skapa overlay" → detail page.
Detail (`OverlayDetail.razor`, `OverlayEditor.razor`): Titel, Textinnehåll (textarea), "Bild
(valfritt)" with **Välj bild / Byt bild / Ta bort bild** and drop zone; edits autosave 500 ms after
the last keystroke (debounced) and flash "Sparad" in the header; a blank title is never saved.
**Ta bort** → confirm "Är du säker på att du vill ta bort overlayen {title}?" → permanent delete (no
trash) → back to list. Unknown id → redirect to list. Showing an overlay live → live area.

### 5. Trash — `/trash` (`S/Pages/Trash.razor`)
Any signed-in user. Back link to `/`. Opening triggers a best-effort purge of expired rows (> 30 days)
for each kind the caller manages, then lists every trashed row of the kinds the caller may *manage*
(ManagePresentations, ManageTemplates, ManageSongs, ManageOrganizationImages,
ManageOrganizationAudios), newest deletion first (tie → id).
- States: "Laddar..."; empty: icon + "Papperskorgen är tom." + "Det du tar bort sparas här i 30 dagar
  innan det tas bort helt."; content.
- Content header: "1 sak" / "{n} saker" (+ "av {total}" when filtered); **Töm papperskorgen**.
- Kind pills (only when >1 kind present): "Allt", then present kinds in fixed order Presentationer,
  Mallar, Sånger, Bilder, Ljudfiler. `?kind=Presentation|Template|Song|Image|Audio` (case-insensitive)
  preselects; unknown/absent/empty kind → "Allt".
- Search box (max 100, 200 ms debounce, × clears immediately) matches name or song author,
  case-insensitive substring. No matches → "Inget här stämmer med det du söker."
- Row: kind icon, name, "Kind · detail · days" where days = "{n} dagar kvar", "1 dag kvar" (red) or
  "Raderas snart" (red, 0 days). **Återställ** (disabled while busy) → toast "{name} återställd".
  Trash-can button "Radera permanent" → confirm with kind-specific text:
  - Presentation: "Vill du ta bort {0} permanent? Sånger, bibelord och bilder i den följer med."
  - Template: "…Presentationer som redan skapats från den påverkas inte."
  - Song: "Vill du ta bort {0} permanent?"
  - Image/Audio: "…Presentationer som fortfarande använder den tappar den."
- **Töm papperskorgen** → confirm "Vill du ta bort alla {n} saker i papperskorgen permanent?" — always
  the whole (permitted) trash, not the filtered view.
- Errors → warning toast "Något gick fel. Försök igen." and the list is re-read.

### 6. Keyboard shortcuts (global mechanism) — `S/Services/KeyboardShortcutService.cs`, `S/Components/KeyboardShortcuts.razor`
| Scope | Key | Action |
|---|---|---|
| Överallt | `?` | Toggle help dialog "Kortkommandon" ("Kortkommandon fungerar när du inte skriver i ett textfält.") listing every registered group, newest first, including documentation-only rows; closes with `?` or ×. |
| Startsidan | `n` | New presentation (picker/dialog). |
| Startsidan (doc) | ↓ / Enter | Move through list / open. |
| Presentation | `a` | Open Add modal (ignored in remote and stage mode). |
| Presentation | `F2` | Rename selected item (ignored in stage mode). |
| Presentation | `Delete` | Confirm-remove selected item (ignored in remote and stage mode). |
| Presentation (rewrite) | Alt+↑ / Alt+↓ | Move the selected item one place up / down. |
| Presentation (doc) | ↓ / → / Enter | Move through running order / slides / show slide. |
| Lägg till (blocking) | Ctrl/⌘+1…5 | Switch tab. |
| Lägg till (doc) | Ctrl/⌘+Enter, Shift+Enter, ↓ | Add and close / add and stay / move in results. |

## Rules and invariants

**Permissions and tenancy**
- PRES-R1 Every service method checks a permission *and* that the caller belongs to the organisation;
  writes additionally verify the target row belongs to that org (otherwise "not found"/no-op), so a
  caller cannot touch another org's presentation by id even with a valid own org id.
  `S/Services/PresentationService.cs:273-284, 383-389`; tests `UT/Services/PresentationServiceTests.cs:131-296`.
- PRES-R2 Role matrix (`S/Models/PermissionMap.cs`): User = View/ManagePresentations, ViewTemplates,
  View/ManageOverlays; Admin adds ManageTemplates; SuperAdmin = all.
- PRES-R3 Reading presentations requires ViewPresentations; any presentation/item mutation requires
  ManagePresentations (`PresentationService.cs:113-555`).
- PRES-R4 Template list (admin) and template create/schedule/"save as template"/delete/restore/purge
  require ManageTemplates; reading a template and the dashboard's recent-template list require
  ViewTemplates (`PresentationService.cs:211, 765, 781, 795, 828, 1008, 572-613`).
- PRES-R5 Creating from a template requires ManagePresentations **and** ViewTemplates (`:896-897`).
- PRES-R6 Changing a presentation's theme requires ManagePresentations + ViewThemes, and the theme
  must be built-in or belong to the org, else error "Theme not found." (`:1048-1063`; test `PresentationServiceTests.cs:110`).
- PRES-R7 Overlays: list/get need ViewOverlays; add/update/remove need ManageOverlays (`:1076-1178`).
- PRES-R8 Slide upload endpoint requires authentication; the service requires ManagePresentations and
  a non-trashed presentation in the org (`S/Services/PresentationSlidesService.cs:39-49`).

**Validation limits (server)** — `S/AppConstraints.cs`
- PRES-R9 Name/title ≤200; location ≤100; description ≤5000; item part content ≤5000; overlay title
  ≤200, overlay content ≤2000; file name ≤200; search inputs ≤100 (UI `maxlength`). Violations throw
  "The field '{X}' exceeds the maximum length of {n} characters." (`S/Services/ValidationHelper.cs:7-12`).
- PRES-R10 Quotas (counted excluding trashed rows): 3000 presentations/org, 50 templates/org, 200
  overlays/org, 100 items/presentation (checked in `AddItemAsync`), 50 parts/item (checked in
  `AddItemPartsAsync`). Error "The maximum number of {entity} ({n}) has been reached."
  (`PresentationService.cs:238-240, 286-288, 393-394, 800-802, 1105-1107`; `AppConstraints.cs:31-42`).
- PRES-R11 Slides upload: ≤50 MB; content types `application/pdf`, pptx, ppt; ≤100 pages; pages
  rendered at 150 DPI to WebP quality 85; PowerPoint converted to PDF via Gotenberg
  `/forms/libreoffice/convert`; if PowerPoint and converter not configured → HTTP 503; unreadable PDF →
  400 "Could not read the PDF…"; Gotenberg failure → 400 "Could not convert the PowerPoint file…"
  (`W/UploadEndpoints.cs:130-197`, `S/Services/PdfRenderService.cs:12-47`, `S/Services/PowerPointConverter.cs:36-56`).
- PRES-R12 Overlay image upload: jpeg/png/webp/gif, ≤10 MB, overlay must exist in org (404 otherwise);
  replaces any previous image (`W/UploadEndpoints.cs:56-98`).
- PRES-R13 UI-only: presentation/template/overlay names are trimmed and must be non-blank; the
  server accepts an empty name (`PresentationDetailsDialog.razor:132-151`, `PresentationService.cs:232`).

**Ordering**
- PRES-R14 Items and parts are always read ordered by `SortOrder` (`PresentationService.cs:222-223`).
- PRES-R15 Server add appends (`max(SortOrder)+1`); the editor then persists the full order so the new
  item lands after the selected one (`Presentation.razor:1730-1741, 2006-2011`).
- PRES-R16 Reorder takes the full id list; each item's `SortOrder` = its index in the list; ids not in
  the list keep their old value (`PresentationService.cs:323-342`, same for parts `:428-447`).
- PRES-R17 Every reorder (drag in sidebar, drag in image edit) is persisted immediately (CLAUDE.md
  "Database" rule; `Sidebar.razor:344-360`, `SlideGrid.razor:426-469`).
- PRES-R18 Dashboard orderings as in Screen 1; overlays by `SortOrder` (creation order); admin template
  list by `UpdatedAt` desc; trash newest deletion first.

**Change propagation**
- PRES-R19 Every child mutation (add/rename/reorder/remove item or part, arrangement change, slide
  import) also bumps the presentation's `UpdatedAt` (so it rises in the dashboard list) and its sync
  version (`PresentationService.cs:1190-1200`, `PresentationSlidesService.cs:102-107`; tests
  `UT/Services/SyncTrackingCallSiteTests.cs:106-322`).
- PRES-R20 Every write announces an organisation change; other open dashboards, template/overlay
  lists and editors re-read silently. An editor showing the same presentation that was changed from
  another browser session reloads and toasts "Presentationen har uppdaterats" (not for its own
  changes) (`Presentation.razor:1234-1246`). Selection is preserved by id across reloads, never moved
  to follow another operator's live slide except in stage mode (`Presentation.razor:1094-1104, 1299-1320`;
  test `UT/Components/LiveSelectionFollowTests.cs:92-115`).
- PRES-R21 Theme change on a presentation is pushed immediately to whatever is live for it (live area)
  (`Sidebar.razor:506-514`, `Presentation.razor:1220-1232`).

**Trash**
- PRES-R22 Deleting a presentation/template only sets `DeletedAt`; items, parts, decks and slide files
  are kept (`PresentationService.cs:633-646`; tests `UT/Services/PresentationTrashTests.cs:79-99`).
- PRES-R23 A trashed row is invisible to every ordinary read path: get by id, dashboard, paged list,
  recent list, template lists, create-from-template ("Template not found."), and cannot be edited
  (`TrashQueries.cs`; tests `PresentationTrashTests.cs:101-117, 337`).
- PRES-R24 Presentation delete cannot trash a template and vice versa; the two trashes are separate
  lists with separate permissions (tests `PresentationTrashTests.cs:119-127, 291-311`).
- PRES-R25 Trashed rows do not count against quotas; restore is allowed even if it exceeds the quota
  (`PresentationService.cs:236-240, 659-662`).
- PRES-R26 Retention 30 days: `DaysRemaining = max(0, 30 − whole days since deletion)`; expired rows are
  purged lazily when someone opens the Trash page (not when listing via the service), best-effort — a
  storage failure must not prevent showing the trash (`PresentationService.cs:34-38`,
  `TrashService.cs:66-75, 150-177`; tests `TrashServiceTests.cs:164`, `PresentationTrashTests.cs:218-253`).
- PRES-R27 Purge removes parts, items, the presentation's slide decks and their files; only rows that
  are actually in the trash can be purged (a live presentation's id passed to purge does nothing)
  (`PresentationService.cs:665-761`; tests `PresentationTrashTests.cs:177-216`).
- PRES-R28 The unified trash lists only kinds the caller can *manage*, so every shown Restore/Delete
  button works; "Empty trash" clears exactly those kinds, each kind independently (partial failure
  leaves the rest) (`TrashService.cs:77-113, 179-204`; tests `TrashServiceTests.cs:132-161, 242`).
- PRES-R29 Items, parts and overlays have no trash: removing them is permanent and confirmed by a
  dialog; whole presentations/templates and media files go to trash without a dialog, with a toast
  naming where they went (CLAUDE.md "Feedback"; `Presentation.razor:1479-1514`).

**Templates**
- PRES-R30 Create-from-template copies, in one transaction: items (type, title, sourceId, sortOrder)
  and parts, `ThemeId`; each Slides item gets a *new* deck row and the deck's files are copied in
  storage after commit; event date/time/location/description come from the dialog; template
  `LastUsedAt = now`, `UseCount += 1` (`PresentationService.cs:894-1004`).
- PRES-R31 Save-as-template copies items and parts and `ThemeId`; no schedule; slide decks are *not*
  duplicated (see Open questions) (`:826-892`).
- PRES-R32 The dashboard picker shows at most 10 templates (`:763-777`).

**Editor**
- PRES-R33 Remove item of type Slides deletes the deck row and its storage prefix after the DB commit
  (`PresentationService.cs:462-485`; bulk `:502-550`).
- PRES-R34 Removing the last image of an image item removes the item (`Presentation.razor:853-874`).
- PRES-R35 Start/stop/live state is per browser session; the dashboard "Live" pill reflects only the
  viewer's own session (`PresentationRow.razor:19`).
- PRES-R36 Song item title is not kept in sync with the library automatically; it is updated only when
  the song is edited from inside this editor (`Presentation.razor:1652-1676`).

**Shortcuts**
- PRES-R37 Only the topmost scope stack down to the first *blocking* scope receives keys; modals
  (Add modal, help dialog) are blocking (`KeyboardShortcutService.cs:163-170`; tests
  `UT/Services/KeyboardShortcutServiceTests.cs:40-97`).
- PRES-R38 Binding the same keystroke twice in one scope is a programming error (throws)
  (`KeyboardShortcutService.cs:227-238`).
- PRES-R39 Keystroke matching: Cmd and Ctrl are the same modifier; Shift is ignored for single
  printable characters (so `?` works on all layouts) and kept for named keys; key compared
  case-insensitively; auto-repeat and IME composition ignored; in text fields only Ctrl/Cmd combos and
  Escape pass through (`S/Services/Shortcut.cs:23-31`, `S/wwwroot/utils.js:1270-1316`; tests `UT/Services/ShortcutTests.cs`).
- PRES-R40 Display: Mac uses ⌘ ⌥ ⇧ concatenated, others "Ctrl+Alt+Shift+X"; arrows as ↑↓←→, Enter ↵,
  Escape "Esc", Delete "Del"; letters verbatim (`Shortcut.cs:37-61`).
- PRES-R41 List navigation never wraps; first ↓ from nothing lands on the first item, first ↑ on the
  last; Home/End jump; any modifier disables movement (`S/Utils/ListNavigation.cs:28-94`).

## Edge cases

- PRES-E1 Search results in the Bible tab are added *as a whole* — a book-only query such as "Matt"
  matches the whole book; only the first 500 verses are kept and added (`BibleTextTab.razor:107, 219-231`).
- PRES-E2 The 50-parts-per-item and 5000-char part limits are not checked when an item is added with
  its parts in one call (`AddItemAsync`), so a long Bible passage can produce >50 parts
  (`PresentationService.cs:271-303`).
- PRES-E3 Slide imports bypass the 100-items-per-presentation quota (`PresentationSlidesService.cs:34-119`).
- PRES-E4 In browse mode a single verse requires picking the same verse as start and end; after only
  the start verse the Add button stays hidden (`BibleBrowsePicker.razor:110, 192-207`).
- PRES-E5 A song item whose song was trashed/deleted (and that has no legacy parts) shows no slides —
  the grid falls back to the idle quote (`Presentation.razor:1333-1352`).
- PRES-E6 Image/audio items reference library files; purging a file from the trash leaves broken
  tiles in presentations (the purge confirm text warns about it).
- PRES-E7 Item rename of a blank or unchanged title is ignored (`Presentation.razor:962-963`).
- PRES-E8 Renaming in the header is only clickable on ≥lg screens; on mobile only F2 (no keyboard on
  most phones) — effectively no rename on mobile.
- PRES-E9 The editor's "Delete presentation" menu entry is shown to everyone; the server enforces
  ManagePresentations / ManageTemplates.
- PRES-E10 Templates: a User (ViewTemplates only) can open `/templates/{id}` by URL and edit its items
  and rename it, because item mutations and rename only require ManagePresentations and do not check
  `IsTemplate` (`PresentationService.cs:305-321, 271-303`). Delete is refused (ManageTemplates).
- PRES-E11 Dashboard "today" is computed on the server (Blazor Server) with `DateTime.Today`, i.e. the
  server's time zone (`Dashboard.razor:288`).
- PRES-E12 Recent templates sort by `LastUsedAt` desc; never-used templates (NULL) sort first on
  PostgreSQL but last on SQLite (`PresentationService.cs:772`).
- PRES-E13 A sync that removes rows clamps the dashboard arrow index so it never points past the end
  (`Dashboard.razor:315-317`); a reload keeps the number of loaded pages.
- PRES-E14 Adding an item and then reordering are two separate server calls; a failure between them
  leaves the item at the end.
- PRES-E15 Removing an item is applied optimistically in the UI and then persisted; there is no
  rollback on error for single removal; bulk removal waits for the server and toasts errors
  (`Presentation.razor:1516-1593`).
- PRES-E16 Trash kind filter falls back to "Allt" when the filtered kind becomes empty after a
  restore/purge (`Trash.razor:249-252`).
- PRES-E17 Clearing the trash search cancels the pending debounce so old text does not reappear
  (`Trash.razor:274-283`).
- PRES-E18 Overlay text/title edits with a blank title are silently not saved; uploading an image
  also requires a non-blank title (`OverlayEditor.razor:85-152`).
- PRES-E19 Slides tab ignores the "Lägg till fler" checkbox: a successful import always closes the
  modal (`Presentation.razor:1927-1970`).
- PRES-E20 When the presentation is not found the page still renders the shell; only the sidebar says
  "Presentationen hittades inte".
- PRES-E21 Holding an arrow key in the running order selects every item it passes (one load per
  repeat); deliberately not debounced (`Sidebar.razor:392-418`).

## Acceptance scenarios

- PRES-A1 Given an org with no presentations, when a user opens `/`, then the empty state
  "Inga presentationer ännu" with a **Skapa** button is shown and no header Create button.
- PRES-A2 Given no templates, when the user presses `n` on the dashboard, then the "Skapa
  presentation" details dialog opens directly with name "Presentation" focused; when they clear the
  name, **Skapa** is disabled; when they type "Gudstjänst" and press Enter, they land on
  `/presentations/{id}` with the name in the sidebar.
- PRES-A3 Given a template "Söndag" with weekday Sunday 11:00 and location "Kyrkan", when the user
  clicks **Skapa** on the dashboard, then the picker lists "Tom presentation" and "Söndag — söndag
  11:00 · Kyrkan"; when they pick it, the dialog is prefilled with name "Söndag", the next Sunday
  (today if today is Sunday before 11:00), 11:00 and "Kyrkan".
- PRES-A4 Given a template with a song, a Bible text and a PDF deck, when a presentation is created
  from it, then it contains the same items in the same order, the deck pages display, the template's
  theme is used, and deleting the deck item in the new presentation does not affect the template.
- PRES-A5 Given presentations dated yesterday, today 18:00, today 10:00, next week, and undated, when
  the dashboard loads, then "Idag" shows 10:00 then 18:00, "Kommande" shows next week, and the bottom
  list shows yesterday's and the undated one ordered by last change.
- PRES-A6 Given 25 past presentations, when the dashboard loads, then 20 are listed with **Visa
  fler**; clicking it shows all 25 and hides the button.
- PRES-A7 Given an open presentation with items A, B, C and B selected, when the user adds a song via
  the Add modal, then the song is inserted between B and C, becomes selected, a toast `"{song}" har
  lagts till` appears, and after reload the order is still A, B, song, C.
- PRES-A8 Given the Add modal on the Sånger tab with "Lägg till fler" unchecked, when the user selects a
  song and presses Shift+Enter, then the song is added, the modal stays open, and the search box is
  empty and focused; when they then press Ctrl+Enter with a song selected, the song is added and the
  modal closes.
- PRES-A9 Given "Lägg till fler" is checked, when the user clicks **Lägg till**, then the modal stays
  open and the tab is reset.
- PRES-A10 Given the Add modal is open, when the user presses `a`, `Delete` or `?`, then nothing
  happens behind the modal; Ctrl+3 switches to Bilder.
- PRES-A11 Given the Bibeltexter tab, when the user types "Joh 3:16-18", then three verses are listed and
  the button reads "Lägg till Joh 3:16-18"; adding creates an item titled "Joh 3:16-18" whose slides
  carry superscript verse numbers.
- PRES-A12 Given the Bibeltexter tab with an empty query, when the user picks "Psaltaren", chapter 23,
  start verse 1, end verse 3, then verses 1–3 are highlighted and adding creates "Ps 23:1-3"
  (Swedish book abbreviation per bible area).
- PRES-A13 Given the Bilder tab, when the user selects two images and adds, then one item titled
  "2 bilder" with two slides is created; when the user opens image edit mode, drags the second before
  the first and reloads, the order persists.
- PRES-A14 Given an image item with one image in edit mode, when the user removes it and confirms, then
  the whole item disappears from the running order.
- PRES-A15 Given the PowerPoint tab, when the user uploads a 3-page PDF, then a "Slides" item named after
  the file with three page tiles is inserted and the modal closes; uploading a 101-page PDF shows
  "Filen har för många sidor. Maximum är 100 sidor."; uploading a .pptx when Gotenberg is not
  configured shows "Kunde inte importera filen. Försök igen.".
- PRES-A16 Given a selected item, when the user presses Delete, then the confirm dialog "Vill du ta bort
  **{title}**?" opens; Avbryt keeps it; Radera removes it permanently (not in the trash).
- PRES-A17 Given multi-select mode, when the user clicks item 1 and Shift+clicks item 3, then items 1–3
  are checked and the button reads "Ta bort markerade (3)"; confirming shows toast "3 objekt borttagna".
- PRES-A18 Given a selected item on a desktop viewport, when the user presses F2, types a new name and
  presses Enter, then the title updates in header and sidebar and persists; Escape instead keeps the
  old title.
- PRES-A19 Given the running order has focus, when the user presses ↓ three times past the last item,
  then selection stops on the last item (no wrap); Ctrl+↓ does nothing.
- PRES-A20 Given a song item is selected, when the user presses → in the slide grid, then focus moves to
  the next tile without changing the live slide; Enter shows it (live area).
- PRES-A21 Given the editor menu, when the user chooses **Redigera detaljer**, sets a date, location and
  theme "X" and saves, then the sidebar shows date/location, the slides use theme X, and the dashboard
  shows the presentation under the right section.
- PRES-A22 Given a presentation, when the user chooses **Radera presentation**, then no dialog appears,
  they are taken to `/`, a toast "{name} flyttad till papperskorgen" shows, and the presentation is
  listed at `/trash?kind=Presentation` with "30 dagar kvar"; **Återställ** brings it back to the
  dashboard with all items and slide pages intact.
- PRES-A23 Given a trashed presentation, when a user opens `/presentations/{id}`, then "Presentationen
  hittades inte" is shown.
- PRES-A24 Given an item in the trash deleted 31 days ago, when anyone with the matching Manage
  permission opens `/trash`, then the row is gone for good.
- PRES-A25 Given a User (non-admin) and a trashed template plus a trashed presentation, when the User
  opens `/trash`, then only the presentation is listed.
- PRES-A26 Given trash with a presentation, a song and an image, when the user selects the "Sånger" pill
  and clicks **Töm papperskorgen**, then the dialog says "…alla 3 saker…" and all three are purged.
- PRES-A27 Given the trash, when the user types part of a song author's name, then the song is listed
  and the count reads "1 sak av {n}".
- PRES-A28 Given a presentation with a PDF deck in the trash, when it is purged, then its slide page
  URLs return not found.
- PRES-A29 Given two browsers on the same presentation, when browser A adds an item, then browser B's
  running order updates and shows "Presentationen har uppdaterats", while B's selection is unchanged.
- PRES-A30 Given an Admin on `/admin/templates` with no templates, when they click **Skapa**, enter
  "Söndag", Sunday, 11:00, then they land on `/templates/{id}` with banner "Du redigerar en mall" and
  no Start button.
- PRES-A31 Given a presentation, when an Admin chooses **Spara som mall** and saves name "Påsk", then a
  toast "Sparad som mall" appears and "Påsk" is listed in `/admin/templates` and in the dashboard picker.
- PRES-A32 Given a User (no ManageTemplates), then `/admin/templates` is denied and "Spara som mall" is
  not in the menu.
- PRES-A33 Given `/admin/overlays`, when the user creates "Kollekt", types text, waits 0.5 s, then
  "Sparad" flashes; reloading shows the text; deleting asks for confirmation and removes it permanently.
- PRES-A34 Given any page, when the user presses `?`, then "Kortkommandon" lists "Överallt" and the
  current page's group(s) (e.g. "Presentation: a, F2, Del, ↓, →, ↵"); pressing `?` again closes it.
- PRES-A35 Given a Mac, then tooltips read "Skapa (n)", tabs "Sånger (⌘1)"; on Windows "Sånger (Ctrl+1)".
- PRES-A36 Given the org has 3000 non-trashed presentations, when the user creates another, then the
  server refuses; after trashing one, creating succeeds.
- PRES-A37 Given a caller of org A, when they call any presentation/item write with org A's id and an id
  belonging to org B, then nothing in org B changes (API/sync-level test).

## Implementation artefacts

- **`PresentationEditorState` / `AppState.SelectedProject` (`Project`/`ProjectItem` duplicates of the
  model)**, render-avoidance comments and `PresentationRenderTests` — Blazor re-render performance. Need
  behind it: editing must stay responsive while live slides change.
- **`ExecuteUpdateAsync` + manual `ModifiedAt` stamping, `BumpPresentationAsync`, tombstones, `Version`
  columns, `SyncTrackingCallSiteTests`** — EF/sync plumbing. Need: any child change must count as a
  change of the presentation for conflict detection and last-changed ordering (PRES-R19).
- **`DeletedAt` as an ordinary synced column rather than a tombstone** — need: every device shows the
  same trash.
- **`RefreshOnSync`, `IOrganizationChangeNotifier`, `SharedAppState.NotifyPresentationChanged` with
  sender session id** — Blazor-circuit fan-out. Need: PRES-R20.
- **Circuit culture restore (`Culture.Restore`)** — events raised on other circuits' threads. Need: UI
  stays in the viewer's language.
- **JS interop for sortable lists, focus, `eval` for measuring preview width, `uploadSlides` fetch** —
  need: drag-and-drop reorder, roving focus, responsive previews.
- **`IAppCapabilities.UploadEndpoints`, `IMediaUploader`/`MediaIngestService`** — device (MAUI/Electron)
  apps without the server converter. Need: slide import only where a converter exists; say so honestly.
- **PDFtoImage/SkiaSharp rendering, Gotenberg** — tech choice. Need: PDF/PPT(X) → per-page images,
  ≤100 pages. Note: there is **no PDF export** of presentations; `PdfRenderService` only rasterises
  uploaded PDFs.
- **`BibleTextService` in-memory `store`** — dead cache; only `Create` matters.
- **`OverlayManager.razor` / `OverlayEditorPanel.razor`** — not referenced anywhere (dead UI).
- **`GetRecentPresentationSummariesAsync`, `SaveAsync`** — used only by MCP / nothing; MCP tools
  (`W/Mcp/PresentationTools.cs`) expose list/get/create/add song/add bible/rename/reorder/remove/
  arrangement/event updates → MCP area.
- **Legacy song-item parts fallback** (`Presentation.razor:1337-1350`) — old data only.
- **Lazy purge on trash open** — no background job in the current host. Need: items older than 30
  days disappear; a scheduled job is acceptable.

## Open questions

1. **Save-as-template shares slide decks** (bug): template Slides items reuse the source
   presentation's `PresentationSlides` id; purging that presentation (or removing the item there)
   deletes the deck and files the template still points at (`PresentationService.cs:863-886, 462-485`).
   Should save-as-template copy decks like create-from-template does?
2. **`ArrangementId` is not copied** by save-as-template or create-from-template; templates lose the
   chosen song arrangement. Intended?
3. **Template permission gap** (PRES-E10): should editing template items require ManageTemplates?
4. Server accepts blank names and doesn't validate date/time; should the new server reject blank names?
5. Quotas not enforced on bulk parts (PRES-E2) and slide imports (PRES-E3) — enforce everywhere?
6. Dashboard "today" uses the server's time zone (PRES-E11); in the new app, use the client's/org's?
7. NULL ordering of `LastUsedAt` differs between Postgres and SQLite (PRES-E12). Decide explicitly
   (probably never-used last).
8. Ctrl+Enter respects the "Lägg till fler" checkbox, while CLAUDE.md says Ctrl+Enter = add and close.
   Which wins? The Slides tab has no add-more/keyboard handling at all.
9. CLAUDE.md requires search fields to show a result count; the song search shows none (Bible shows
   only when capped). Add counts?
10. Overlay images are stored as uploaded (no compression), contrary to the "Images and media" rule.
11. Overlays have `SortOrder` but no reorder UI; should they be reorderable?
12. `UpdatedBy` is never updated after creation; is "last edited by" a wanted feature?
13. No UI to change a song item's arrangement after adding (MCP only). Wanted?
14. Mobile rename of items is effectively impossible (PRES-E8).
15. Single-verse selection in browse mode requires a double pick (PRES-E4) — likely unintended.
16. Song items reference the live song; the item title does not follow library renames (PRES-R36).
    Keep, or show the current song name?
17. The editor offers delete/add/edit controls regardless of permission; with all current roles
    having ManagePresentations this is moot, but a read-only role would need UI gating.
