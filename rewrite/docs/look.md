# Look

The web app is to look as the current Blazor app does (its `main` branch, not the pictures in `docs/public`),
on every screen size, light and dark. It uses Tailwind v4 (`@tailwindcss/vite`), set up as the current app's
`tailwind-input.css` (`apps/web/src/app.css`). Dark mode is the current app's: the class `.dark` on `<html>`,
the choice in localStorage `theme` (`light`, `dark`, `system`; the system's when none), chosen under Mina
inställningar (`/settings`) and applied before the first render (`apps/web/src/ui/theme.ts`). The shell is
`MainLayout.razor`'s top bar (logo to the start page, Beta, both replaced by "‹ Presentationer" in a presentation, the sync's cloud, the cog to the admin pages, the
user's menu) and `AdminLayout.razor`'s side menu (`apps/web/src/Shell.tsx`). Unlike the current app, the admin pages
open in a dialog over the page the user is on (`PageDialog` in `ui/Dialog.tsx`; docs/assumptions.md), as the
settings of Lars's other apps (bygg, piano): at most 896 px wide and 768 px high, a narrow menu, and the pages filling
the rest (`PageFill` in `ui/PageContainer.tsx`); full screen on a phone. Om Gospel Presenter (`pages/About.tsx`)
is last in the menu, at its foot, as in those apps: the version, and links out, which the desktop app opens in
the system browser. The shared components are in
`apps/web/src/ui/`: `AppButton` with the current app's variants (the only place a `<button>` is made; the lint
rule says so), `Dialog`, `Modal`, `FloatingInput`/`Select`/`Textarea`, `PillTabs`, the lists, `Dropdown` and
`PageContainer`. The start page (`pages/Presentations.tsx`) is `Dashboard.razor`: Idag, Kommande and the rest.

The presentation (step 2) is `Pages/Presentation.razor` and what it uses: the running order in a white side
column (`Sidebar.razor`; an item is dragged by its handle at the right, and the selected one has a ⋯ menu with
Ta bort), the slides as rounded tiles (`SlideGrid.razor`, `ui/SlideTile.tsx`), the green
Starta presentation, the add modal with its pill tabs and round search (`AddItemModal.razor`, `ui/Picker.tsx`),
the live page's panel at the right (`LivePanel.razor`: Nu visas, Utgångar, Overlays, fjärrstyrning as
switches in `ui/Toggle.tsx`, Scenläge, the red Avsluta) and the dark stage view with its bottom sheets
(`StageView.razor`). Live is the editor presenting, as `Presentation.razor` (Lars, 2026-10-30): `/presentations/{id}`
presents in place (Starta presentation and Avsluta stay on the page; a reload goes on presenting; `/live/{id}`
from before opens it too) with the running order, so items are added, removed and moved while live; the main area shows the
selected item's slides, a click shows one live, and the item shown live is selected as the slides step on.
Below `lg` (a phone) it is laid out as the current app's: the running order is a drawer from the left, open when
the page opens and closed by choosing an item or tapping the dimmed page, with the round menu button at the bottom
left and Starta presentation at the right; live's panel floats at the bottom right and folds to its caption and a
small picture; and a song tapped under Lägg till opens its preview full screen, with ✕ (or Escape) and its own add
button, while Bibeltexter keeps its preview in the tab. Presenting, the drawer is closed when it starts.

The songs (step 3) are `Pages/Admin/Songs.razor` and `SongDetail.razor`: the list in a light card with
Papperskorg and the round search, marks in yellow; the editor under `DetailHeader.razor`'s round back button
(`ui/PageContainer.tsx`), the fields as floating fields, a card per part with its label as a pill, ↑ ↓ and
the bin, and the arrangements as stacked chips, each dragged by the whole chip, with the dashed Lägg till del. Song history and the ProPresenter import are not built,
so their pages and buttons are missing.

A song's fields, its parts' text and its arrangements' names save 500 ms after the last keystroke, as
`Utils/Debouncer.cs` does there, and `AutoSaveIndicator.razor`'s grey "✓ Sparad" shows at the right of the
header after each save, fading after 2 s (`ui/AutoSave.tsx`). It also shows after a label, a chip or an
arrangement changes, as there. Unlike the current app, a waiting save is never dropped: it is written at once
when the field loses focus, the page closes or another page opens, and before a reload or a closing window. A
field shows what was typed while it has focus, so its own save coming back (trimmed) or a sync does not move
the cursor or take back a letter; once it is left, the stored value shows when it next changes. A blank name
and a year that is not 0–9999 are not written and say nothing; a refused write says nothing either. Each save
is a mutation of its own (`updateSong` with one field, `updateSongPart`, `updateArrangement`), so typing now
queues a few more mutations, which the sync sends together; nothing keeps a snapshot per write (song history
and CCLI reports are not built). Tested in `apps/web/test/debounce.test.ts` (the wait, flushing, failures, order)
and e2e in `milestone2.spec.ts` (Sparad, typing on through a save, leaving at once, reloading at once, a blank name).

