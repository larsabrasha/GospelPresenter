# The Linux app: GTK 4 and libadwaita over the Rust core

Asked by Lars on 2026-11-21, beside a Windows app: a native app for Linux that fits Omarchy (Arch Linux with
Hyprland, on Wayland), drawn with GTK 4 and libadwaita as GNOME's own apps are, light and dark as the system is. First
milestone built the same day, on `claude/linux-gtk-0949de` from `claude/native-ios-058c37`: the start page, a
presentation with its slides painted, presenting and stepping.

## How it takes the core

`apps/linux` is a Rust crate (gtk4-rs, libadwaita-rs) with the core linked in, as the terminal shell has it
(docs/tui.md): no WASM and no UniFFI. It is a Cargo workspace of its own, as `crates/gp-pptx` is, so building the core
or the TUI on a Mac never needs GTK.

It takes more of the terminal shell than the core: `crates/gp-tui`'s `App` (the start page's lists, the page open and
its own state, the app's live state, both changed only by the core, a key or a tap in one call, `pageStepView`), its SQLite
runner (`shell.rs`), its decoded views, its texts (the web's `i18n.ts`) and its keys (`keys.rs`: a GTK key is made
into the terminal's, so which key is which event is written once; ⇧↑ ⇧↓ stand for ⌘↑ ⌘↓, as there). So both shells
send and answer the core's events alike. Those parts belong in a crate of their own for every Rust shell; not moved
yet, so `apps/linux` depends on `gp-tui` and with it on ratatui.

What a page offers is the core's: `startPageView`, `presentationPageView`, `pageButtonsView` (▶ Starta, ■ Avsluta,
Släck, with their roles), `presentationColumnsView` (the columns' widths, the live column out while presenting),
`pageStepView`'s marks, cue and whether ▶ may start. The colours are `lookView`'s (`apps/linux/src/look.rs`): the page's greys
libadwaita's own, light and dark from the system; the accent the user's where the desktop offers one (libadwaita's
`system-supports-accent-colors`), else the app's sky; ▶ in emerald and ■ in red.

## Slides: painted with cairo from the core's layout

As on the Mac (docs/native-slide-rendering.md, way 3): the core's `slideLayoutView` places every glyph on the
1920 × 1080 stage, and `apps/linux/src/painter.rs` paints them with cairo, by their ids, from the very faces the core
laid them out with (its own through FreeType, `faces.rs`). The theme's ground and picture, a picture slide, a
slideshow's page and its shapes, the outline, a verse number's 40 %, a weight the face lacks drawn twice, an italic
slanted, the label on a tile, an overlay over all. Not a web view (WebKitGTK): Lars chose way 3 for the native shells
on 2026-11-19, and the Mac app paints every kind of slide that way; a WebKitGTK view would also be a large dependency
for each slide.

Classic's `'Tahoma', 'Geneva', Verdana, sans-serif`: the first of those fontconfig has is added to the core
(`add_slide_face`), else fontconfig's sans-serif under that name (DejaVu Sans on a bare Arch), as a browser on Linux
falls back.

What differs from SlideView: the text's shadow (`0 0.06em 0.18em`) is drawn as faint copies around its offset, since
cairo has no blur; close, not the same pixels. Not compared picture by picture with SlideView, as the Mac's was.

## Building and looking at it

On Linux, with GTK 4 and libadwaita installed (Arch: `pacman -S rust gtk4 libadwaita nodejs`):

```sh
cd apps/linux && cargo run -- ../../crates/gp-core/parity/.out/fixtures/demo.sqlite
```

On a Mac, in Docker (Arch Linux, x86_64 under emulation; the image in `apps/linux/Dockerfile`):

```sh
apps/linux/docker.sh build
apps/linux/docker.sh test
GP_OPEN=pres-main apps/linux/docker.sh shoot /tmp/shots "wait 20; shot page; click 1233 28; wait 6; key space; wait 4; shot live"
```

`shoot` runs the app in a virtual X server (Xvfb, the X11 backend), carries out the steps and saves the pictures;
`ADW_DEBUG_COLOR_SCHEME=prefer-dark` shows it dark, and `GP_DEMO=<file>` opens another database from the fixtures'
folder (one with a song's link, made by hand with sqlite3, for Noter och länkar). GTK's Broadway backend (the app in a browser) was tried first: under
Docker Desktop's emulation it drew the first frame and then no more (`gdk_frame_timings_submitted` warned), so it is
not used. Not tried yet: Wayland itself, Hyprland, Omarchy.

## Built and not built

Built and seen in pictures (2026-11-21, the demo data, light and dark): the start page's lists (startPageView, with
"Visas just nu" while presenting); a presentation opened, its running order and every item's slides as painted tiles
with their labels and numbers; ▶ Starta, the live column with the picture as the outputs draw it (credits, no label),
Släck and the cue; Space, the arrows, ↵ and b as the core answers them (↑ ↓ to the tile above and below, `slideAcrossView` over the tiles' places), with VISAS, NÄSTA and the ring of the slide
made ready; ■ Avsluta asked first; an output window (o or Tab), full screen on a second monitor where there is one, not
seen. Checked by `cargo test` (12) and clippy.

Built 2026-11-22: an item's menu on its row (a right click, a long press) and its heading's ⋯, GNOME's popover menu
from the core's `itemActionsView` (Byt namn, Kommentar, Arrangemang, Överlägg, Markera, Radera asked first), and
Markera's select mode (`tickView`, a check on each row, Markera alla, Klar, the ticked removed after a question), and
Redigera bilder (an image item's pictures moved and removed, image_items.rs); the presentation's menu on its title
(Noter och länkar in a dialog, Radera presentation asked first; presentation_menu.rs); the page is built again when its items
change.

Lägg till and Lägg till efter › with every kind (adding.rs, adding_bible.rs; 2026-11-22): a song, a programme item, a
Bible text searched or browsed, a library's pictures, sounds, videos or slideshows; `GP_DEMO=demo-bible.sqlite` is the
demo with the sample translation of packages/rust-core/test/bible-fixtures.ts, made by hand for the pictures.

Skapa presentation and templates (templates.rs; 2026-11-22): + on the start page, blank or from a template, Mallar in
the header's menu, Spara som mall in a presentation's menu.

Signing in pairs the device with a desktop host and syncs as the Mac app does (connect.rs, net.rs, sync.rs); a
database named as the first argument or in GP_DB is opened as the demo, without a sign-in. Not built: importing
files, Redigera of a song or a slideshow in the menu, resizing the columns, the sync line at the running order's foot,
media files (pictures show where the folder beside the database holds them), audio and video, Inställningar, a phone's
one column, packaging (an Arch package, Flatpak).
