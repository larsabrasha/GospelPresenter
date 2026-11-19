# The core on an iPad 3 with iOS 8.4.1

A spike (Lars, 2026-11-18): whether the Rust core (`crates/gp-core`) runs on a jailbroken iPad 3 ("the new iPad",
A5X, 32-bit armv7) downgraded to iOS 8.4.1, for a screen that shows song texts on an old iPad, as the Raspberry Pi
in `docs/native-slide-rendering.md`. Not a shell of the app: a presentation's page, read through the core from the
demo data, drawn with UIKit.

**Where it stands:** it runs. On Lars's iPad 3 (iPad3,3, iOS 8.4.1 12H321, jailbroken) on 2026-11-19 the app opens a
copy of the demo data in SQLite, has the core migrate it, and shows the first presentation's page: the items at the
left, every item's slides at the right (below, "On the iPad"). Built at 8aad1883; the core's interface (`start`,
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
the right the slides on the grouped table's grey, tiles 340 to 384 pt wide (the web's SlideGrid), each item a
section headed as a grouped table heads one. A row scrolls to its item's slides; the slides scrolled select their row and name the right
column, as Settings names it after the row chosen; a tile tapped is outlined in the tint, the web's sky. `SlideView.m`
draws a slide: the theme's background, the text in the theme's area at the theme's size made 5 % smaller at a time
until it fits (not the web's fitting), the part's label in a corner. Media show their kind and title: their files are
not on the device. Nothing is presented. `icon.m` draws the app's icon on the Mac (`build-core.sh` runs it). 1.5 s
after the page shows, the app writes a picture of its window (without the status bar) to /tmp/gpcore8.png; opened
with `gpcore8://picture` it writes one then, and with `gpcore8://item/<n>` it taps row n first and writes one a
second later, so that a check over SSH can drive the page and see it.

## Build

On a Mac with Xcode and Homebrew, after `pnpm install`:

```sh
rustup toolchain install nightly --profile minimal --component rust-src
brew install ldid dpkg make                       # Theos's tools; GNU make 4 as gmake
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
- Lying down, the slides' column is 703 pt and the web's sizes give it one column of 384 pt, half of it empty.
- That the slides' text breaks and sizes as the web's: the fitting here is a simpler one, not compared.
- Commands beyond the migration (nothing is changed), sync, and media files.
