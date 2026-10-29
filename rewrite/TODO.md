# TODO

Smaller things decided or wished for, not yet built. The larger steps are in docs/next-steps.md.

## The small differences from the current app

Lars wants every small difference between the rewrite and the Blazor app on `origin/main` fixed (2026-10-29),
such as dropping files. Next, in a session of its own: go through the current app page by page and dialog by
dialog (behaviour, dragging and the keyboard, texts, look; the `old-app-compare` skill), and write the
differences here as a checklist per page, each marked small, medium or large. No code in that session, and no
decision on behaviour without asking Lars. Then one session per item, or per page.

Start from [Not done yet](docs/not-done-yet.md) and [Look](docs/look.md), but check them against the current app.
Known already: dropping files onto the add dialog and the overlay page; an overlay saving 500 ms after typing
with "Sparad"; the 500 ms fade of the black screen; Idag/Kommande and "last changed" order on the start page;
the `n` shortcut and the keyboard in the template picker; the templates page ordered by last changed; event
time, place and description; multi-select removal; the keyboard help dialog; the song editor inside the add
dialog; the clash warning of D18; `?stage=true` in the remote link; a saved screen whose session ended showing
its name rather than black. Larger, and not small differences: the labels page, song history, CCLI, profiles.

### The inventory (2026-10-29)

From reading the code of both apps, page by page; S small (under an hour), M medium (hours), L large (a day,
or a model or sync change). **ask**: Lars decides before it is built. Old paths are under
`GospelPresenter/GospelPresenter.Shared/` on `origin/main`, its Swedish texts in
`Resources/Localization/SharedResource.sv.resx`. The known items above are not repeated. Left out as
deliberate (docs, spec decisions or code comments): live as its own page, the song editor as a page, PDF-only
slides, D13, D15 (the dialog never closes), D17, D24 (Bibles and templates for admins), the popup instead of
the Presentation API, the remote link's path, the overlay picture from Bilder, the host's Enheter page, no
user detail page, the invite as `#token`, passkeys, the Församlingen page.

**Lars's answers (2026-10-29).** These settle the **ask** marks they touch; the rest are still open.
- Texts and look follow the old app as they are, with no question per text: "Radera", "Nu visas", "Avsluta
  presentation", "Sök...", Skärmar by when created, and so on.
- What the new app has and the old lacks stays: the search in Bilder and Ljud, the "Offline" badge, the device
  name in "Visas just nu", e-mail and invite state on a user's row, the import toast, the organisation in the
  account menu.
