# The Windows app: WinUI 3 over the Rust core

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
| `apps/windows/Shell` | plain .NET 8: SQLite for the core (`Database`, SQLite's own API through SQLitePCLRaw, binding by position as the core's `?` and `?1` need), `Core` (a call's statements answered until it is done or refused, transactions), the views decoded (`Views`), the texts (`Texts`, the web's i18n.ts), a row's date line (`Dates`, the Mac's `dateLabel`) | yes |
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

On Windows, with Rust (and Visual Studio's C++ build tools), the .NET 8 SDK and Node 22 or later; the demo data copied
from a Mac to the same place:

```powershell
apps\windows\build\build.ps1 run               # the core, the bindings, the texts, the Shell's tests, then the app
apps\windows\build\build.ps1 run -Arch arm64   # the same for ARM64
```

The app keeps its data in `%LOCALAPPDATA%\GospelPresenter\app.sqlite`, copied from the demo on the first start and
brought to today's schema (`migrateOrgSchema`) on each.

## Not checked

The app has not been built or run: it is written, not seen. Its first build on Windows will say what the Mac cannot:
the XAML, the Windows App SDK's version (1.6), and the DLL loading beside the app. GitHub Actions' Windows runners
could build it too, which needs the branch pushed.
