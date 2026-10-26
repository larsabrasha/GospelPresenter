# Live presentation and displays

All paths are relative to the repository root. `Shared/…` is never used as an abbreviation; paths are
written out in full.

## Overview

An operator opens a presentation, presses **Starta presentation** and from then on every slide tile
they press is put on the "live" output: projector windows on the same machine, TVs/screens elsewhere
in the building that are paired to the session, and public QR outputs that visitors follow on their
own phones. While live, the operator can black the screen out ("Rensa"), put an overlay (e.g. a
welcome text or an image) on top of whatever is showing, play audio, switch to a full-screen "stage
mode" built for foot pedals, and allow a phone/tablet to remote-control the presentation. A
presentation started on the desktop app runs locally (the desktop is authoritative) and is mirrored
to the server so phones and public outputs can follow it; losing the network freezes the outputs on
the last slide instead of blanking them. Being live is the most latency- and robustness-critical
part of the app: a congregation is looking at the result.

## Concepts

### Live session and session id
- A **live session** is the unit that "is presenting". It is keyed by a **session id**, not by user
  or presentation. One session presents at most one presentation at a time; the same presentation can
  be live in several sessions at once (e.g. a desktop in the hall and a browser elsewhere).
- Web: the session id is per **browser tab**: 8 lowercase hex chars kept in `sessionStorage['session-id']`
  (`GospelPresenter/GospelPresenter.Shared/wwwroot/utils.js:170-188`), falling back to a random 8-char
  id if storage throws (`GospelPresenter/GospelPresenter.Shared/Layout/MainLayout.razor:134-151`).
  It survives reloads of the tab, not closing it.
- Desktop (Electron): `DeviceSessionId.For(deviceTokenId)` = first 12 hex chars of
  SHA-256(`"session:" + deviceTokenId`) — stable across restarts, derivable by the server from the
  device token, never sent raw because it appears in anonymous image URLs
  (`GospelPresenter/GospelPresenter.Shared/Services/ISessionIdProvider.cs:24-40`,
  `GospelPresenter/GospelPresenter.Desktop/Services/DesktopSessionIdProvider.cs`).
- The session id lives longer than one presentation; state from the previous presentation can still be
  in it (see LIVE-R5).

### Live state of one session (server-side, in memory — `SharedAppState`, process singleton)
`GospelPresenter/GospelPresenter.Shared/State/SharedAppState.cs:54-63`

| Field | Meaning |
|---|---|
| `ActiveSession {OrganizationId, PresentationId, PresentationName}` | Present ⇔ the session is presenting ("active"). |
| `LiveSlide` | What the outputs render (table below). Default = empty, `ShowingPresentation`. |
| `ActiveOverlay {Text, ImageUrl, Id}` | Overlay on top of the slide, or none. |
| `RemoteControlEnabled` | Operator allowed phones to control this session. Survives Stop→Start in the same session. |
| `SessionAudio {Id, Parts[{PartId, AudioId, FileName, Url}]}` | Audio item whose `<audio>` elements the operator page hosts. |
| pending `AudioCommand {Action: toggle|seek|fade, AudioElementId, Position}` | One-slot inbox from a remote controller. |
| `CcliReportedElsewhere` | True for mirrored desktop sessions (device counts CCLI itself). |
| `lastAccessed`, `expired` marker | Idle eviction bookkeeping. |

`LiveSlide` (`GospelPresenter/GospelPresenter.Shared/State/LiveSlide.cs:3-19`):

| Field | Meaning |
|---|---|
| `Status` | `ShowingPresentation` or `ShowingBlackScreen` (the "Rensa"/blank state). |
| `ItemType` | Song, BibleText, Image, Audio, Slides (imported deck) — null = nothing selected yet. |
| `ProjectItemId`, `ItemPartIndex` | The selection: which item of the running order, which part (0-based). |
| `Text` | Song: plain text of the part. Bible: HTML of the part (rendered as markup). |
| `Credits` | Song: "Author · © Publisher · Year" (missing pieces dropped; `null` if none). Bible: the item title. |
| `ImageUrl` | Image/Slides: a session-scoped *live* image URL (`/api/live-images/{sessionId}/…`). |
| `SongPart` | The song part record (content, label, colour). |
| `Theme` | The resolved slide theme travels with the slide. |
| `SongId`, `SongName`, `CcliNumber` | For CCLI usage reporting. |

The **selection** (`ItemId`, `PartIndex`, black screen, overlay id) is the logical state; everything
else on the slide is derived from it by `LiveSlideBuilder` (below).

### Outputs (things that render a session)
1. **Local live window** (`/live?session=…`, role `Live`, numbered "Fönster (n)") — a browser tab or a
   native window on the operator's machine.
2. **External display** (`Extern skärm`) — one projector output per machine: a native window filling the
   second monitor (desktop), or a browser Presentation-API (Cast) receiver (web). Role `Projector`.
3. **Paired screen** (`/display`) — a browser on another device (TV, PC) bound to the session:
   either a **saved screen** (an org `RemoteDisplay` of kind `Screen`, opened at
   `/display?id=<code>&name=<name>`) or a **temporary display** (ad-hoc, paired with a 4-digit code or a
   QR token). Web host only.
4. **Public output** (`/watch/{code}`) — an org `RemoteDisplay` of kind `PublicQr`; any number of
   anonymous visitors (cap 500) follow over SSE.

`RemoteDisplay` entity (synced, `GospelPresenter/GospelPresenter.Shared/Models/RemoteDisplay.cs:8-31`):
`Id`, `OrganizationId`, `DisplayIdentifier` (the public 7-char code), `Name`, `Kind` (`Screen`=0,
`PublicQr`=1), `CreatedAt`, `ModifiedAt`, `Version`. Ordered by `CreatedAt`.

**Output bindings** (`RemoteDisplayState`, in-memory singleton,
`GospelPresenter/GospelPresenter.Shared/State/RemoteDisplayState.cs`): display id → session id; the
set of displays currently online; display names; pairing codes (code → display) and pairing tokens
(token → session). One display/output is bound to at most one session at a time.

### Mirrored session (desktop-owned, ADR 0004)
- `MirroredSessionState {PresentationId, PresentationName, RemoteControlEnabled, BlackScreen, ItemId,
  PartIndex, OverlayId, EnabledOutputs}` — what the device reports; `EnabledOutputs` = public-output
  codes the owner switched on, sorted ordinal and comma-joined; `null` = "not reported" (old client),
  not "none" (`GospelPresenter/GospelPresenter.Shared/Live/LiveSessionContracts.cs:21-36`).
- `MirroredSessionCommand {ItemId, PartIndex, BlackScreen, OverlayId}` — what a controller asks for;
  always absolute.
- Server registry entry `{SessionId, OrganizationId, ConnectionId, OwnerName, LastReported,
  OwnerLastSeen, OwnerConnected}` (`GospelPresenter/GospelPresenter.Web/Live/MirroredSessionRegistry.cs:25-32`).
- Desktop mirror status: `Off`, `Preparing` (syncing content up), `Mirroring`, `Waiting` (server
  unreachable) (`GospelPresenter/GospelPresenter.Client/Live/LiveSessionClient.cs:398-411`).

### Saved output configuration (per browser/app, not per org)
`localStorage['output-config'] = {enabledDisplayIds: string[], windowCount: int, presentationDisplay: bool}`
(`GospelPresenter/GospelPresenter.Shared/State/LiveOutputsState.cs:17`,
`GospelPresenter/GospelPresenter.Shared/wwwroot/utils.js:886-893`). Written whenever outputs change;
used to bring the same outputs back when the next presentation starts on this machine.

