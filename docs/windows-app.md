# The Windows app: WinUI 3 over the Rust core

> Stopped by ADR 0008 (Lars, 2026-11-22): one GUI, the React app. A record: the code is removed from the tree
> (2026-11-23) and kept at the tag `native-experiment-end`; a path here is a path at that tag.

Paused (Lars, 2026-11-22): Mac/iOS and Linux go on first, a round at a time, with the rules moved into the core as
reducers and typed view models (thin shells). Windows resumes when the live reducer and the types have settled, and is
then mostly drawing the core's view models. Where it stands: the start page's lists on the demo data, built and seen on
Windows 10. Next then: read the start page's date line from the core's view and remove `Shell/Dates.cs`
(`TEMPORARY(core)`); a UI test harness (FlaUI, over the UI Automation tree already read); the presentation's page;
live through the core's reducer, with no live glue in C#.

Lars, 2026-11-21: a native Windows app beside the Mac's (docs/native-apps.md), in `apps/windows`. The core is the
Mac's, through the same interface (`crates/gp-core-ffi`), so the app shows what the web and the Mac show; the shell
only draws, with WinUI's own controls, as the Mac's draws with SwiftUI's. Begun: the start page's lists on the demo
data. Not yet: a presentation's page, presenting, settings, sign-in and sync.

## Why WinUI 3 in C#

- **WinUI 3 (Windows App SDK) in C#**, chosen: Windows' current controls (Fluent, Mica, light and dark), the most
  documentation and tooling, and the core through UniFFI's C# bindings (uniffi-bindgen-cs, NordSecurity's), generated
  from the same library as the Swift ones.
- C++/WinRT: the same controls, far more code for each page, no generated bindings (a C header by hand).
- Rust with windows-rs: one language with the core, but no XAML compiler; each page built by hand in code.

## The parts

| Part | What it is | Builds on a Mac |
| --- | --- | --- |
| `apps/windows/build/Dockerfile`, `core.sh` | the core cross-compiled for x64 and ARM64 (cargo-xwin, which fetches Microsoft's CRT and Windows SDK), the C# bindings, the core for this machine, the texts | yes, in Docker |
| `apps/windows/Shell` | plain .NET 8: SQLite for the core (`Database`, SQLite's own API through SQLitePCLRaw, binding by position as the core's `?` and `?1` need), `Core` (a call's statements answered until it is done or refused, transactions), the views decoded (`Views`), the texts (`Texts`, the web's i18n.ts), a row's date line (`Dates`, the Mac's `dateLabel`; TEMPORARY(core), until the core's view gives it) | yes |
| `apps/windows/Shell.Tests` | xUnit, against the real core and a copy of the demo data | yes, run |
| `apps/windows/App` | WinUI 3, unpackaged: one window, the start page | no: the XAML compiler is a Windows program |
| `apps/windows/build/build.ps1` | the whole on Windows, without Docker | no |

The bindings (`Shell/Ffi`), the native libraries (`native/<rid>`) and the texts (`Shell/texts.json`) are generated
and not kept in git. `crates/gp-core-ffi/uniffi.toml`'s `[bindings.csharp]` names their namespace, makes them public
and names the library they load (`gp_core_ffi`: `gp_core_ffi.dll`, `libgp_core_ffi.dylib` on a Mac). As on the Mac,
every call of the core comes from one thread, the UI thread: a call waits in its thread's state between its steps.

## Building

On a Mac (or Linux), with Docker:

```sh
apps/windows/build/core.sh                     # the DLLs, the bindings, this machine's core, the texts
dotnet test apps/windows/Shell.Tests           # the Shell library against the core and the demo data
```

The demo data is `crates/gp-core/parity/.out/fixtures/demo.sqlite`, made by `crates/gp-core/build.sh`.
`dotnet build apps/windows/App -p:EnableWindowsTargeting=true` restores the Windows App SDK and builds the Shell for
Windows, then stops at the XAML compiler.

On Windows, with Rust (and Visual Studio's C++ build tools), the .NET 8 SDK or later and Node 22.18 or later (type
stripping unflagged, as `texts.mjs` imports the web's `i18n.ts`; tested: 24.11.1); the demo data copied from a Mac to
the same place, or made on Windows (below):

```powershell
apps\windows\build\build.ps1 run               # the core, the bindings, the texts, the Shell's tests, then the app
apps\windows\build\build.ps1 run -Arch arm64   # the same for ARM64
```

The app builds with `dotnet` alone, without Visual Studio: `EnableMsixTooling` in `App.csproj` has the Windows App SDK
make the resource index (`resources.pri`) itself, where its default looks for Visual Studio's AppxPackage tasks
(MSB4062 in `MrtCore.PriGen.targets`). The Windows App SDK 1.6 and the XAML built as written on the Mac. Mica only
from Windows 11 (`MicaController.IsSupported()`); on Windows 10 the page has the theme's background brush.
`App/app.manifest` makes the app aware of each display's scale (PerMonitorV2): without it Windows drew it at 96 DPI and
stretched it, blurred, to the display's 150 %.

The demo data on Windows: `pnpm install`, then `crates/gp-core/build.sh`'s lines for `ts-core.mjs`, `ts-core.min.mjs`
(the reference at 238d481b through esbuild) and `gp_core.wasm`, then
`node parity/demo-seed.mjs <abs path>/parity/.out/fixtures` in `crates/gp-core`; in Git Bash, `pwd -W` gives the
Windows paths esbuild and Node need.

## Pictures

```powershell
apps\windows\build\build.ps1 capture                       # the build, then the start page's window in apps\windows\pictures\start.png
apps\windows\build\build.ps1 capture -Out C:\tmp\a.png     # elsewhere
```

`apps/windows/Capture/Program.cs` (gp-capture) pictures a window as the compositor draws it, through
Windows.Graphics.Capture, in the window's own pixels: the window alone, behind other windows too and without bringing it
forward, where a copy of the screen (CopyFromScreen) has whatever is on top. The compositor draws nothing while the display is off (the PC left alone, 5 minutes
on Lars's), and a picture then is empty: gp-capture wakes the display first and keeps it on, and waits for the window's
first frame; a window still one colour after 15 s is saved and said BLANK (exit code 2). A PC asleep runs nothing.
`gp-capture --hwnd N OUT.png` pictures a window already open.

The app keeps its data in `%LOCALAPPDATA%\GospelPresenter\app.sqlite`, copied from the demo on the first start and
brought to today's schema (`migrateOrgSchema`) on each. The old app (v1) keeps its own in the same folder
(`gospelpresenter.db`); neither touches the other's files.

## Checked, and not

Lars, 2026-11-21, on Windows 10 (19045, x64): `build.ps1 run` builds the core, the bindings and the texts, the Shell's
12 tests pass against the core and the demo data, and the app starts with gp_core_ffi.dll beside it; read through UI
Automation, its window holds the start page's list (Senast ändrade) with the demo's presentations, each row's name and
date line. Seen on the screen and in gp-capture's pictures: the list under its title on the theme's light page
background, each row's name in bold over its date line in grey, sharp at 150 %. The first pictures were empty, of
Microsoft's Photos as much as of this app: the display had gone off. Not built: ARM64, and Windows 11 with Mica.
