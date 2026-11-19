# The core on an iPad 3 with iOS 8.4.1

A spike (Lars, 2026-11-18): whether the Rust core (`crates/gp-core`) runs on a jailbroken iPad 3 ("the new iPad",
A5X, 32-bit armv7) downgraded to iOS 8.4.1, for a screen that shows song texts on an old iPad, as the Raspberry Pi
in `docs/native-slide-rendering.md`. Not a shell of the app: the presentations and their pages, read through the
core from an organisation synced from a desktop host (or the demo data), drawn with UIKit.

**Where it stands:** it runs. On Lars's iPad 3 (iPad3,3, iOS 8.4.1 12H321, jailbroken) on 2026-11-19 the app pairs
with the desktop host on the LAN, pulls the organisation into its own SQLite through the core, lists its
presentations and shows the next one's page: the items at the left, every item's slides at the right (below, "On the
iPad" and "Syncing"). Built at 8aad1883; the core's interface (`start`,
`resume`, UniFFI's `Step` and `SqlAnswer`) may change, and Core.m reads and writes it by hand.

## Why not the app itself

- SwiftUI needs iOS 13, `@Observable` iOS 17, and today's Swift iOS 12: the UI here is Objective-C and UIKit.
- The Swift that UniFFI 0.32 generates is too new for an old Swift; Core.m calls UniFFI's C functions instead.
- The web neither: Safari 8 has no WebAssembly (iOS 11) and too little of the JavaScript the web is built to.
- Xcode 11, the last to build for iOS 8, does not run on Apple Silicon, and Catalina (Intel only) cannot be
  virtualised there. None is needed: today's clang and ld build and link armv7 for iOS 8 given an old SDK.

## What it takes

1. **The core** (`build-core.sh`): Rust nightly, `-Zbuild-std`, and a target of our own (`armv7-apple-ios.json`, the
   armv7s target's with a Cortex-A9 and VFPv3), since Rust has dropped `armv7-apple-ios` and armv7s code needs an A6.
   No thread-local storage (iOS 8 has none for apps; std uses pthread keys). gp-core is built from a copy as an rlib
   only: as a cdylib, rustc panics linking it for armv7. rustc writes iOS 10.0 into the objects, its lowest.
2. **SQLite** (`build-core.sh` too): iOS 8's own is 3.8.5, older than the core's SQL. The amalgamation the repository
   already has through `pnpm install` (better-sqlite3's, 3.53.4), as ARM code, one thread, no locking styles (their
   `gethostuuid` is not in iOS). And the demo data, `demo.sqlite`, as `apps/mac/apple.sh` takes it, copied into
   `app/Resources`.
3. **The SDK**: Theos's `iPhoneOS9.3.sdk`, its .tbd files made armv7-only and libsystem_c's given the memory and
   string functions it leaves out (`sdk-armv7-only.py`, which says why).
4. **The app** (`app/`, Theos): `clock.c` gives Rust's std the `clock_gettime` iOS 8 lacks (iOS 10); the Makefile
   turns off a module-map warning the old SDK sets off, and `objc_alloc`, which iOS 8 may lack, and builds the app's
   own code as ARM, not Thumb (`-marm`): today's ld leaves out the Thumb bit on a pointer to a Thumb function, both in
   `LC_MAIN` and in the Objective-C method lists, so dyld and UIKit would jump into Thumb code in ARM mode. The core's
   Rust is ARM already (no `[Thumb]` symbol in the library). `Info.plist` gives the app a URL scheme, `gpcore8://`,
   so that it can be opened over SSH.

The app: `Core.m` runs a call of the core to its end as the native shell's `Core.call` does, each statement it asks
for answered from SQLite; `AppDelegate.m` copies the demo data afresh on every start, runs `migrateOrgSchema`, and
reads `presentationsView` and the first presentation's `presentationPageView`; `PresentationController.m` is the page
with iOS 8's own parts, after the Settings app on an iPad: a UISplitViewController with both columns shown (the left
320 pt) and iOS 8's button that folds the left one away, each column in a navigation controller; at the left the
running order as a grouped table of one group, the day and time over it, every item a row with a 29 pt icon in its
type's colour and a song's number of slides, a programme point (type "header") a row as much as a song (Lars); at
the right the slides on the grouped table's grey, tiles 300 to 384 pt wide (the web's SlideGrid stops at 340; Lars: two columns lying down), each item a
section headed as a grouped table heads one. A row scrolls to its item's slides; the slides scrolled select their row and name the right
column, as Settings names it after the row chosen; a tile tapped is outlined in the tint, the web's sky. `SlideView.m`
draws a slide into a picture, once (below): the theme's background, the text in the theme's area at the theme's size made 5 % smaller at a time
until it fits (not the web's fitting), the part's label in a corner. Media show their kind and title: their files are
not on the device. Nothing is presented. A row's item comes to the top at once, not scrolled to (Lars: the slides
rushing past made him dizzy). `art.m` draws the app's icon on the Mac, Gospel Presenter's logo
(`website/public/logo.svg`) on white as the desktop app's icon has it, and its launch images, upright and lying down:
the page's empty frame (`build-core.sh` runs it). It supports all four orientations, as an iPad app should. Opened
with `gpcore8://picture` the app writes a picture of its window as it stands (without the status bar) to
/tmp/gpcore8.png, and with `gpcore8://item/<n>` it taps row n first and writes one a
second later, and with `gpcore8://open/<presentation id>` it opens another presentation, so that a check over SSH
can drive the page and see it.