### Lifecycle of a session
`not presenting` → **Start** (slide cleared to black, session activated) → operator selects slides /
blanks / overlays (any number of times) → **Stop** (owner), or superadmin **End**, or idle eviction
(4 h), or abandoned-device reaping (2 h offline, mirrored only) → `not presenting`. A mirrored session
additionally has the sub-state *frozen* (owner disconnected; last state stays up, cannot be driven).

## Screens and flows

### 1. Operator page — `/presentations/{presentationId}` (authenticated; any org member)
Live-relevant parts only (editing the running order belongs to the *Presentations* area).
Not available on `/templates/{id}` (template mode never shows live controls).

- **Starta presentation** button (green, header on wide screens; floating round button bottom-right on
  < lg) — visible when not in template mode, not in remote mode and this tab's session is not active.
  Effect: live slide cleared to *black with nothing selected*, session activated with the presentation
  id + name, (desktop) mirroring begins in the background, screen wake lock requested
  (`GospelPresenter/GospelPresenter.Shared/Pages/Presentation.razor:696-720`). Double presses are ignored
  while a start/stop is in progress. The outputs restore themselves (see 1c).
- **Slide grid** (centre). Shows the parts of the *selected* item as 16:9 thumbnails. Tile states
  (`GospelPresenter/GospelPresenter.Shared/Components/Slide.razor` + `SlideGrid.razor:54-157`):
  - tile = live selection and session is showing (active and not black): red outline + pulsing
    "LIVE" badge;
  - tile = live selection but session not showing (not started, or black): sky-blue outline;
  - other tiles: no outline, hover outline (red if session showing, else blue).
  - Click/tap or Enter on a tile → that part goes live (LIVE-R10). Arrow keys/Home/End only move focus
    (LIVE-R40). Audio items show an audio player instead of tiles; an empty presentation shows an empty
    state ("Presentation.Empty"); an unselected item shows a random Swedish quote.
- **Sidebar running order**: a pulsing red dot marks the item that is live (only while active and not
  black). Selecting an item in the sidebar does **not** change what is live.
- **Dashboard / presentation lists**: a red "Live" pill on a presentation row that is active in *this
  tab's* session (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/PresentationRow.razor:19-25`).
