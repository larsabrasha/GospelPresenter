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
its own state, the app's live state, each changed only by the core's `pageEventView` and `liveChangeView`), its SQLite
runner (`shell.rs`), its decoded views, its texts (the web's `i18n.ts`) and its keys (`keys.rs`: a GTK key is made
into the terminal's, so which key is which event is written once; ⇧↑ ⇧↓ stand for ⌘↑ ⌘↓, as there). So both shells
send and answer the core's events alike. Those parts belong in a crate of their own for every Rust shell; not moved
yet, so `apps/linux` depends on `gp-tui` and with it on ratatui.

What a page offers is the core's: `startPageView`, `presentationPageView`, `pageButtonsView` (▶ Starta, ■ Avsluta,
Släck, with their roles), `presentationColumnsView` (the columns' widths, the live column out while presenting),
`pageModelView`'s cue, `slideMarksView`. The colours are `lookView`'s (`apps/linux/src/look.rs`): the page's greys
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
`ADW_DEBUG_COLOR_SCHEME=prefer-dark` shows it dark. GTK's Broadway backend (the app in a browser) was tried first: under
Docker Desktop's emulation it drew the first frame and then no more (`gdk_frame_timings_submitted` warned), so it is
not used. Not tried yet: Wayland itself, Hyprland, Omarchy.

## Built and not built

Built and seen in pictures (2026-11-21, the demo data, light and dark): the start page's lists (startPageView, with
"Visas just nu" while presenting); a presentation opened, its running order and every item's slides as painted tiles
with their labels and numbers; ▶ Starta, the live column with the picture as the outputs draw it (credits, no label),
Släck and the cue; Space, the arrows, ↵ and b as the core answers them, with VISAS, NÄSTA and the ring of the slide
made ready; ■ Avsluta asked first; an output window (o or Tab), full screen on a second monitor where there is one, not
seen. Checked by `cargo test` (12) and clippy.

Not built: signing in and sync (the app opens a database file as the demo's caller), Skapa presentation, Lägg till,
an item's menu, the description card, folding and resizing the columns, the outputs and overlays in the live column,
media files (pictures show where the folder beside the database holds them), audio and video, Inställningar, a phone's
one column, packaging (an Arch package, Flatpak).