**Scrolling at 60 frames a second** (Lars: no jitter, no stutter). `gpcore8://scrolltest/<pt a second>` scrolls the
slides (`…/list`: the running order) down and up for 5 s, a step on every frame the display shows (ScrollTest.m;
the table below is from its first form, once from the top to the end), and logs two sides: the
app's, frames that came late to the main thread (CADisplayLink), and the render server's, which composites the
layers on the GPU, frames drawn (QuartzCore's private `CARenderServerGetFrameCounter`, what FPS meters for jailbroken
devices read, looked up at run time). The main thread was never late, before or after; the GPU was:

| Lying down, 1200 pt/s                                        | first time through | again    |
| ------------------------------------------------------------ | ------------------ | -------- |
| Tiles as views, clipped rounded corners, translucent bars    | 48.9 fps           | 51.2 fps |
| Each slide a picture drawn once, opaque bars                 | 55.7 fps           | 59.8 fps |
| The same, every picture drawn ahead on a thread of its own   | 59.6 fps           | 59.6 fps |

At 3000 pt/s, a flick's speed, 59.5 fps (122 frames drawn of 123). What it took: a slide is drawn once into an opaque
picture at the tile's size in pixels (`GPSlideImage`, kept in an NSCache by a SHA-1 of the slide as the core gives
it, the theme's definition, the title and the size, as Thumbnails.swift keeps its by content: kept by the slide's key,
a song's text edited on the Mac came over by the sync but the old picture stayed), its rounded corners and label drawn in,
so that the GPU only moves pictures: no clip to a rounded corner (an offscreen pass per tile, per frame), nothing to
blend, nothing to scale; the navigation bars opaque, since a translucent one blurs what scrolls under it anew on
every frame; and all 54 pictures drawn after the page shows, on a thread of their own (0.7 s), so that the main
thread does not draw one as it scrolls into view. The before was the commit before this one, built with the same
test; it ran 10.6 s, not 5.1, since its 340 pt tiles stood in one column, not two.

The running order (Lars: as fast) needed nothing: on the demo's longest presentation, 27 items
(`gpcore8://open/pres-6` opens it), the render server drew 298 of 300 frames at 600 and at 1500 pt/s, as it does for
the slides at 1200 and 3000 pt/s with the same 5 s test: the 2 missing in every run, whatever moves and how fast, are
the test's start, not a stutter.