- **LivePanel** — shown while the session is active (and, in remote mode, the controller is "ready").
  Rendered twice: a fixed 288 px right column on ≥ lg, a floating collapsible card on < lg (collapsed
  card header shows a tiny live preview). Contents, top to bottom
  (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/LivePanel.razor`):
  1. **Nu visas** — live preview (exactly what outputs show incl. overlay and black fade).
  2. **Rensa** — toggles black screen. The button is invisible while black (LIVE-R13).
  3. **Utgångar** (hidden in remote mode) with hint text. Rows:
     - **Extern skärm** toggle — shown when the host has a second display (desktop), the browser has
       the Presentation API, or the projector is currently on.
     - one toggle per saved **screen** (web only): green icon when bound, grey when online, faded and
       disabled with an "offline" icon when offline and not bound.
     - one toggle per **public output**: shows "{0} enheter"/"{0} enhet" (green when > 0) while bound
       to this session; when bound to another session shows "Sänder från {presentation}". Turning on
       an output bound elsewhere opens **"Ta över utgången?"** with "“{0}” sänder till “{1}”. Bara en
       presentation åt gången kan sända till en utgång. Om du tar över följer alla som tittar den här
       presentationen i stället." (or the *Unknown* variant) → **Ta över** / Avbryt.
     - one row per open live window "Fönster (n)" with ✕ (Stäng fönster).
     - one row per ad-hoc paired display "Tillfällig skärm (n)" with ✕ (Koppla från).
     - **Lägg till utgång** menu: **Fönster** (opens a live window), **Anslut tillfällig skärm** (web
       only; pairing dialog, §8). Failure to open a window → toast "Live-vyn kunde inte öppnas".
  4. **Overlays** (only if the org has overlays; collapsed by default): one toggle per overlay, at most
     one active (LIVE-R15).
  5. **Fjärrstyrning** (collapsed by default; hidden in remote mode and on hosts without the
     capability): toggle **Tillåt fjärrstyrning**; the first time it is switched on in this panel
     instance the *Fjärrstyr presentationen* dialog (§9) opens automatically; an info button re-opens
     it (disabled while off).
  6. Hidden `<audio>` elements for the session's audio (operator only).
  7. **Scenläge** button → stage mode (§3).
  8. **Avsluta presentation** (red) — or, when stopping is not allowed (controller of a device-owned
     session), the text "Bara datorn som presenterar kan stoppa presentationen."
- **Stop** (`Presentation.razor:774-809`): closes Presentation-API connections and tells all live
  windows of the session to close, sets the slide black, deactivates the session (or, for an
  abandoned mirrored session, ends it fully), stops mirroring, releases the wake lock, re-registers the
  selected audio item as non-live session audio. Outputs are released by following the deactivation
  (LIVE-R25), whoever caused it.
- **Session expired dialog** — when this tab's session was evicted for inactivity: "Visningen
  avslutades" / "Presentationen stängdes automatiskt på grund av inaktivitet." [OK].
- **Presentation edited elsewhere** — another circuit/MCP changes the presentation → page reloads it and
  toasts "Presentationen har uppdaterats" (not for the tab's own edits). Reloading keeps the selected
  item; if something is live, the live item is selected instead (`Presentation.razor:1094-1104`).

### 1b. Audio during live
- Selecting an Audio item shows one player per audio part (file name, play/pause, seek bar,
  current/total time, **Tona ut** (fade-out) button). Selecting it does **not** change the projected
  slide (stage mode blacks the screen instead, §3).
- The selected audio becomes the session's audio and keeps playing while the operator moves on to
  other items; it is replaced only when another audio item is selected
  (`Presentation.razor:1385-1402`). Starting one part pauses and rewinds the other parts of the same
  item. Fade-out: 5 000 ms, ease-out cubic, then pause, rewind to 0, restore volume
  (`GospelPresenter/GospelPresenter.Shared/wwwroot/utils.js:1112-1144`). While dragging the seek bar
  the audio is muted, unmuted 150 ms after the last move.
- Audio plays **only on the operator's machine**; outputs and public viewers never play audio.
- Remote controller: its own players are muted mirrors; play/pause, seek (with position) and fade are
  relayed to the presenting tab, which executes them on its elements
  (`Presentation.razor:1168-1172`, `:1285-1288`).

### 1c. Output restore on start (`LiveOutputsState.AttachAsync`)
On becoming active, the operator page first **discovers** live windows already open for this session
(native launcher list, or a BroadcastChannel roll call answered within 400 ms on the web) and adopts
them keeping their numbers; only if none are open does it **restore** the saved configuration: bind
each saved display id that still exists (screens only if online; public outputs always) and is not bound
to any session, open `windowCount` live windows, and turn the external display on if it was on
(`GospelPresenter/GospelPresenter.Shared/State/LiveOutputsState.cs:128-192`, `:471-513`).

### 2. Remote control mode — `/presentations/{id}?remote=true[&session={sessionId}][&stage=true]`
Entry points: dashboard card **Ta kontroll** (one card "Visas just nu" + presentation name or "Aktiv
presentation" per remote-enabled session in the user's active org, excluding the viewer's own tab
session; `GospelPresenter/GospelPresenter.Shared/Components/Dashboard.razor:34-56`, `:241-253`), or the
QR/link from §9.
- Amber banner "Fjärrstyrningsläge – du styr en aktiv presentation".
- Session resolution (`Presentation.razor:566-578`): candidates = active sessions of this presentation in
  the user's active org (sorted by session id). `session` from the URL wins if it is a candidate;
  else a single candidate is taken; else (several) a picker "Den här presentationen visas på flera
  ställen. Välj vilken du vill styra." with one button per session labelled with the device name, or
  "Presentation {n}". Re-resolved whenever any session starts or stops.
- Not ready states (instead of the grid):
  - owner device offline: "Datorn som presenterar har tappat kontakten. Det som visades ligger kvar;
    den går att styra igen när den är tillbaka." + hint and red **Avsluta presentationen** button
    (ends the abandoned session, releasing its outputs);
  - no session: "Ingen aktiv presentation just nu";
  - remote control off: "Fjärrstyrning är inte aktiverad av presentatören".
- Ready: the controller sees the same grid and LivePanel (without Utgångar, Fjärrstyrning, audio
  engine), and its clicks write to the *presenter's* session directly (optimistic).
- Stop is offered when the presenter is a browser session (it then stops it for real); for a
  device-owned session it is replaced by the "Bara datorn som presenterar…" text.
- For a mirrored session, 2 s after the controller's last change, if the owner's last report disagrees,
  toast (warning) once: "Datorn som presenterar har inte bekräftat ändringen. Kontrollera vad som
  visas på skärmen." (`Presentation.razor:492-559`).
- Template mode ignores `remote`.

### 3. Stage mode — `?stage=true` (own or remote session)
Full-screen dark overlay for a worship leader/foot pedal. Only shown while the session is active
(and the controller is ready). Contents (`GospelPresenter/GospelPresenter.Shared/Components/Presentations/StageView.razor`):
- Top bar: **Lämna scenläge**, centred current item title (or "Välj") opening an item picker sheet
  (list with type icons; "Presentationen är tom" when empty), **Overlays** button with a blue dot when
  one is active (overlay sheet with toggles).
- "Nu visas": live preview **without credits**; song part label pill top-right (hidden while black);
  **Rensa** below (invisible while black). Audio item: preview with "Ljud spelas".
- "Nästa": the next part of the selected item, clickable; empty placeholder on the last slide.
- Slide strip of all parts; live one has red outline + LIVE badge; auto-scrolls to centre the live part.
- Picking an item: Audio → screen goes black; otherwise its first part goes live immediately.
- On entry with nothing selected and a non-empty running order the item picker opens automatically.
- The selection follows the live slide (only here; LIVE-R41). Wake lock held while open.
- Editing shortcuts of the page are suppressed in stage mode.

### 4. Live window / projector — `/live?session=&windowId=&role=&index=&title=` (anonymous)
- Black page; the slide is scaled to `min(vw/1920, vh/1080)` and centred (letterbox/pillarbox in
  black) (`GospelPresenter/GospelPresenter.Shared/Pages/Live.razor:21-39`).
- Renders the session's slide + overlay + black fade, live, on every session change.
- First click/tap anywhere requests fullscreen (once). Requests a screen wake lock.
- No error bar and no reconnection UI (LIVE-R33). Document title = `title` query value.
- Closes itself when the session is not active or expired, or when told to over the
  `gospel-live` BroadcastChannel (window id or whole session).
- Desktop: opened as a native Electron window; with ≥ 2 monitors the window goes frameless + kiosk onto
  the first display not hosting the operator window, otherwise a normal 1280×720 window. Title
  `"Gospel Presenter Projector — {title}"` (not localized)
  (`GospelPresenter/GospelPresenter.Desktop/Services/ElectronLiveWindowLauncher.cs:42-115`). MAUI: a
  second app window (no display choice; fails gracefully if multi-window unsupported).

### 5. Paired screen — `/display` (anonymous)
`GospelPresenter/GospelPresenter.Shared/Pages/Display.razor`
- `?id=<code>&name=<name>` (saved screen): registers itself *online*; not bound → shows its name
  (large) and the Gospel Presenter logo, no code. The operator turns it on from the LivePanel.
- No `id` (temporary display): a display id is kept in `sessionStorage['ad-hoc-display-id']`; shows
  optional name, "Parkopplingskod", a 4-digit code in huge mono font, "Ange denna kod i Gospel
  Presenter för att ansluta denna skärm", logo. The code is regenerated when expired (checked every
  minute; valid 10 min). `?token=…` (from the QR) pairs immediately and the URL is rewritten to
  `/display`.
- Bound and session active: same rendering as `/live`. Bound but session not active: plain black.
  Unbound again (temporary): a new code is shown.
- Click requests fullscreen. No error/reconnect UI.

### 6. Public output viewer — `/watch/{code}` (anonymous, not a Blazor page)
`GospelPresenter/GospelPresenter.Shared/Components/Presentations/PublicWatchPage.razor`,
`GospelPresenter/GospelPresenter.Web/PublicOutputEndpoints.cs`
- 404 if no `PublicQr` output has this code (screens' codes also 404).
- Black page, `noindex`, zoom allowed, tab title = organisation name (fallback "Gospel Presenter").
- Waiting screen (never a blank page): three pulsing dots, output name (fallback org name), "Väntar på
  att sändningen ska börja". Shown when nothing is broadcasting, the slide is black, nothing is
  selected yet, or rendering failed.
- Slide: theme background/colours/fonts; text reflows and is sized from the viewport (LIVE-R31);
  images `object-contain`; credits at the bottom; overlay text centred near the top at 60 % white.
- Over the cap: "För många enheter tittar just nu. Försök igen om en liten stund." and the stream stops.
- Localised per request (Accept-Language); slide fragments are not localised.

### 7. Admin › Skärmar — `/admin/displays` (policy ManageRemoteDisplays = Admin, SuperAdmin)
`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Displays.razor`
- Section **Skärmar** (hosts with paired displays = web): list name, Online/Offline (live), **Visa
  länk**, **Ta bort**. Empty: icon, "Inga skärmar tillagda", description, **Lägg till**. Loading:
  "Laddar...".
- Section **Publika utgångar** (hosts with public output = web + desktop): name, "Sänder från {0}" when
  bound to an active session, viewer count "{0} enheter/enhet", **Visa QR-kod**, **Ta bort**. Empty:
  "Inga publika utgångar" + **Skapa publik utgång**.
- Add dialog: name (required, trimmed; Ctrl+Enter submits, Esc closes) → creates, then opens the
  link/QR dialog for the new one.
- Screen link dialog: QR + copyable URL `{server}/display?id={code}&name={name}` ("Länk kopierad").
- Public QR dialog: QR of `{server}/watch/{code}`, **Ladda ner som bild** (`qr-{code}.png`, 24 px per
  module, ECC M), copyable URL, **Ny kod** with confirmation "“{0}” får en helt ny kod. Alla utskrivna
  skyltar och sparade länkar slutar fungera, och alla som tittar just nu kopplas bort. Detta kan inte
  ångras." → toast "Ny kod skapad"; error → "Common.ErrorOccurred".
- Delete: confirm dialog "Är du säker på att du vill ta bort skärmen {0}?" (no trash). Delete and
  regenerate immediately disconnect viewers and unbind the old code.
- URLs are built against the *server* address even on a device host.

### 8. Pairing dialog — "Anslut tillfällig skärm" (web only)
`GospelPresenter/GospelPresenter.Shared/Components/Presentations/PairingCodeDialog.razor`
- **Skanna QR-koden**: QR of `{server}/display?token={token}`; token single-use, valid 10 min,
  regenerated every 8 min while open, invalidated on success or close.
- **Eller anslut manuellt**: 1) copyable `{server}/display` URL, 2) four one-digit boxes (numeric,
  auto-advance, paste spreads digits, Backspace goes back, ←/→ move, Enter submits, Esc closes);
  auto-submit when complete. Wrong/expired: "Ogiltig eller utgången kod", boxes cleared.
- Success (either path): green check "Skärmen är ansluten" / "Enheten är nu ansluten och visar
  live-vyn."

### 9. Remote control info dialog — "Fjärrstyr presentationen"
QR + collapsible copyable link `{server}/presentations/{id}?remote=true&session={sessionId}`, and a
collapsible explanation with a mock-up of the dashboard **Ta kontroll** card
(`GospelPresenter/GospelPresenter.Shared/Components/Presentations/RemoteControlInfoDialog.razor:110-121`).

### 10. Superadmin › Aktiva sessioner — `/admin/sessions` (policy ManageOrganizations)
Every active session on the server across orgs: presentation name (or "Presentation utan namn"),
org name · owner ("Webbläsare" / device name / "Enhet") · session id; badges "Datorn är inte nåbar",
"Fjärrstyrning", "{0} utgångar"; **Avsluta** with confirmation "{name} stannar för alla som tittar, och
skärmarna och de publika utgångarna som den använder släpps." Empty: "Ingen presenterar just nu."
Live-updates on start/stop/presence. (Connected-users page belongs to the *Administration* area.)

### Keyboard shortcuts during live
| Where | Key | Effect | Source |
|---|---|---|---|
| Presentation page | `a` / `F2` / `Delete` | add item / rename / remove (with confirm) | `Presentation.razor:991-996` |
| Sidebar | ↑/↓, Home/End | change selected item (not live) | `ListNavigation.cs` |
| Slide grid | arrows (all four step one tile), Home/End | move focus only | `SlideGrid.razor:394-403` |
| Slide grid | Enter (focused tile) | put slide live | `SlideGrid.razor:366-369` |
| Stage mode | → ↓ PageDown Space Enter | next part (first part if nothing of this item is live) | `utils.js:1160-1165`, `StageView.razor:494-499` |
| Stage mode | ← ↑ PageUp | previous part (no-op at 0) | same |
| Stage mode | `.` `b` `B` | toggle black screen | same |
| Stage mode | Esc | close open sheet, else exit stage mode | same |
Stage keys are ignored while focus is in INPUT/TEXTAREA/contenteditable; default action prevented.
`?` (global help) lists the page's shortcuts (*Navigation/Shortcuts* area).

## Rules and invariants

### State and selection
- **LIVE-R1** All live state is held per session in memory on the server/host process; it is not
  persisted to the database and is lost on restart. `GospelPresenter/GospelPresenter.Shared/State/SharedAppState.cs:54-63`
- **LIVE-R2** Writes are idempotent: writing an equal slide, the same overlay, clearing an absent
  overlay, re-activating with the same presentation, enabling an already-enabled remote control raise
  no change notification. Audio commands are the exception (every command is delivered).
  `SharedAppState.cs:121-122`, `:155-156`, `:168-169`, `:229-230`, `:283-284`, `:335-343`
- **LIVE-R3** A slide is built from a selection only (`LiveSlideBuilder`), by the same code on every
  host: Song → part `PartIndex` of the arranged parts (item's arrangement, else the song's first
  arrangement); if the song is missing from the library, parts are reconstructed from the item's saved
  parts. Image → part ordered by `SortOrder`, live org-image URL `full` variant. BibleText → part
  `PartIndex` (in stored order), credits = item title. Slides → part ordered by `SortOrder` whose content
  is the page number → live slides-page URL. Audio → no slide (null). `GospelPresenter/GospelPresenter.Shared/Services/LiveSlideBuilder.cs:82-172`
- **LIVE-R4** Building a slide always sets `Status = ShowingPresentation` (selecting a slide un-blacks
  the screen), sets the theme, and an out-of-range part still moves the selection but leaves
  text/image/song fields empty (renders as an empty themed canvas). `LiveSlideBuilder.cs:157-171`;
  `GospelPresenter/GospelPresenter.UnitTests/Services/LiveSlideBuilderTests.cs:96`, `:188`
- **LIVE-R5** Start clears the live slide to black with nothing selected before activating, so the
  previous presentation's slide can never be one press away. `SharedAppState.cs:140-141`; `Presentation.razor:706-707`
- **LIVE-R6** Selecting an audio item never changes what is projected, except in stage mode where
  picking an audio item blacks the screen. `Presentation.razor:1437-1438`, `:746-751`
- **LIVE-R7** Song credits format: non-empty of [Author, "© "+Publisher, Year] joined by " · ";
  none → no credits line. `LiveSlideBuilder.cs:193-205`
- **LIVE-R8** Song text is rendered as plain text (HTML-encoded, `white-space: pre-wrap`); Bible text is
  rendered as HTML. `GospelPresenter/GospelPresenter.Shared/Components/Presentations/SongSlide.razor:17-26`; `BibleTextSlide.razor:13`
- **LIVE-R9** Selecting a slide while a session is active also updates the session's presentation
  id/name if the operator opened another presentation in the same tab (one session moves to the other
  presentation). `Presentation.razor:1440-1441`; `SharedAppState.cs:409-416`
- **LIVE-R10** Selection is per client; only what is *showing* is shared. Other operators/controllers
  do not have their selected item moved by live changes, except stage mode. `Presentation.razor:1299-1320`;
  `GospelPresenter/GospelPresenter.UnitTests/Components/LiveSelectionFollowTests.cs:92-115`

### Black screen and overlays
- **LIVE-R11** Black screen keeps the selection; un-blacking (toggle, or selecting any slide) returns to
  content. Outputs fade to black over 500 ms (black layer above overlay). `SharedAppState.cs:174-183`;
  `GospelPresenter/GospelPresenter.Shared/Components/Presentations/LiveDisplay.razor:25`
- **LIVE-R12** Stop leaves the slide black (selection kept) then deactivates. `Presentation.razor:811-818`
- **LIVE-R13** The "Rensa" buttons (panel and stage) are hidden while black; the way back is selecting a
  slide (or `b`/`.` in stage mode, which toggles). `LivePanel.razor:67`; `StageView.razor:113-117`
- **LIVE-R14** Public outputs show the waiting screen (not black) while black or before anything is
  selected. `GospelPresenter/GospelPresenter.Shared/State/PublicOutputBroadcaster.cs:85-89`
- **LIVE-R15** At most one overlay per session; toggling the active one clears it, toggling another
  replaces it. Overlay = optional text (top-left, 40 px, 60 % white, text-shadow, `pre-line`) and/or
  image (full canvas, `object-contain`) above the slide; outside the theme. `Presentation.razor:1456-1471`;
  `GospelPresenter/GospelPresenter.Shared/Components/Presentations/OverlayView.razor:11-27`
- **LIVE-R16** An overlay stays when slides change and when the screen is blacked (it is under the
  black layer). Stop does not clear it explicitly. `LiveDisplay.razor:12-25`

### Rendering
- **LIVE-R17** Fixed 1920×1080 canvas, uniformly scaled; padding 80 px left/right/top, 144 px bottom;
  content centred; overflow clipped — there is **no** shrink-to-fit. `GospelPresenter/GospelPresenter.Shared/Components/Slide.razor:29-31`;
  `GospelPresenter/GospelPresenter.UnitTests/Support/SlideTextFitEstimator.cs:5-20`
- **LIVE-R18** Default text style (75 px, Tahoma stack, weight 400, line-height 1.4, #ffffff, centre, no
  shadow; shadow = `0 0.06em 0.18em rgba(0,0,0,.65)`); credits 40 px, line-height 1.2,
  `rgba(255,255,255,0.4)`, left, absolutely positioned 32 px from bottom, 80 px from sides. Fallback theme
  "Classic": song bold 700, Bible left-aligned, black backgrounds. `GospelPresenter/GospelPresenter.Shared/State/SlideTextStyle.cs:15-32`;
  `GospelPresenter/GospelPresenter.Shared/State/SlideTheme.cs:48-73`. (Themes themselves: *Themes* area.)
- **LIVE-R19** Background by type: Song → song background; BibleText → bible background; Image/Slides →
  media background (letterbox colour); background image with optional black scrim 0–100 %, cover or
  contain. `SlideTheme.cs:30-35`, `:94-114`
- **LIVE-R20** Song part label (if any) is shown on grid tiles and in stage mode, never on outputs.
  `SongSlide.razor:27-33`; `GospelPresenter/GospelPresenter.Shared/Components/Presentations/LiveSlideView.razor:8-17`
- **LIVE-R21** Theme change of a presentation while live is pushed onto the current slide immediately
  (projectors, stage, public). `Presentation.razor:1220-1232`; `Sidebar.razor:509-514`
- **LIVE-R22** Item/part content edits are **not** pushed onto the current live slide; the new text
  appears at the next selection (see Open questions). `Presentation.razor:1234-1246`

### Outputs and bindings
- **LIVE-R23** One output ↔ at most one session. Turning on a public output bound to another session
  requires confirmation ("Ta över"); restoring a saved configuration never steals a bound output;
  a mirrored owner takes outputs over without confirmation. `LivePanel.razor:635-652`;
  `LiveOutputsState.cs:498-501`; `GospelPresenter/GospelPresenter.Web/Live/MirroredSessionProjector.cs:92-96`
- **LIVE-R24** Only the owning session may unbind a display (`DisableDisplay` checks owner); forced
  unbinding happens when a saved screen goes offline, on admin delete/regenerate, on idle >4 h, or on
  session expiry (paired screen disconnects itself). `RemoteDisplayState.cs:169-182`, `:205-219`, `:233-241`;
  `Display.razor:241-245`
- **LIVE-R25** When a session stops (any cause) the operator host closes all its live windows (also
  ones it did not open, via a session-wide close message) and Presentation-API connections, without
  overwriting the saved configuration. `LiveOutputsState.cs:265-334`
- **LIVE-R26** Live windows are discovered rather than remembered; a reloaded operator page adopts the
  open windows (keeping their numbers; next number = max+1) instead of opening a second set; restore
  happens once per session even though two panels attach. Window numbers of a failed open are reused.
  `LiveOutputsState.cs:128-263`; `GospelPresenter/GospelPresenter.UnitTests/State/LiveOutputsStateTests.cs:49-430`
- **LIVE-R27** Saved configuration is rewritten on every output change (toggle, window open/close,
  projector on/off); a window closing because the presentation stopped does not rewrite it.
  `LiveOutputsState.cs:455-469`; `LiveOutputsStateTests.cs:266`
- **LIVE-R28** Paired screens: pairing code = 4 digits in [1000, 9998], unique among live codes, one code
  per display (new code replaces old), valid 10 min, single use. Pairing token: 32 random bytes,
  base64url, valid 10 min, single use. `RemoteDisplayState.cs:14`, `:39-96`
- **LIVE-R29** Saved-screen online status is per open `/display?id=` page; closing that page unbinds it.
  Temporary displays stay registered across reloads of their tab. `Display.razor:143-153`, `:273-279`
- **LIVE-R30** Public output codes: 7 chars from `abcdefghjkmnpqrstuvwxyz23456789`, globally unique
  (unique index), up to 8 retries; max 50 outputs (screens + public) per org; name ≤ 200 (DB). Create/
  delete/regenerate require ManageRemoteDisplays; listing requires ViewPresentations; all org-scoped.
  `GospelPresenter/GospelPresenter.Shared/Services/DisplayIdentifiers.cs:16-20`;
  `GospelPresenter/GospelPresenter.Shared/Services/RemoteDisplayService.cs:38-150`;
  `GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:43`
- **LIVE-R31** Public slide text size = `clamp(18px, min(size/1920·100·1.6 vw, size/1080·100 vh), size px)`
  (credits and overlay min 11 px; overlay base 40 px); never larger than the theme size.
  `GospelPresenter/GospelPresenter.Shared/Components/Presentations/PublicSlideView.razor:88-116`
- **LIVE-R32** Public output broadcasts only while bound **and** the bound session is active; otherwise
  `idle`. Image requests through `/api/watch/{code}/image/...` are served only under the same condition,
  scoped to that session's org. Visitors never see the operator's session id (URLs rewritten).
  `PublicOutputBroadcaster.cs:54-72`, `:107-122`; `PublicOutputEndpoints.cs:136-168`
- **LIVE-R33** Output surfaces (`/live`, `/display`) never show error or reconnection UI; the last
  rendered slide stays. `GospelPresenter/GospelPresenter.Shared/Layout/LiveLayout.razor:20-23`;
  `GospelPresenter/GospelPresenter.Web/Components/App.razor:48-55`; `GospelPresenter/GospelPresenter.Shared/wwwroot/app.css:192-198`
- **LIVE-R34** Live images `/api/live-images/{sessionId}/{org-image|overlay|slides}/…` are anonymous but
  served only while that session is active, from the session's org; `Cache-Control: public,
  max-age=3600`. `GospelPresenter/GospelPresenter.Web/Program.cs:798-850`

### Public output stream (SSE)
- **LIVE-R35** `GET /api/watch/{code}/stream?v={viewerId}`: 404 unknown code, 400 missing `v`;
  `text/event-stream`, `no-cache, no-store`, `X-Accel-Buffering: no`. Sends the current state first,
  then `event: slide` (JSON-string HTML) / `event: idle` / `event: full`; `:ping` every 15 s.
  `PublicOutputEndpoints.cs:23`, `:62-131`
- **LIVE-R36** Viewer identity = random 16-hex id in the tab's sessionStorage (`watch-viewer-id`);
  reconnect/reload replaces the entry (counted once). Cap default 500 per output
  (`Settings:PublicOutputMaxViewers`); an already-registered viewer is never rejected. Stale after
  2 min without a successful ping. Each viewer queue holds 1 event (drop-oldest: only the latest state).
  Viewer-count notifications throttled to ≤ 1 per 2 s per output with a trailing update.
  `PublicWatchPage.razor:74-90`; `GospelPresenter/GospelPresenter.Shared/State/PublicOutputState.cs:32-33`, `:46`, `:61-92`, `:161-188`
- **LIVE-R37** The slide HTML is rendered once per output per change and shared by all viewers; only
  outputs with ≥ 1 viewer are rendered. A render failure sends `idle`. `PublicOutputBroadcaster.cs:93-104`, `:148-158`

### Remote control
- **LIVE-R38** Remote control requires: same active organisation, session active, presenter's toggle
  on. No role/permission beyond org membership (any `User` can control). Off ⇒ "Fjärrstyrning är inte
  aktiverad av presentatören". Controller cannot manage the presenter's outputs or remote toggle.
  `Presentation.razor:566-609`; ADR `adr/0004-mirrored-desktop-live-sessions.md` (Authorization)
- **LIVE-R39** The remote-control toggle persists across Stop→Start in the same session; it is reset
  only by switching it off or session eviction. `SharedAppState.cs:247-250`, `:533`

### Keyboard
- **LIVE-R40** Arrow keys in the slide grid never put a slide live; only Enter/click does.
  `SlideGrid.razor:365-371`; `GospelPresenter/GospelPresenter.UnitTests/Components/KeyboardNavigationTests.cs:175`
- **LIVE-R41** Stage-mode next on the last part does nothing; prev on part 0 does nothing; next with no
  part of the selected item live goes to part 0. `StageView.razor:486-513`

### Lifetimes and timeouts
- **LIVE-R42** Session idle eviction: a session untouched for `Settings:SessionTimeoutMinutes` (default
  240) is removed entirely (slide, overlay, activation, remote toggle, audio); any read or write counts
  as a touch (an open projector keeps it alive). Swept on every touch and every minute by the reaper
  timer. Eviction raises "presentation stopped". `SharedAppState.cs:502-565`;
  `GospelPresenter/GospelPresenter.Shared/SharedServicesSetup.cs:17`
- **LIVE-R43** Paired display binding idles out after 4 h without activity (activity = a slide change on
  its session while displayed). `RemoteDisplayState.cs:15`, `:117-123`
- **LIVE-R44** CCLI: a song slide (with CCLI number) continuously live ≥ 10 s is reported once; any slide
  change before resets the timer; not counted on the server for mirrored sessions (device counts).
  `SharedAppState.cs:459-500` (reporting itself: *CCLI* area)

### Mirrored desktop sessions (ADR 0004)
- **LIVE-R45** The device is authoritative; the projector runs from local state and starts immediately on
  Start regardless of network; content is synced (full sync + media sync) **before** the first report,
  retried with backoff 1,2,4,8,16,30 s… for as long as the presentation lasts.
  `GospelPresenter/GospelPresenter.Client/Live/LiveSessionClient.cs:81-159`
- **LIVE-R46** Hub `/hubs/live-session` accepts device tokens only; session id and org come from the token,
  never from the message. `GospelPresenter/GospelPresenter.Web/Live/LiveSessionHub.cs:20-106`
- **LIVE-R47** Owner sends its whole state on connect, on every reconnect, and on each change (only if
  different from the last sent). Server rebuilds the slide from its own copy of the presentation; an
  unknown presentation is ignored (session not activated); an unknown item leaves the slide; overlay not
  found → cleared. `LiveSessionClient.cs:279-313`; `MirroredSessionProjector.cs:28-168`
- **LIVE-R48** Controller writes on the server are forwarded to the owner as absolute commands only
  if they differ from the owner's last report (in presentation, item, part, black, overlay); not while
  a report is being applied; not while the owner is offline (dropped, not queued). Remote-toggle and
  output changes are never commands. `GospelPresenter/GospelPresenter.Web/Live/LiveCommandForwarder.cs:41-63`;
  `GospelPresenter/GospelPresenter.Shared/Live/MirroredSessionStateReader.cs:16-46`
- **LIVE-R49** The device applies commands regardless of which page is open; a command for a session
  that is not presenting, or naming an item it doesn't have, is ignored; a command equal to what is
  showing is not re-written. `GospelPresenter/GospelPresenter.Client/Live/LocalSessionProjector.cs:31-115`
- **LIVE-R50** Disconnect freezes: session stays active, outputs stay bound, controllers see "offline"
  and lose controls. Only owner `EndSession`, an explicit End from a controller/superadmin when the owner
  is offline, or the reaper (owner offline ≥ `Settings:AbandonedSessionMinutes`, default 120, checked every
  1 min) end it; ending releases bound outputs and the CCLI exemption. A deactivation on the server while
  the owner is still connected is undone by the owner's next report.
  `LiveSessionHub.cs:70-82`; `GospelPresenter/GospelPresenter.Web/Live/AbandonedSessionReaper.cs:33-48`;
  `MirroredSessionProjector.cs:178-191`; `GospelPresenter/GospelPresenter.Web/Program.cs:247-255`;
  `GospelPresenter/GospelPresenter.IntegrationTests/Live/LiveSessionHubIntegrationTests.cs:121`
- **LIVE-R51** Device reconnect policy: retry after 0, 2, 5, 10 s, then every 30 s, forever.
  `LiveSessionClient.cs:384-394`
- **LIVE-R52** Host capabilities: web = remote control, public outputs, paired screens; desktop = remote
  control + public outputs (via mirroring), no paired screens; MAUI = none. Hidden, never disabled.
  `GospelPresenter/GospelPresenter.Shared/Services/IAppCapabilities.cs`;
  `GospelPresenter/GospelPresenter.Desktop/Services/DesktopAppCapabilities.cs:29-31`;
  `GospelPresenter/GospelPresenter/Services/DeviceAppCapabilities.cs:14-16`

### Propagation, latency and robustness expectations
- Every change to a session (slide, black, overlay, activation, remote toggle, audio) is pushed to
  every surface showing that session without polling: projector windows, paired screens, LivePanels,
  stage mode, controllers, dashboards (activation only), public viewers. In-process this is
  synchronous events; to public viewers a single SSE write; to a device one hub message.
- Operator click → own outputs: no network round trip on desktop (local), one server round trip on web.
- Controller click → controller's own screen updates immediately (optimistic); device confirmation
  expected within 2 s, otherwise a single warning toast.
- Network loss never blanks outputs: public outputs/screens freeze; the desktop projector is unaffected;
  only an explicit end or the 2 h reaper ends a frozen session.
- Public viewers on bad connections always get the newest state, never a backlog (LIVE-R36). SSE
  reconnects automatically (browser EventSource).
- A slow/failing render, sync, window open or JS call must never take the operator page or an output
  down (errors are swallowed and logged; outputs fall back to the waiting screen).
- Single server instance assumed: live state, bindings and hub are in memory (ADR 0004 "Still one web
  instance").

## Edge cases

- Clicking a tile **before** Start writes the selection into the session (tile gets a blue outline) but
  nothing is shown anywhere; Start then clears it to black. `SlideGrid.razor:54`; `Presentation.razor:706`
- After Start the outputs are black until the first tile is pressed (public viewers see the waiting
  screen).
- Out-of-range part (song shortened while live): selection moves, outputs show an empty themed canvas;
  CCLI is not counted. `LiveSlideBuilderTests.cs:96`
- Audio item pressed from a phone on a mirrored session: device keeps current slide (builder returns null).
- Opening another presentation in the same tab while live: the session keeps presenting the old
  presentation until a slide of the new one is pressed, then the session's presentation switches
  (LIVE-R9) — the Start button is not shown on the new presentation because the tab's session is
  active.
- Stop by a browser operator does **not** unbind its screens/public outputs; they remain bound to the
  idle session (screen black, public viewers waiting) and come back on the next Start in the same tab.
  Another operator turning such an output on gets the take-over dialog with "En annan presentation…"
  (no name). Superadmin End / mirrored End do unbind. `Presentation.razor:774-809` vs `MirroredSessionProjector.cs:185-186`
- Reloading a live window: its "closed" message removes its row, its "alive" announcement re-adds it.
  Back/forward cache restore re-announces. `utils.js:687-731`; `LiveOutputsState.cs:542-551`
- A `/live` opened by hand (no `windowId`) is never listed and cannot be closed from the panel, but does
  close when the session stops.
- Unplugging the projector mid-service: the "Extern skärm" row stays so the window can be closed.
  `LiveOutputsState.cs:379-416`; `LiveOutputsStateTests.cs:524`
- Duplicating a browser tab copies sessionStorage → two tabs share a session id (both are the same
  session). Inferred from `utils.js:177-188`.
- Two sessions presenting the same presentation → controller picker; a URL `session` that is no longer
  a candidate falls back to normal resolution.
- Remote controller selects an audio item: it sets the audio of the *presenter's* session too
  (presenter's LivePanel starts hosting that audio). `Presentation.razor:1399-1401`
- Session expiry while a paired screen is showing: the screen unbinds itself; a temporary display shows
  a new code. Live windows close.
- Regenerating a public code from the desktop (via sync push) does not disconnect current viewers of
  the old code on the server (only the web admin page does). `SyncService.cs:1276-1283` vs `Displays.razor:543`
- A device-created output whose code collides gets a new code from the server, with a warning back to
  the device (*Sync* area). `GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:1229-1283`
- Public render is fire-and-forget per change; two rapid changes render concurrently and could be
  published out of order (no sequencing). `PublicOutputBroadcaster.cs:170-184`
- The superadmin page and dashboard may show a stopped mirrored session again if the owner is still
  connected and reports (deactivation undone).
- Viewer count includes stale viewers for up to 2 min after a phone vanishes silently.
- Overlay deleted in admin while live stays on outputs until toggled (state holds text/URL); the overlay
  image URL then 404s (*Overlays* area).

## Acceptance scenarios

Setup unless stated: org "Församling", admin user, presentation P with items [Song S (3 parts, author
"John Newton", CCLI 123), Bible B (2 parts), Image I (2 images), Audio A (1 file)], overlay O ("Välkommen").

- **LIVE-A1** Given P open and not live, When I press "Starta presentation", Then the LivePanel appears
  with "Nu visas" black, the Start button disappears, and the dashboard row of P shows "Live".
- **LIVE-A2** Given P live, When I select S and click part 2, Then the tile gets a red outline and LIVE
  badge, the preview shows part 2 text with credits "John Newton", and a `/live` window shows the same.
- **LIVE-A3** Given a song part selected in the grid and focus on the grid, When I press ArrowRight,
  Then focus moves to the next tile and the live slide does not change; When I press Enter, Then that
  tile goes live.
- **LIVE-A4** Given part 2 live, When I press "Rensa", Then outputs fade to black within ~0.5 s, the
  button disappears, the tile outline turns blue, the sidebar dot disappears; When I click part 3, Then
  part 3 shows and "Rensa" is back.
- **LIVE-A5** Given P live showing a slide, When I toggle overlay O on, Then "Välkommen" appears top-left
  on all outputs; When I change slides it stays; When I toggle O off it disappears.
- **LIVE-A6** Given P live with a slide shown, When I press "Avsluta presentation", Then all `/live`
  windows of the session close, the LivePanel disappears, and public viewers see "Väntar på att
  sändningen ska börja".
- **LIVE-A7** Given P was stopped while part 3 was live, When I start P again, Then outputs are black and
  no tile is marked.
- **LIVE-A8** Given P live, When I open "Lägg till utgång › Fönster" twice, Then rows "Fönster (1)" and
  "Fönster (2)" appear; When I reload the operator page, Then the same two rows are listed and no new
  windows open; When I close "Fönster (1)" via ✕ the window closes.
- **LIVE-A9** Given last service ended with 1 live window and public output Q on, When I start any
  presentation in a new tab of the same browser, Then 1 live window opens and Q is bound (unless Q is
  bound to another live session).
- **LIVE-A10** Given public output Q bound to P (live) and a visitor on `/watch/{Q}`, When the operator
  selects a Bible part, Then the visitor sees the text with readable size (≥ 18 px) without reloading;
  When the operator blacks out, Then the visitor sees the waiting screen.
- **LIVE-A11** Given `/watch/unknown1`, Then HTTP 404. Given `/api/watch/{Q}/stream` without `v`, Then 400.
- **LIVE-A12** Given Q bound to session X (presentation "Morgon"), When operator of session Y toggles Q,
  Then dialog "Ta över utgången?" names "Morgon"; Cancel leaves Q on X; "Ta över" moves viewers to Y's
  slides.
- **LIVE-A13** Given cap = 2 and two viewers on Q, When a third device opens `/watch/{Q}`, Then it sees
  "För många enheter tittar just nu…"; When one of the first two reloads, Then it is accepted.
- **LIVE-A14** Given Q with viewers, When an admin presses "Ny kod" and confirms, Then current viewers are
  disconnected, the old URL returns 404, and a toast "Ny kod skapad" shows.
- **LIVE-A15** Given an image item live and Q bound, Then the visitor's `<img>` URL starts with
  `/api/watch/{Q}/image/` and contains no session id; after Stop the same URL returns 404.
- **LIVE-A16** Given live session S1, Then `/api/live-images/{S1}/org-image/{id}/full` returns the image
  anonymously; after Stop it returns 404.
- **LIVE-A17** Given a TV opens `/display`, Then a 4-digit code is shown; When the operator enters it in
  "Anslut tillfällig skärm", Then the dialog shows "Skärmen är ansluten", the TV shows the live slide and
  the panel lists "Tillfällig skärm (1)"; When ✕ is pressed, Then the TV shows a new code.
- **LIVE-A18** Given the pairing dialog open, When a device opens the QR URL `/display?token=…`, Then it
  pairs automatically, its URL becomes `/display`, and the dialog shows success; the same token used
  again fails.
- **LIVE-A19** Given a wrong code "1234", When submitted, Then "Ogiltig eller utgången kod" and empty boxes.
- **LIVE-A20** Given saved screen "Kyrksal" and `/display?id={code}&name=Kyrksal` open on a TV, Then the
  admin page shows it "Online" and the TV shows "Kyrksal" with no code; When the operator toggles it on
  in the LivePanel, Then the TV shows the slide; When the TV page closes, Then the toggle turns off and
  becomes disabled.
- **LIVE-A21** Given saved screen offline, Then its LivePanel toggle is disabled.
- **LIVE-A22** Given P live with "Tillåt fjärrstyrning" off, When a phone (same org) opens
  `/presentations/P?remote=true`, Then it shows "Fjärrstyrning är inte aktiverad av presentatören"; When
  the operator enables it, Then the phone's grid and panel appear without reload, with the amber banner.
- **LIVE-A23** Given remote ready, When the phone taps a slide, Then the operator's outputs and tile
  highlight update; the phone's panel has no "Utgångar" and no "Fjärrstyrning" sections.
- **LIVE-A24** Given remote control enabled for the first time in the panel, Then the "Fjärrstyr
  presentationen" dialog opens with a QR to `…/presentations/P?remote=true&session={id}`.
- **LIVE-A25** Given P live in two tabs (sessions X, Y), both remote-enabled, When a phone opens
  `?remote=true` without `session`, Then a picker with "Presentation 1"/"Presentation 2" appears; with
  `&session=Y` it controls Y directly.
- **LIVE-A26** Given a user in org B, When opening org A's `?remote=true&session=X`, Then nothing is
  controllable (no candidate in the user's active org).
- **LIVE-A27** Given the dashboard of a second user in the org while P is live with remote enabled, Then
  a card "Visas just nu · P" with "Ta kontroll" is shown; it is not shown on the presenting tab itself.
- **LIVE-A28** Given stage mode on P live, When I press Space on the last part, Then nothing changes;
  When I press `b`, Then the screen blacks; `b` again un-blacks; Esc exits to the normal page.
- **LIVE-A29** Given stage mode, When I pick audio item A from the picker, Then outputs go black and the
  stage shows "Ljud spelas"; When I pick S, Then part 1 of S goes live immediately.
- **LIVE-A30** Given stage mode and another operator moves the live slide to item B, Then the stage
  view's selected item switches to B; the normal (non-stage) page of a third viewer does not change its
  selected item.
- **LIVE-A31** Given P live and audio item A selected and playing, When I select S and show slides,
  Then audio keeps playing; When I press "Tona ut", Then volume fades over 5 s and playback rewinds.
- **LIVE-A32** Given a remote controller viewing A, When it presses play, Then audio plays on the
  operator machine, not on the phone.
- **LIVE-A33** Given a desktop device D presenting P with remote enabled, Then the web dashboard of the
  org shows "Ta kontroll" for it; When a phone selects part 2, Then D's projector shows part 2 and the
  server's state equals D's echo.
- **LIVE-A34** Given D presenting with public output Q switched on in D's panel, Then `/watch/{Q}` on the
  server renders D's current slide; When D switches Q off, Then viewers get the waiting screen.
- **LIVE-A35** Given D presenting and its network drops, Then public viewers keep the last slide, the
  phone shows "Datorn som presenterar har tappat kontakten…" with "Avsluta presentationen"; When the
  network returns, Then controls come back without user action.
- **LIVE-A36** Given D offline for 121 min, Then the session is ended, Q is released and viewers see the
  waiting screen; offline 20 min → still frozen.
- **LIVE-A37** Given D presenting and a phone controller, When the phone tries to stop, Then it sees
  "Bara datorn som presenterar kan stoppa presentationen." instead of a Stop button.
- **LIVE-A38** Given D connected and a server-side deactivation of its session, When D reports next,
  Then the session is active again.
- **LIVE-A39** Given the phone selects an item that D does not have yet, Then after 2 s the phone shows
  the warning "Datorn som presenterar har inte bekräftat ändringen…" once.
- **LIVE-A40** Given a song with CCLI 123 shown live for 11 s, Then one CCLI usage is recorded; shown
  for 9 s then changed → none. Mirrored device session: recorded once (by the device), not twice.
- **LIVE-A41** Given a session not touched for SessionTimeoutMinutes, Then it is evicted and the operator
  tab shows "Visningen avslutades".
- **LIVE-A42** Given superadmin on `/admin/sessions` with two orgs presenting, Then both are listed with
  owner "Webbläsare"; When "Avsluta" is confirmed, Then the session stops for all and its outputs are
  released.
- **LIVE-A43** Given `/live` or `/display` while the server connection drops, Then no reconnect dialog
  or error bar is shown and the last slide remains.
- **LIVE-A44** Given the presentation's theme is changed in the sidebar while live, Then all outputs
  restyle immediately without a new selection.
- **LIVE-A45** Given an admin on `/admin/displays` with no outputs, Then both empty states show; When
  creating public output "Entré", Then the QR dialog opens with `…/watch/{7 chars}` and "Ladda ner som
  bild" downloads `qr-{code}.png`. A non-admin gets access denied on the page and a server error on
  the create call.
- **LIVE-A46** Given 50 outputs in the org, When creating a 51st, Then it is rejected server-side.

## Implementation artefacts

- **Blazor circuits / `SharedAppState` singleton**: remote control works because both phone and operator
  circuits live in one server process. Need behind it: a server-side, real-time shared session state with
  multiple writers (owner, controllers) and many readers. New stack: a live-session service (Durable
  Object / in-memory on Node) with WebSocket fan-out.
- **`SessionChange` events + `CircuitCulture.Restore`**: culture bleeding between circuits; not a requirement.
- **Two LivePanel instances rendered and CSS-hidden** → `LiveOutputsState` scoped owner, double attach
  guards, duplicate `<audio>` ids. Need: one source of truth for this machine's outputs.
- **BroadcastChannel roll call / `window-alive` / pagehide**: needed because operator state dies with the
  circuit; need: a reloaded operator page must find and control already-open live windows.
- **Synchronous `openLiveWindowFromClick`**: Safari popup blocking after an await. Need: opening a window
  must work from a user gesture.
- **`PublicWatchPage` as static HTML + SSE**: to avoid a Blazor circuit per visitor. Need: cheap,
  auto-reconnecting push to hundreds of anonymous phones.
- **`MirroredSessionStateReader` equality, `SuppressForwarding`, joined `EnabledOutputs` string**:
  loop prevention between server replica and device in a write-through design. Need: absolute
  commands, owner echo is truth, no echo loops. A local-first rewrite may model this as owner-published
  state + controller intents.
- **Hashed device session id**: ids appear in anonymous URLs; need: a stable, non-secret-leaking session
  address per device.
- **`ImageUrlHelper.HostUrlTransform` / `gpmedia://`**: MAUI media scheme.
- **Electron kiosk/frameless/WorkArea juggling, Wayland title prefix**: need: projector window
  fullscreen on the non-operator display.
- **Presentation API (Cast) for "Extern skärm" on web**: need: a second-screen output from a browser.
- **Wake lock** in operator, live window and stage: need: devices must not sleep while live.
- **`TouchSession` on reads, `SweepStaleSessions` piggybacked on the reaper**: eviction plumbing.
- **CCLI `SetCcliReportedElsewhere`**: avoid double counting when two hosts see the same session.
- **SignalR hub path exemption from language redirect** (`LiveSessionHubIntegrationTests.cs:467`).

## Open questions

1. **No authorization on `/live` and `/display`** (anonymous pages); anyone with an 8-hex session id
   (web) can watch a session, and anyone can open `/display?id=<any string>` to register a "display"
   online. Is this acceptable, or should live windows carry a capability token?
2. **No permission for remote control or starting a presentation** beyond org membership (ADR 0004 calls
   this a pre-existing gap). Should controlling require ManagePresentations or an explicit grant?
3. **Browser Stop doesn't release outputs** while superadmin/mirrored End does — intended?
4. Content edits during live are not reflected on outputs until reselected (LIVE-R22). Should the
   live slide rebuild on presentation/song change?
5. **Bible text is rendered as raw HTML on the anonymous public page** (`PublicSlideView.razor:39`). Is
   Bible part content guaranteed server-generated/sanitised, including via sync push?
6. Black screen and "Rensa": the button toggles but is hidden when black — is the toggle semantics (vs.
   pure "clear") intended? A separate "show again" exists in resx (`StageMode.RestoreScreen`) but is unused,
   as are `StageMode.ScreenIsBlank`, `PresentationNotActive`, `NoNextSlide`, `SlidesInSong`,
   `Display.StableIdInstructions`. Leftovers or planned?
7. There is no "logo" screen; only black. Wanted?
8. Audio remote commands are not carried to mirrored desktop sessions (`MirroredSessionCommand` has no
   audio), and only execute if the presenter's page is open. Gap or intended?
9. Audio continuity across Stop: Stop re-registers the selected audio as non-live audio in a different
   DOM container — does playback continue or restart? Unverified.
10. `UpdateDisplayAsync` (rename) exists in the service but no UI uses it; name length is not validated in
    the service/UI for create (DB limit 200; sync push validates). Adding when at the 50 limit throws
    unhandled in the admin page.
11. `RemoteDisplayPairing.razor` is unused (older manual-code component).
12. Saved output config is per browser, not per org/presentation/user — switching organisations on one
    browser restores ids that don't exist (ignored). Intended?
13. Public render ordering under rapid changes is not sequenced (stale publish possible).
14. Paired-screen idle timeout (4 h) and session timeout (4 h) are checked lazily — is a 4 h service
    with no slide changes realistic enough to break a screen binding?
15. `TouchSession` on every read keeps sessions alive while any projector/public reader exists — so a
    forgotten browser session with an open projector never expires. Intended?
16. Single instance only; the rewrite on Cloudflare Workers needs an explicit placement (one Durable Object
    per org/session) — confirm.
17. On the web the same tab can present one presentation at a time; switching presentations mid-live
    silently moves the session (LIVE-R9). Should the UI warn?