- Keys follow ProPresenter, not the old app: ↑ ↓ change item anywhere on the editor and the live page (not only
  with focus in the list); ← → and Space step slides live. The start page's list and the Bible pickers get
  arrows, Home and End with focus in the list. Then a session of its own: good shortcuts with ProPresenter as
  the starting point (letters to jump to a song's parts, such as C for chorus; `b` for blank would move).
- An image item holds several pictures, as in the old app (Bilder picks several, the editor reorders and
  removes them). L
- Audio keeps playing while you look at other items, and stops when another slide is shown live, or on
  Avsluta.
- The stage view controls everything, so you never have to leave it; an audio item shows itself properly there
  with its controls.
- One output window is enough: no "Lägg till utgång" menu, no several windows.
- Avsluta closes the output window, as in the old app (look.md's "as before" is wrong and is fixed with it).
- The conflict toasts come back, those that fit the new sync. M–L
- A user detail page as in the old app: name, e-mail, role, logins, invite, delete. L
- The editor selects the live item on open, or else the last selected; a red pulsing live dot on its row; a
  toast "Presentationen har uppdaterats" when another session changes it.
- The start page shows 20 at a time with "Visa fler"; the trash link only when there are presentations; a live
  row still goes to the live page; taking a screen from another session still asks.
- A Bible start verse alone stays one verse, as now.
- The desktop updater ("Starta om för att uppdatera") waits for the packaging of the desktop app.

- Skärmar shows each section only when the host can (`PairedDisplays`, `PublicOutput`), as in the old app.
- Töm empties the trash in one change, not one per entry.
- Spara som mall waits for the write, as now (a local write is too quick to notice).
- The add dialog's song list: measure with about 3 000 songs first, and virtualise only if typing or scrolling
  is slow.

- Skapa on Sånger stays visible always, as now.
- The add dialog's footer shows always, as now. Only Ctrl/⌘+Enter adds; Shift+Enter goes (the dialog no longer
  closes, so one key is enough), and plain Enter stays inert, since a new user may press it to search. The tip
  becomes "Ctrl+Enter lägger till…" (⌘ on a Mac). Spec D15 changes with it.
- The Bible tab keeps its preview.
- Unhandled errors: "Ett oväntat fel har inträffat." with Ladda om, as in the old app; the raw text only in the
  console.
- An audio item in the stage view: its name as title, the big box shows the audio icon with the player (play and
  pause, seek bar, times, Tona ut), and the strip and Nästa show as usual, so you can go on from there.

**A bug, fixed.** Ta över (`live.takeOverText`) had its names swapped: the old text is `"{presentation}" sänder
till "{output}"` (LivePanel.razor:483).

**Shell, top bar** (Layout/MainLayout.razor, Components/SyncStatusIndicator.razor → `Shell.tsx`)
- [ ] The sync icon is a button, a click syncs now; new: a plain div. S
- [ ] A spinner after 1.5 s of syncing; new: none, and `useDbStatus` has no syncing state. M
- [ ] Tooltip "Synkad / Synkar… / Offline / Logga in igen för att synka / Synkfel · N ändringar väntar · Synka nu";
  new: "Ansluten"/"Offline", no "Synka nu". S
- [ ] The pending dot at `-top-0.5 -right-0.5`, hidden while spinning; new: `top-0.5 right-0.5`. S
- [ ] Five conflict toasts (merged, output code replaced, song version saved, server version kept, change
  rejected); new: one yellow line with the server's raw error code. M–L, **ask**
- [ ] "Starta om för att uppdatera" (UpdateAvailableIndicator.razor), hidden while presenting; new: none. L, **ask**
  (needs an updater in Electron)
- [x] Unhandled errors: a yellow bar at the bottom, "Ett oväntat fel har inträffat." with Ladda om; new: the raw
  text in the top bar, no reload. S, **ask**
- [ ] The account menu adds the organisation as a third line, and the button has a tooltip; old: neither. S, **ask**

**Dialogs, menus, buttons, toasts** (Dialog.razor, Modal.razor, Dropdown.razor, AppButton.razor,
ToastContainer.razor, utils.js → `ui/`)
- [x] A click on the backdrop closes a dialog (utils.js:270); new: nothing. S
- [x] Focus is trapped (native `showModal`); new: Tab leaves the dialog. S–M
- [ ] Dialogs fade out in 200 ms; new: gone at once. S _Not done: a close that waits 200 ms undoes the page opening the dialog again meanwhile; dialogs fade in only._
- [x] Delete confirmations: title "Radera", the name in bold, "Raderar..." while working
  (ConfirmDeleteDialog.razor); new: a title per page, no bold, no busy text. Every page that deletes. S
- [x] A dropdown flips up or shrinks when it does not fit (utils.js:563); new: always down, always `right-0`. M
- [x] One toast at a time, 3 s, 200 ms fade out; new: stacked, 4 s, no fade. S
- [ ] Cancel and Danger buttons have no disabled style in the old app; new: every pill dims. S _Left as is: a disabled Avbryt or Radera that does not look disabled reads as a bug._
- [ ] "Laddar..." while a list loads (start page, Bilder, Ljud, Overlays, Mallar, Skärmar, Användare, Papperskorg, _Done on the start page and Mallar; the others with their pages._
  the add dialog's tabs, a song); new: nothing. S
- [x] The keyboard rules of utils.js:1269 (no auto-repeat, not during IME, in a text field only Ctrl/Cmd keys and _Built as `ui/shortcuts.ts` (`usePageKeys`), used by the start page and the editor._
  Esc, Cmd = Ctrl) as one shared mechanism; needed with `n` and `?`. M

**Start page** (Components/Dashboard.razor, PresentationRow.razor → `pages/Presentations.tsx`)
- [x] ↑ ↓ Home End move through the whole list, one tab stop (roving tabindex); new: every row a tab stop, no
  arrows. M
- [x] "Visa fler", 20 at a time; new: all. S, **ask** (local data)
- [x] Skapa's tooltip "Skapa (N)". S
- [x] A live row links to the editor; new: to the live page. S, **ask**
- [x] The date tooltip has no year in Kommande; new: always a year. S
- [x] "Visas just nu": sorted by name, "Aktiv presentation" when the name is unknown, no Ta kontroll without an
  id; new: server order, no fallback, and an extra line with the device name. S, **ask** (device name)
- [x] The trash link only when there are presentations; new: always (a comment says on purpose). **ask**
- [x] New: a grey "Offline" badge on kept presentations; old: none. **ask**
- [x] The template picker's close button: `top-4 right-4 size-8`, no background, X `size-5`. S

**Create and details dialogs** (PresentationDetailsDialog.razor, TemplateDetailsDialog.razor, NameDialog.razor)
- [x] `max-w-2xl`, `space-y-3`, no close button; new: `max-w-md`, `space-y-4`, a close button. S
- [x] Name with a hidden label (placeholder "Namn"); new: a floating label. S
- [x] Date as a grey pill with a calendar icon on one row with time and place; new: a full-width floating
  field. Goes with the known time and place. S
- [x] Tema: label above, `SimpleSelect w-fit`; new: a full-width floating select. S
- [x] "Skapar..." on the button while saving (presentations, songs, overlays, templates); new: only disabled. S
- [x] Enter submits only from the name field, and only when it is not empty; new: from any field. S
- [x] Mallar's create dialog: day, time and place as plain selects and inputs; new: floating fields. S
- [x] Spara som mall closes at once; new: waits for the write. New also selects the name on focus. S, **ask**

**Presentation editor** (Pages/Presentation.razor, Sidebar.razor, PresentationHeader.razor, SlideGrid.razor →
`pages/presentation-editor/`)
- [x] ↑ ↓ act only with focus in the list, focus follows the selection, Home End, one tab stop; new: ↑ ↓ on the
  whole page (outside text fields), so ↓ in the right pane changes item. S, **ask**
- [x] The selected row scrolls into view and the right pane scrolls to the top on select. S
- [x] Arrow keys also close the phone menu. S
- [x] On open, the item shown live is selected, or else the last selected; new: none. S, **ask**
- [x] A toast "Presentationen har uppdaterats" when another session changes it; new: silent. S, **ask**
- [x] A red pulsing live dot on the row being shown (and its 8 px slot); new: none. S, **ask**
- [x] Row icon `size-3` with `space-x-3`; new: `size-4`, `gap-3`. The ⋯ menu `w-56`; new `w-64`. S
- [x] The date line shows "2026-11-01 10:00" with `mb-3`; new: "lör 1 nov. 2026". S, **ask**
- [x] Not found: "Presentationen hittades inte" in the sidebar, the page stays; new: a line over the page. S
- [x] The title is clickable only from `lg`; tooltip "Byt namn" (new: "Byt namn på programpunkten"); "Redigera"
  stays while renaming. S
- [x] Below `lg` the title floats over the grid with a gradient (`h-20`, `pt-16` on the grid). M
- [x] Starta presentation is hidden while this session presents, and has a title. S, **ask**
- [x] Nothing selected: a random quote or Bible verse (37 of them); new: "Välj en programpunkt i listan.". S
- [x] The empty text names images, audio and PowerPoint, with **Lägg till** in bold. S
- [x] Slides in the editor show no credits; new: credits. S
- [x] One column below 768 px, three to 1024; new: two from 640. S
- [x] An image item holds several pictures: Redigera/Klar to reorder, remove one ("Vill du ta bort den här _Redigera lays the pictures one under the other while it is on: the drag reorders a column._
  bilden?"), "Lägg till bilder"; removing the last removes the item. New: one picture per item. L, **ask**
- [x] The delete confirmation `max-w-sm` with a bold title. S

**Audio** (AudioPlayer.razor, utils.js:943 → `pages/live/AudioPlayer.tsx`, `audio.ts`)
- [x] Its own player: round play/pause, a thin sky seek bar with a knob on hover, "0:00" left and the length
  right, Tona ut always clickable with a spinner; new: `<audio controls>` in the editor, `input type=range` and
  "0:00 / –:––" live. M
- [x] Audio keeps playing when you change item, and after Avsluta; new: stops on both. M, **ask** _The live audio plays on until Avsluta; the editor's preview, which is not live, stops when the item is left._

**Add dialog** (AddItem/AddItemModal.razor → `AddItemDialog.tsx`)
- [x] Tabs are hidden, not unmounted: search, selection and scroll survive a tab change; new: reset. M
- [x] Tab tooltips "Sånger (Ctrl+1)" / "⌘1". S
- [x] Ctrl/⌘+1–5 work wherever focus is, and block the page's `a` and Delete behind the dialog. S
- [x] The search field gets focus only from 768 px, so phones get no keyboard; new: always. S 
- [x] A guard against double adds (double click, held Enter); new: none in Sånger, Bibeltexter, Bilder, Ljud. S

**Add dialog, Sånger** (Song/SongTab.razor → `SongTab.tsx`)
- [x] Empty library: "Hantera sånger" next to Skapa, centred over the whole tab, no preview. S
- [x] Clearing the search selects the first song; the arrows scroll the row into view; a new search scrolls both
  panes to the top. S
- [ ] The list is virtualised (`Virtualize`, 56 px). M, **ask** _Not measured yet._
- [ ] The preview highlights the search terms in title, author and slide text. S–M _Title and author done; the slide text not (SlideView has no highlight)._
- [x] The footer only when a song is selected (D15 shows the tip always). **ask**

**Add dialog, Bibeltexter** (Bible/*.razor → `pages/BibleTab.tsx`)
- [x] Book, chapter and verse pickers: roving tabindex, arrows (chapters a grid), Home End. M
- [x] Verses listed with their whole text (`px-3 py-2`, number in sky); new: number buttons only. M
- [x] The whole chosen range is marked, across chapters; new: only the last verse. S
- [x] The book name in the crumbs reopens "Välj bok"; an orange "_" placeholder ("Joh 3 : _", "3:16 — 3 : _"). S
- [x] Search and the translation select hide while browsing; the select shows the name, not the abbreviation. S
- [x] Start and end verse are both needed (click a verse twice for one); new: the start alone. S, **ask**
- [x] The book picker has `mt-4` and its own scroll box. S
- [x] No preview in the old tab. look.md keeps the new one; listed only to confirm. **ask**

**Add dialog, Bilder and Ljud** (Image/ImageTab.razor, Audio/AudioTab.razor)
- [x] Bilder: several pictures selected (click toggles) become one item "N bilder", toast "{0} bilder har lagts
  till"; new: one picture. Goes with the editor's image item. L, **ask**
- [x] Importera inside the tab, "eller släpp filerna här", "Importerar {0} av {1}...", the failure line. M, **ask**
- [x] A ⋯ menu per picture or file with Radera (to the trash, with a toast). S–M
- [x] Bilder: arrows in the grid, Ctrl/Shift+Enter adds; new: no keys at all. S (Enter), M (arrows)
- [x] Ljud: select a row (sky check, `ring-sky-500 bg-sky-50`), add with "Lägg till <namn>" in the footer, arrows,
  Home End, Enter, Ctrl/Shift+Enter; new: a "+ Lägg till" per row, no keys. M
- [x] Texts: "Inga bilder än", "Inga ljudfiler än", "Lade till {0}". S
- [x] New has a search field in both; old has none. **ask**

**Dropping files** (DropZone.razor, utils.js:1355 → `ui/DropZone.tsx`)
- [x] The frame only when the drag holds files; new: also for dragged text. S
- [x] A file dropped outside a zone does not navigate away from the app. S
- [x] Filter by `accept`, one file for a single target, toast "Den filtypen kan inte användas här". S
- [x] Default label "Släpp filerna här"; `dropEffect = copy`; no frame when disabled. S

**Songs and the song editor** (Pages/Admin/Songs.razor, SongEditor.razor and its parts → `Songs.tsx`, `SongEditor.tsx`)
- [x] Skapa only when the list has hits (new: always, on purpose while import is missing). **ask**
- [x] `maxlength` on every field (AppConstraints); Year a number field with min and max. S
- [x] "Lägg till del" scrolls to the new part. S
- [x] A missing song redirects to the list; new: "Sången finns inte.". S, **ask**
- [x] An empty part's chip is an empty pill; new: "...". S

**Live panel and outputs** (LivePanel.razor → `pages/live/LivePanel.tsx`, `OutputsPanel.tsx`)
- [x] "Nu visas"; new "Visas nu" (assumptions.md uses the new one). S, **ask**
- [x] "Avsluta presentation" with a title, outside the scroll area so it always shows; new: "Avsluta", inside. S
- [x] An overlay row has its title as tooltip. S
- [x] "Ta över" with an unknown name has its own text (TakeOverMessageUnknown); new can show `""`. S
- [x] Order: Extern skärm, saved screens, public outputs, windows, temporary screens; new: mixed. S
- [x] A public output has a QR icon. A saved screen offline: struck-out icon in neutral-300, no switch; new: a
  disabled switch and "Offline". S
- [x] A saved screen used by another session is taken without asking; new asks. S, **ask**
- [x] "Lägg till utgång" menu with Fönster and Anslut tillfällig skärm; several windows "Fönster (n)" each with ✕;
  new: one window. M, **ask**
- [x] ✕ on a temporary screen: "Koppla från". S
- [x] Wake lock while presenting. S

**Live page** (`pages/live/LiveView.tsx`)
- [x] The old page has no global step keys: arrows move focus between slides, Enter shows one; new: → ↓ PageDown
  Space and ← ↑ PageUp step across items, `b` blanks. **ask** (keep the new keys?)

**Output window** (Pages/Live.razor → `pages/Output.tsx`)
- [x] A click asks for full screen; wake lock; the title from `?title`. S
- [x] Avsluta closes the window (utils.js:331); new: black. look.md says "as before", which the old code
  contradicts. S, **ask**

**Stage view** (StageView.razor → `pages/StageView.tsx`)
- [x] An audio item: its name as title, the icon and "Ljud spelas" over the picture, Rensa, Nästa and the strip
  hidden, the audio not started; new: plays it but keeps the previous item's title, strip and Nästa. M, **ask**
- [x] When blank, Nästa still shows the next slide and the strip marks the part (`ring-2 ring-sky-400`); new
  says "Inget mer i den här programpunkten", which is wrong then. S
- [x] Nästa with nothing next is an empty box; new: a text. S
- [x] "Välj" as the picker's title; tooltips "Visa/dölj overlays", "Byt", "Rensa". S
- [x] A click on the dark backdrop closes a sheet; keys step even with a sheet open. S
- [x] The strip scrolls smoothly; the wake lock is taken again when the page shows; an item without slides
  still goes live at part 0. S

**Paired and public screens** (Display.razor, PublicWatchPage.razor → `Display.tsx`, `Watch.tsx`)
- [ ] A temporary screen with `?name=` shows the name above the code; `webkitRequestFullscreen` fallback. S
- [ ] `/watch`: `theme-color #000`, Apple web-app metas, black `html`/`body`; Bible text without
  `whitespace-pre-wrap`. S

**Remote control** (Presentation.razor remote part → `RemoteLive.tsx`, `RemotePanel.tsx`)
- [ ] The hint under the button when the presenting computer is gone ("Om datorn inte kommer tillbaka…"), and
  that state checked before "inte aktiverad". S
- [ ] Status text colours swapped; session picker Primary Filled; "inte bekräftat" as a warning toast. S

**Bilder, Ljud, Biblar** (Pages/Admin/Images.razor, Audios.razor, Bibles.razor)
- [ ] ⋯ menu "Radera"; new "Ta bort". Search "Sök..."; new "Sök". S
- [ ] New adds a toast "{n} bild(er) importerade"; old has none. S, **ask**
- [x] The drop zone has no `min-h-[60vh]` in the old app. S
- [x] Ljud: a too long file name gives an image error text (`images.failedName`, `images.failedOther`). S
- [ ] Biblar: `<code>.zip</code>`; verse count "31102" (new "31 102"); delete title "Radera"; order undefined in
  the old app, new by name. S

**Overlays** (Pages/Admin/Overlays.razor, OverlayDetail.razor)
- [ ] The create field is "Namn"; new "Titel". The list shows the whole text cut short; new: the first line. S
- [ ] Unknown id goes back to the list; new: "Overlayen finns inte.". A delete shows no toast. S, **ask**

**Mallar** (Pages/Admin/Templates.razor)
- [x] The trash button is Neutral (grey background); new `cancel`. S

**Skärmar** (Pages/Admin/Displays.razor → `Displays.tsx`)
- [ ] Ordered by when created; new by name. S
- [ ] The explanations only inside the empty card, other words; new: always above the card. S, **ask**
- [ ] The add button "Lägg till"; new "Skapa". Row delete "Radera"; new "Ta bort". S
- [ ] Each section only when the host can (`PairedDisplays`, `PublicOutput`). M, **ask**

**Användare** (Pages/Admin/Users.razor, UserDetail.razor → `Users.tsx`)
- [ ] Name and e-mail of an existing user cannot be changed in the new app. L, **ask**
- [ ] All three role texts with bold labels, and other words; new: only the chosen role's. S, **ask**
- [ ] The empty text "Lägg till användare i din organisation…". "E-postadressen används redan…" checked
  before creating. S
- [ ] New shows e-mail, invite state and "Du kan inte ändra din egen roll" on the row. **ask** (keep?)

**Papperskorg** (Pages/Trash.razor)
- [x] "Radera permanent" with "Raderar..."; new "Radera". S
- [ ] Permanent delete texts for a presentation and a picture differ. S, **ask**
- [ ] Återställ locks only its own row; new: all. S
- [x] Töm is one call; new: one mutation per entry. M, **ask**

**Mina inställningar, Setup, Inbjudan, Logga in**
- [ ] Settings: "Om" with the app version. S
- [ ] Setup: the description ends in a list of three; other help text under the code; one error at a time and
  "Installationskoden måste fyllas i.". S, **ask**
- [ ] Invite: "Välj hur du vill logga in", the first way with the rest behind "Fler alternativ", the
  organisation line only when known. S, **ask**
- [ ] Sign-in: `pt-16` above the version; new `pt-12`. S

**Seen in the pictures** (`scripts/compare-old-app.mjs`, light, desktop and phone, ten pages looked at)
- [ ] Stage view: the old current slide is smaller with more room around it, and its label is upper case
  ("VERS"); the strip's tiles show their labels. S
- [ ] On a phone the add dialog's song preview is a sheet over the dimmed page; new: full screen white. S
- The label texts differ ("Vers" against "Verse 1") because the old mock data is Swedish; not a code difference.

**Not settled by reading:** the pages not looked at side by side (dialogs, admin pages, dark mode); whether a deleted
display or a new code drops its viewers at once, as the old `DisconnectOutput` does; whether the old trash
filters by role; whether the server's taken e-mail error is `email-taken`; whether the new song search ranks
as the old `ScoreMatch`.