**Syncing** (Lars: real presentations), from a desktop host on the LAN over plain http:
`GP_DEV_PAIR=1 GP_LAN=1 pnpm --filter @gp/desktop start` on the Mac (after `pnpm build`), which listens on
0.0.0.0:47800 and keeps its data in ~/Library/Application Support/Gospel Presenter. `Sync.m` does what the native
shell's `Pairing` and `SyncClient` do (Server.swift, Sync.swift): `/api/pair/status`, then `/api/pair/dev` (or
`/api/pair/claim` with the six-digit code a host without `GP_DEV_PAIR` shows), the organisation's own SQLite opened
with `migrateOrgSchema` and `syncOpen`; a change run at once and queued by `syncMutate`, the queue (`syncPending`)
sent to `/api/sync/push`, and every page of `/api/sync/pull` rebased by `syncRebase` in one transaction, push then
pull, coalesced to one run and one waiting; the core called as the signed-in member (Core.m's `GPCoreCallAs` writes
UniFFI's `Option<Caller>`); syncing stopped for good on "update-required" and credentials the host no longer takes.
The poke socket (`/api/sync/poke`) with a WebSocket client of our own (WebSocket.m; NSURLSession has one from iOS 13
only) over NSStream: RFC 6455's upgrade, the accept key checked with CommonCrypto's SHA-1, frames of every length,
fragments joined, ping answered by pong, a close answered, everything sent masked; the credentials as headers
(`Authorization`, `x-gp-device`), which a native client can send and a browser cannot, and `gp.v1` as the
subprotocol. As Sync.swift's `start`: a sync when it opens and on every poke, another try 3 s after it closes, a sync
every 5 minutes as a backstop, a refused socket followed by a sync to tell offline from refused credentials; closed in
the background, opened again in front. A sync that changed rows reads the start page again and shows the open
presentation again (from its top: its scroll is not kept). The session (host, bearer token, device token, who) is a file in Library/Application Support,
readable by the app alone, not the Keychain, which an app signed by ldid without entitlements may not reach. "Anslut"
pairs, asking for the host's address in an iOS 8 UIAlertController (and `gpcore8://connect/<host:port>` does it over
SSH). The app's system texts are Swedish (`CFBundleDevelopmentRegion` sv: "Tillbaka", not "Back").

**The start page** at the root of the left column, as the native app's StartPage.swift (Presentations.m): the core's
lists (`startPageView`: Idag, Kommande, Senast ändrade, an empty one left out), each row its name, "sön 8 november
2026 · 11:00" and the place under it (the web's dateLabel: Idag, Imorgon, the year where the list asks) and its number
of items at the right; Senast ändrade 20 at a time with Visa fler; an empty page's text and button. + opens "Skapa
presentation" (Details.m): the core's title, groups and buttons (`detailsDialogView`; the theme's group left out, as
the native app leaves it), a name and a place, a switch and a date picker each for the day and the time, the
description, in a form sheet; saved by `createPresentation`, then opened. The account's button (the member's first
name, Demo in the demo) holds Synka nu, Anslut and Logga ut. The texts are the web's (`../texts.mjs` writes
apps/web/src/i18n.ts's into `Resources/texts.json`; Texts.m reads them in the device's language, English or else
Swedish, as Texts.swift), a refusal's code shown as the web's `error.<code>`. In the demo a change runs straight
through the core as an admin of its own, as the native app's demo. While a presentation is presented, "● Visas just
nu" stands over the lists with it, as StartPage.swift's NowShowing.