A clash in a part (D18; the old app had none to copy): when a part's stored text changes from elsewhere while the
user has typed in it since giving it focus, and is not what they have, nothing more is written, and an amber
box under the part says "Någon annan ändrade den här texten medan du skrev. Deras text:" with the other text,
"Behåll min text" (written at once) and "Använd deras" (`warnOnClash` on `AutoSaveField`). Within the sync as it
is: the server keeps the last write, so whoever is still typing when the other's write arrives is the one
warned; one who already left the part is not, and the later write wins silently. Tested in
`e2e/song-clash.spec.ts` (two computers of one user, both choices).

The keyboard help (`ui/ShortcutHelp.tsx`, `KeyboardShortcuts.razor` and `ShortcutHelpDialog.razor`): `?` outside
a text field opens "Kortkommandon", with the old dialog's look and texts: the group of what is on screen, then
"Överallt" with `?`; `?`, Esc or × closes it. Groups: Startsidan (n, ↓, ↵), Presentation (a, F2, Del, ↑ ↓, and the
new Alt+↑ ↓), Lägg till (⌘/Ctrl+1–5, ⌘/Ctrl+↵, ↓; it hides the editor's group, whose keys are off behind it), and
the new Live (→ Space PageDown, ← PageUp, ↓, ↑, B) and Scenläge (its pedal keys; it hides Live's). The old
editor's → and ↵ through the slides are not listed: the new editor has no such keys. Keys with ⌘ and ⌥ on a Mac,
Ctrl+ and Alt+ elsewhere. Tested in `apps/web/test/shortcutHelp.test.ts` and `e2e/shortcuts.spec.ts`.

The admin pages (step 4) are `Pages/Admin/*.razor`, `Trash.razor` and `Profile.razor`: each a title row and
light cards (Biblar, Bilder, Ljud, Overlays, Teman, Skärmar, Användare, Enheter, the trash), the current app's
large grey pictures and small icons when a list is empty (`ui/Empty.tsx`), the dashed sky frame while files hover
over a page that takes them (`DropZone.razor`, `ui/DropZone.tsx`), the overlay under `DetailHeader` with
floating fields, the QR dialogs with the grey link field and its copy button (`ui/CopyField.tsx`), and the
trash under `DetailHeader` with its pill tabs. Inloggningsmetoder (`/logins`) is drawn as Min profil. Where the
new pages do more or less than the current ones (the user row's e-mail and invite state, the overlay's preview), they keep
what they do and only take the look. A public output's row is the current one's: the name, "Sänder från …"
under it while it sends, the viewer count ("0 enheter" too), Visa QR-kod and Ta bort; its link, the copy
button and Ny kod (under a line saying what it is for; the dialog closes after it) are in the QR dialog. The templates page and its
dialogs (`pages/Templates.tsx`), the picker on Skapa and the editor's sky banner take the current app's markup.
The user page (`/admin/users/{id}`, `pages/UserDetail.tsx`) is `UserDetail.razor` without the profile picture; its
invite card shows the link only right after Skapa (AUTH-R13), on a host as "Logga in som … här". The current app's
labels, CCLI report, API keys and super-admin pages have no counterpart yet.

Sign-in, setup, the invite and pairing (step 5) are `Login.razor`, `Setup.razor` and `InvitePage.razor`
(`pages/AuthCard.tsx`): the logo and the two-blue name, the fields as floating fields and the wide sky Kom igång;
the sign-in page in the middle of the screen over the slowly moving blue blobs (`animated-bg` in `app.css`), the
Google button white with its G; an invite that cannot be used as the old envelope picture without the logo.
Anslut till värddatorn has no counterpart and is drawn as setup. Anslut tillfällig skärm is
`PairingCodeDialog.razor`: the QR code in its white frame, "eller", the numbered steps, the grey address field
and the four large digit boxes, and the green tick when a screen is paired. `/display` is `Display.razor`'s
black page (the code huge in mono, the logo and name at the foot); `/watch` is `PublicWatchPage.razor`'s
three faint dots and `PublicSlideView.razor`'s slide, with the credits below the text rather than over it.
A paired screen draws the projector's canvas, as the output window (see [Paired screens](live.md#paired-screens)). Where the new pages do more than the
current ones (Avbryt and Stäng in the pairing dialog), they keep what they do and only take the look.

Where the look would change what the app does, Lars decided (2026-10-27) to follow the current app: Bilder and
Ljud trash from a ⋯ menu; the editor's details and delete are in a ⋯ menu by the name; Skapa is always under
Lägg till's songs; a song item has Redigera, to the song's page; the song's label and Lägg till del are a list of
coloured pills (`ui/SelectMenu.tsx`, an ARIA select-only combobox, usable by keyboard alone); Rensa and B only
blank, and Rensa is gone while black; Utgångar, Overlays and Fjärrstyrning fold, each with an "i"; sign-in shows
the first way in, the rest behind "Fler alternativ", and the version (the commit: there is no release number yet;
a build knows it only from `GP_COMMIT`, for a release build to set, so local and e2e builds show none); the canvas
is centred in a box that is not 16:9, by whole pixels so tiles do not move; text taller than the screen scrolls
on `/watch`, not on the output window or a paired screen.

Extern skärm under Utgångar is a switch, as there (`live/outputWindow.ts`): on opens the output window, off
closes it, and it shows whether the window is open, so closing the window some other way turns it off. In the
desktop app the main process reports each open and close (`output-changed`), and a reloaded page asks
(`output-open`); in a browser the popup is checked every 0.5 s, since a page has no event for it, and a reloaded
page shows it off until it is switched on again, which takes the open popup back by its name. Unlike the
current app the row is always there (with one display the output is a window) and a browser opens a popup,
not a Presentation-API receiver; there is no Esc in the output window, and Avsluta presentation closes it, as the current app's `Live.razor` does (Lars, 2026-10-29). A click in it asks for full screen, it keeps the screen awake, and it is named after the presentation.
A blocked popup says "Live-vyn kunde inte öppnas". Tested in e2e in Electron (`milestone6.spec.ts`: on, off,
closed by the window, a reload) and in unit tests for both kinds (`apps/web/test/outputWindow.test.ts`); the
browser's popup is not tested in a real browser.

Dragging, in the running order and an arrangement's chips, is the current app's SortableJS lists redone with
pointer events (`ui/sortable.ts`, no library): the mouse drags at once; a finger drags after holding still
150 ms, so a swipe still scrolls; the rows make room as the dragged one passes; near the edge of a scrolling list it
scrolls; Escape cancels. A drop is saved by the mutators the ↑ ↓ buttons used before (`moveItem`,
`moveArrangementPart`, moved `by` the places it passed), so sync is as before. The current app has no keyboard
way; here Alt+↑/↓ moves the selected item in the running order, and the focused chip in an arrangement (Tab
reaches each chip). Tested in e2e: the mouse and the keys (`milestone2.spec.ts`), and touch through Chromium's
touch input (`drag.spec.ts`); not on a real tablet or in Safari.

The move went in steps, and is finished: 1 the frame, the components and the start page; 2 the presentation
(editor, live, stage view, Lägg till); 3 songs; 4 the admin pages; 5 sign-in, setup, pairing, `/display`,
`/watch` and the output. Everything is Tailwind, except the slide itself: `apps/web/src/styles.css` keeps the
1920×1080 canvas's rules (`ui/SlideView.tsx`, and a verse number, also on `/watch`), in the CSS layer `slide`
below Tailwind's utilities. They are plain CSS on purpose: their sizes are the canvas's own pixels from spec 04
(LIVE-R17, R18), the theme's inline styles go on top of them, and what a screen shows should not move when the
rest of the app's look does.

`GP_CAPTURE=<dir> pnpm --filter @gp/desktop exec playwright test capture` takes a picture of every page, desktop
(1440×900) and phone (390×844), light and dark (`apps/desktop/e2e/capture.spec.ts`), to set beside the
current app's from `node scripts/capture-old-app.mjs <url> <dir>` with that app running in mock mode.
`GP_CAPTURE_ONLY=setup,login,…` takes only the named pictures. Pages with no counterpart in the current app
(setup, which mock mode skips, and Anslut till värddatorn) are taken in the new app only.
`node scripts/compare-old-app.mjs <dir> [name,…]` does both in one go: it adds the reference worktree
`../GospelPresenter-main-ref` if it is missing (detached at `origin/main`, after a fetch; one that is there is
used as it is), runs the current app in mock mode on a free port, takes its pictures into `<dir>/old`, stops it
(also on Ctrl-C), takes the new app's into `<dir>/new`, and lists the names found on one side only. Three pages
took 71 s, 4 s of it starting the current app after an earlier build.