**Presenting**, as the native app's Live.swift, Model.swift and WideLayout.swift, every decision the core's (Live.m):
the app's live state changed only by `liveChangeView` (one presentation at a time, the overlays' rules); the marks
from `slideMarksView`; the page's own state (the item selected, the slide made ready) and every event of the page
answered by `pageEventView`, its change to the live state made and then `{"type": "sync"}` sent, as AppState's
liveChanged; ▶ as `pageModelView` allows it. On the page (LivePanel.m): ▶ Starta presentation or ■ Avsluta
presentation in the bar, ■ asking first with the web's text; a tap on a tile is `show` (before presenting it makes the
slide ready, a ring in the tint; while presenting it shows it); the tile shown has a red ring and VISAS, the next
NÄSTA, the item shown a red dot in the running order; the slides brought to an item the core selects; while
presenting, a live column of 300 pt at the right: the picture shown with a red ring, Släck (grey while black or
nothing is shown), and NÄSTA's slide. The keys of a keyboard or a clicker through UIKeyCommand (iOS 7) as the native
app's: arrows `pick`, ⌘ and an arrow `item`, space `step`, return `enter`, b and . `black`, escape `escape`. The
output on an external screen (UIScreen, the 30-pin Digital AV Adapter's HDMI or AirPlay mirroring): a window of its own
in the screen's largest mode, the slide drawn at its size without its label, black fading over 500 ms, every other
change a cut. Over SSH: `gpcore8://send/<type>`, `gpcore8://show/<item>/<part>`, `gpcore8://end`.

Tried on the iPad: a slide made ready (the tint's ring), ▶, a slide shown (the live column, VISAS, NÄSTA, the red
dot), a step to the next part, Släck (the picture black, Släck grey, VISAS gone), ■ (all of it gone, ▶ back), and
"Visas just nu" on the start page; each event's `pageEventView` 0.5-0.8 ms, `liveChangeView` 0.4 ms. Not tried: an
external screen (no adapter, no Apple TV here), a keyboard's or a clicker's keys, ■'s question by hand (`gpcore8://end`
ends without it), overlays (no way to turn one on here yet), and the cost of drawing the output's 1920 × 1080 picture
on the main thread at a change of slide.

**The item's menu and +**, as the native app's ItemMenu.swift and AddSong.swift (ItemMenu.m, AddSong.m): a long
press on a row or ••• at a slides' heading opens an action sheet (a popover on the iPad) of `itemActionsView`'s
entries, those it can take: Byt namn (a heading's), Kommentar, Arrangemang …, Överlägg …, Lägg till efter …, and Radera, which asks
first; an entry it disables is left out, as a sheet has no grey entry. A name or a comment is asked in an alert with
a text field, a choice in a second sheet with ✓ at the one chosen. + in the running order's bar asks Sång or
Programpunkt, at the place `addPositionView` gives; Sång opens Lägg till sång, a form sheet with a UISearchBar over
the table, `searchSongsView` on every key (1-2 ms), ✓ at the song chosen, Lägg till making it. Each change runs as
`renameItem`, `setItemNote`, `setItemArrangement`, `setItemOverlay`, `removeItem`, `addHeaderToPresentation` or
`addSongToPresentation` through the sync's queue, and the page is read again where it stands (the column named again
after its item, renamed or not); an addition is then the page's `added` event. A page read again, by a change here or
by a sync, is the core's `changed` event with the items on the screen (docs/view-models.md): the item it answers
stays where it stood, though items above it came or went. Over SSH: `gpcore8://menu/<row>`,
`gpcore8://add`, `gpcore8://addsong/<query>`, `gpcore8://run/<change>?<JSON>`.

Tried on the iPad: the item's sheet over its row (Kommentar, Lägg till efter …, Radera for a song), + asking Sång or
Programpunkt, Lägg till sång searched for "s"; through `run`, a heading renamed and back, a heading added after the
first item and removed, each pushed (200) and in the host's database within a second, the page read again in place:
a heading added above the item at the top left the slides where they stood, and the item at the top removed left
the next one where it stood, the column named after it.
Not tried: any entry by hand, a song added, Arrangemang and Överlägg with choices to make, a change the core refuses
(its alert), a menu while presenting.

**The presentation's menu**, as the native app's titleMenu (PresentationMenu.m): the running order's title is a
button, and a tap on it opens an action sheet of `presentationActionsView`'s entries: Redigera detaljer… (the Details
form filled in, `updatePresentation`, the page and the start page read again) and Radera presentation (asked first
with the web's text, `trashPresentation`, then the start page with nothing beside it); Radera is not offered while
the presentation is presented. Noter och länkar and Spara som mall are left out, as the native app leaves them (the
role is sent empty, which only Spara som mall asks for). A presentation trashed elsewhere now empties the right
column too when a sync brings it. The back button to the start page is ‹ alone, as it was beside a plain title: beside
the title's button iOS 8 cut "Presentationer" to "Til…" rather than leave it out. Over SSH: `gpcore8://pmenu`,
`gpcore8://details`, `gpcore8://trash` (Radera answered yes).

Tried on the iPad: the menu's popover under the title (Redigera detaljer…, Radera presentation in red), the form
filled in with the presentation's name, place, day and time; a presentation made, renamed through `run`
(the title and the start page read again) and trashed (then the start page in the left column and the right one
empty, before the start page below), each pushed (200) and in the host's database (`deleted_at` set). Not tried:
Spara and Radera tapped by hand, a refusal's alert, a presentation trashed on the Mac while the iPad shows it.

**Two scenes, as the Mac's** (Lars, 2026-11-19): the start page over the whole screen, in a column of the web's page
width (720 pt) in the middle as the Mac's `readableWidth`, and a presentation as a split view of its own, made anew
each time it opens; the window's root is one or the other, faded over in 0.25 s (as an iPad's Keynote opens a
document; not pushed, and nothing of one scene kept for the other: first the start page and the slides had shared the
split view's right column, and it looked as if the page were reused). ‹ in the running order goes back: the left
column's root is a mark never seen itself (GPStartMark), whose appearing shows the start page, the edge's swipe back
turned off as it would show it though let go of half way. A presentation trashed, here or in a sync, shows the start
page too. Tried on the iPad: ‹ (`gpcore8://start`) to the start page in its column, a presentation opened
(`gpcore8://open/<id>`) beside its running order, and the launch logging the same frame each time, nothing moving.
Not tried: the fade seen by hand, an upright iPad, and an iPhone, which UIDeviceFamily allows: its split view would
fold into one column, with ‹ the same. A row on the start page is a Settings row that opens a page: the number of
items in the Settings app's value grey and › after it (GPStartCell), as Lars's photo of Allmänt shows them; before,
the number stood in ›'s place and the rows did not look as if they opened anything. Its groups are drawn in from the
sides with rounded corners, as Settings has them on an iPad: no public part of iOS 8 does that (a grouped table is
square and edge to edge; the inset style is public from iOS 13), but UIKit does it itself when told to by a private
method, `-[UITableView _setSectionContentInset:]`, found on the iPad by listing UITableView's methods at run time
(`_setMarginWidth:` only moved the text in). Settings' own Preferences.framework likely uses it; not checked. A
private method is no matter for an app signed by ldid on a jailbroken iPad, but would be refused by the App Store;
the call is skipped where UIKit lacks it.

**One column, standing** (OneColumn.m), as the native app's PhoneLayout under 1 000 pt (`Size.columns`; the iPad is
768 pt wide standing, 1 024 lying down): no pictures of the slides but their whole text; a plain table, each item a
section whose heading sticks (a red dot while it is shown, its name, its note in orange, ••• for its menu), each part a
row (its label as a pill in its colour, VISAS or NÄSTA at the right, its text; tinted red while shown, the tint's blue
while made ready); a tap the page's `show`; while presenting the picture shown, half the width, over the list with
Släck beside it, the list following the part shown unless it was tapped; + floating at the bottom right (Sång,
Programpunkt); the title the presentation's menu and ▶ or ■ as icons beside it. Turned past 1 000 pt, the
presentation is shown again in the other layout with the same page model, its state and its place in the live state
kept. What both layouts share is shared, not copied: ▶ or ■ and ■'s question (GPStartStopItem, GPAskEnd), the keys
(GPKeyCommands, GPKeyEvent), the title's button (GPTitleMenu), the item's slides (GPSlidesOf). Over SSH:
`gpcore8://turn/portrait` and `landscape` turn it by setting UIDevice's `orientation` by key, as the iPad lies on a
desk. Tried on the iPad: standing, the column with its headings, pills and two-line text (a label given the height
measured cut the second line to "…", now it is as tall as its lines); ▶, a part shown (the picture, Släck, VISAS on
a red row, NÄSTA, the red dot); turned to lying down while presenting, the split view with the same marks and the
live column; ■. Not tried: a real turn by hand, the turn's look (the scene fades over after the turn), the keys in
one column, a media part's picture, the description (the native app shows it at the top; not here), Beskrivning and
Visning beside Släck.

**Slides painted from the core's layout** (SlideView.m; docs/native-slide-rendering.md, way 3; merged from the native
app's branch at b8cbbf54 and 4044d2aa): a song slide is laid out by `slideLayoutView`, every glyph where the web's
SlideView sets it on the 1920 × 1080 stage, and painted with Core Text from the same faces, its ground, outline, shadow
and clip as the Mac app's SlidePainter.swift paints them; the tile's own small label over it, and no credits on a
tile (an output shows them). A Bible, picture, video or custom slide, a face the core lacks, or a colour this does not
read is drawn as before. Parley builds for armv7 and iOS 8 as the rest of the core does; the core grew from 3.3 to
5.3 MB (the faces are in it). Classic names `'Tahoma', 'Geneva', Verdana`; iOS 8 has only Verdana
(/System/Library/Fonts/Core), as Safari on this iPad draws Classic, so the app gives the core the system's Verdana
(regular, bold and italics; `add_slide_face`, as the Mac app gives it Tahoma). iOS 8 cannot draw a variable face at
another weight than its own: `CGFontCreateCopyWithVariations` lost most glyphs, `kCTFontVariationAttribute` drew them
all at the default weight (Montserrat's thinnest); so build-core.sh makes Inter and Montserrat static at each weight
from 100 to 900 with fonttools' instancer (glyph ids kept, 1 MB in all), and the app paints a run with the one
nearest the text's weight. Tried on the iPad: Classic's slides laid out in 2-3 ms each (25 ms the first, the faces
read), the lines breaking where the core breaks them; Inter at 400 and 800, Montserrat at 300 and 700 and Lato drawn
at their weights (a check since removed). Not compared with the web on this iPad (the web app does not run in iOS 8's
Safari); not seen: an outline, a shadow (Classic has neither), a theme's own picture (not on this device), a weight
between the hundreds.

The icon was drawn upside down, the logo's cross standing on its head (Lars saw it): art.m turned the CTM to draw from
the top left but did not say the context was flipped, so `respectFlipped:YES` did nothing. Now it says so.

Tried on the iPad: paired with the host on Lars's Mac as Lars Arvidsson in his organisation, one page pulled and
rebased in 80 ms (117 ms in all), its 2 presentations listed and the latest opened (an item whose song is in the
trash shows `song-trashed`); after a restart the saved session opened at once and the pull found nothing new
(528 ms). Then a presentation made on the iPad (`gpcore8://create/<name>`, which saves as the form does):
`createPresentation` ok, the push answered 200, and the host's own database has it; the start page lists it under
Senast ändrade with "0 inslag", and the form opens with the core's "Skapa presentation", Avbryt and Skapa
(`gpcore8://new`). Then pokes: the socket opened against the host, and a presentation Lars made in the host's window
on the Mac came as two pokes (`{"type":"poke","seq":86}`, 87), each followed by a pull rebased in 43-44 ms, within a
second, the start page listing it under Kommande with its 2 items, nothing pulled down by hand; a song's text edited
on the Mac shows on the iPad too (Lars). Not tried: the socket opening again after the network or the host goes, the
background and back, pokes over https, pairing with a code, a host on https, many pages, a sync that fails half way, a change
the host refuses on the next pull (it is not shown yet), and by hand: the form's Skapa, the date and time pickers,
and the account's menu.

## Build

On a Mac with Xcode and Homebrew, after `pnpm install`:

```sh
rustup toolchain install nightly --profile minimal --component rust-src
brew install ldid dpkg make                       # Theos's tools; GNU make 4 as gmake
pipx install fonttools                            # the slide faces' static weights (build-core.sh)
git clone --recursive https://github.com/theos/theos.git ~/theos
git clone --filter=blob:none --sparse https://github.com/theos/sdks.git /tmp/sdks
git -C /tmp/sdks sparse-checkout set iPhoneOS9.3.sdk && mv /tmp/sdks/iPhoneOS9.3.sdk ~/theos/sdks/
python3 -I spike/ios8-ipad3/sdk-armv7-only.py ~/theos/sdks/iPhoneOS9.3.sdk
spike/ios8-ipad3/build-core.sh
cd spike/ios8-ipad3/app && THEOS=~/theos gmake package FINALPACKAGE=1   # packages/*.deb
```

Core.m on the Mac, against the host's core (`cargo build -p gp-core-ffi --release --lib`) and SQLite built for the
Mac, on a copy of the demo data:

```sh
cd spike/ios8-ipad3/app && S=$(echo ../../../node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps/sqlite3) \
  && xcrun clang -c -DSQLITE_THREADSAFE=0 $S/sqlite3.c -o ../.build/sqlite3-mac.o \
  && xcrun clang -fobjc-arc -I../../../apps/mac/Sources/GPCoreFFI -I$S mac-check.m Core.m ../.build/sqlite3-mac.o \
     ../../../target/release/libgp_core_ffi.a -framework Foundation -framework Security -o ../.build/mac-check \
  && cp Resources/demo.sqlite ../.build/check.sqlite && ../.build/mac-check ../.build/check.sqlite
```

## On the iPad

**Downgrade and jailbreak** (done 2026-11-19, from iOS 9.3.6 13G37): [Legacy iOS Kit](https://github.com/LukeZGD/Legacy-iOS-Kit)
(v26.11.77, `./restore.sh` on the Mac) restores 8.4.1, which Apple still signs for A5 and A6 devices as an OTA update,
so no SHSH blobs are needed. It builds its own 8.4.1 IPSW with a jailbreak in it (daibutsu, `haxx_overwrite`), Cydia
and OpenSSH. An A5(X) has no bootrom exploit without extra hardware (checkm8-a5 needs a Pi Pico), so the kit enters
kDFU from a jailbroken iOS over SSH: first jailbreak 9.3.6 with [Carbon](https://ios.cfw.guide/using-carbon)
(`http://carbon.sep.lol` in Safari), install OpenSSH from Cydia, then Restore/Downgrade › iOS 8.4.1 › kDFU, the root
password `alpine` when asked. The restore wipes the iPad; the whole run took about 10 minutes and 1.8 GB.

**Install and run** over USB: `iproxy 2222 22` (in the kit's `bin/macos`), a key in root's `authorized_keys` once,
then `scp -O` the .deb, `dpkg -i` it, `su mobile -c uicache`, and `su mobile -c "uiopen gpcore8://"` to open it;
`scp -O` /tmp/gpcore8.png back for the picture. The jailbreak's OpenSSH is 6.7: `ssh -o HostKeyAlgorithms=+ssh-rsa`.
The app lands in /Applications, signed by ldid, and needs no AppSync. `idevicesyslog` (in the kit) shows its NSLog;
crash reports are in /var/mobile/Library/Logs/CrashReporter.

What happened, in order:

1. SIGILL at `main`'s first instruction, `cpsr` without the Thumb bit: `LC_MAIN`'s entryoff pointed at a Thumb `main`
   without its low bit. `main.m` built as ARM.
2. SIGSYS in `-[GPAppDelegate application:didFinishLaunchingWithOptions:]`, again in ARM mode: the method list's `imp`
   was even too. All of the app's code built as ARM (`-marm`).
3. It runs: `coreInfoView` `{"name":"gp-core","version":"0.1.0"}`, `highlightView`
   `[{"hit":true,"text":"Härlig"},{"hit":false,"text":" är jorden"}]`, `noSuchView` `refused: unknown-mutator`,
   1.0 ms for the three.
4. With SQLite and the page: `migrateOrgSchema` on the demo data 47 to 97 ms, `presentationsView` (16 rows) 5 to 8
   ms, `presentationPageView` (15 items, 54 slides) 51 to 58 ms, `didFinishLaunching` 189 to 276 ms in all. The
   picture showed the page as meant after two rounds: headings in line with the tiles, the tiles at the left (a flow
   layout centres a row of one, and spreads one that is not full), the video's ▶ as text, not emoji.
5. As the Settings app: first a SIGABRT, `scrollViewDidScroll` asking UICollectionView for a section's heading
   before it had any (iOS 8 throws), then the watchdog's kill after 20 s, `viewWillLayoutSubviews` invalidating the
   layout of the collection view that is its own view, which lays it out again, for ever; then the wrong row chosen,
   the layout answering every heading at 0 until the view has appeared. The picture in both orientations after that.

The launch lying down, filmed by Lars at 30 frames a second: without launch images the system zoomed a black
rectangle out of the icon, slid a black screen in from the left over the wallpaper, stayed black for about half a
second, and then showed the page at once; the app's own views stood still from their first frame on (`GPLaunchWatch`
in ScrollTest.m logs where they stand on every frame of the first 3 s). Hence the launch images; filmed again, the
page's frame zoomed out of the icon and the page faded in over it. But 1.5 s after launch the running order folded
away, the slides stood three to a row, and it slid back: the picture the app then took of itself, with
`drawViewHierarchyInRect:afterScreenUpdates:YES`, which lays the window out once more, and the split view with it.
Now the app takes no picture unless asked, and takes it with `afterScreenUpdates:NO`; nothing moves in the 3 s after
launch nor after a picture, by the log, and Lars saw the launch as it should be. The Mac could not record the iPad's
screen as QuickTime does: no capture device showed up, and the camera access this needs was not given.

The first start after `dpkg -i` and `uicache` waits about 10 s between `main` and `didFinishLaunching`; the next
starts do not. Harmless, seen on every launch: installd's "Failed to verify code signature … (Code not signed)" when
`uicache` registers it (iOS 8 does not read ldid's signature; the jailbreak lets it run anyway), and libxpc's
"assertion failed: … 0x7d", which the jailbreak's own Melder app logs too.

## Checked

- The binary: armv7, `LC_VERSION_MIN_IPHONEOS` 8.0, `LC_DYLD_INFO_ONLY` (not chained fixups, iOS 13.4), the app's own
  `clock_gettime`, no `objc_alloc` and no thread-local variables imported. Every import of the core's is in iOS 8 by
  the SDK's headers (the newest, `CCRandomGenerateBytes`, 8.0), and SQLite's are POSIX and malloc zones; the
  Objective-C sections are in `__DATA`, where iOS 8's runtime looks. No Thumb function in the binary. The .deb
  1.2 MB with the demo data.
- `mac-check` on the Mac: the migration, `presentationsView` and `presentationPageView` on the demo data, 13.6, 2.8
  and 3.8 ms.
- On the iPad (iOS 8.4.1): the same answers; the objects marked iOS 10.0 did not matter to dyld. The page from the
  app's own picture of its window, upright and lying down; a tap on a row scrolls to its item's slides (Lars, and
  `gpcore8://item/9`: the row chosen, its slides at the top, the column named after it).

## Not checked

- The clock: whether any of these views call `clock_gettime`, so whether `clock.c` has run.
- By hand on the iPad: the row following the slides as they are scrolled with a finger, a tile's outline, the fold
  button, and the icon on the home screen.
- Scrolling with a finger, and the deceleration after it: the test moves the views at even speeds.
- That the slides' text breaks and sizes as the web's: the fitting here is a simpler one, not compared.
- Media files: pictures, videos and audio are neither pulled nor shown.
