# 3. The desktop host runs on Electron

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** `GospelPresenter.Desktop`, and what it retires in the MAUI project
- **Supersedes:** the toolchain half of ADR 0002 — Velopack (6), the `.pkg` and its per-user
  installer rewrite (5), the release workflow and the tag-to-three-versions derivation (8)–(11),
  and the Gatekeeper reasoning in (7)
- **Written after the fact.** The decision was taken and built over three days; this records it from
  the commit history rather than from notes taken at the time. Where the record is thin, it says so.

## Context

ADR 0002 planned a release of the Mac Catalyst app. While building it, running the app against the
real stack instead of trusting it turned up that **Catalyst cannot present**, which is the one thing
a presenter application exists to do.

Three measurements, all in the history of this branch (`3db86a2`, `05e8cce`):

- **`Application.OpenWindow` throws** "The application does not support multiple scenes" on Mac
  Catalyst. Declaring the scene manifest Catalyst asks for does not fix it. Measured with the flag
  both ways, with and without a `UISceneConfigurations` entry naming `MauiUISceneDelegate`, and with
  an app-owned subclass registered under its own Objective-C name: `MauiProgram` runs to completion
  and `App.CreateWindow` is simply never called.
- **UIKit cannot see the second display.** With a second monitor attached, `UIScreen` reported one
  screen where `NSScreen` reported two.
- **A hand-made `UIWindow` produced no native window at all**, verified against a before-and-after
  control.

Together those close the whole UIKit family of approaches, not one API. An **AppKit spike then
proved the alternative works**: Blazor rendered into two `NSWindow`s with a verified click round
trip. So the choice was not between a broken thing and a rescue — it was between a working AppKit
host we would write and maintain ourselves, and Electron.

The comparison between those two was not written down at the time. That is the gap this ADR fills
late, and the reasons below are the ones the subsequent work bears out rather than a reconstruction
of a conversation.

## Decision

### The host

1. **Electron, via `GospelPresenter.Desktop`: ASP.NET Core serving the shared Blazor components over
   localhost inside an Electron window.** Registrations mirror `MauiProgram`'s, because it is the
   same app — what changes is the shell around it.

   Three reasons, each of which the work since has borne out:

   - **One host reaches three platforms.** The AppKit spike was macOS only, and Windows was already
     deferred to 1.1 in ADR 0002 (1) largely because `GpMediaSchemeHandler` existed only for Catalyst
     and iOS. That blocker is gone (5), and the release pipeline now builds macOS, Windows and Linux
     from the same project.
   - **A real HTTP origin removes a class of bug rather than a bug.** Catalyst served Blazor from
     `app://0.0.0.0/`, a custom scheme and therefore not a secure context, where
     `crypto.randomUUID` is undefined and storage APIs can throw. That cost a blank-rectangle
     sign-in failure that took a measurement to find.
   - **Packaging and updating already exist.** electron-builder and electron-updater are the
     alternative to the `.pkg`, the installer rewrite and the release workflow that ADR 0002 (5),
     (6) and (8)–(11) specified and that this decision retires.

   What it costs is a 382 MB bundle, an Electron runtime we do not control the release cadence of,
   and a second toolchain (npm) in the build.

2. **`ElectronNET.Core` 0.5.2, not `ElectronNET.API`.** The latter is the pre-2024 package line: its
   newest stable release ships only `lib/net6.0` with a DLL dated 2024-02-15. Taking the first
   package name off the repository page lands on it. The Core line is where the project actually
   lives, and it has `lib/net10.0`.

3. **Mac Catalyst is deleted, not left as a target nothing ships.** A target that only ever compiles
   is how the Windows media handler rotted behind a green CI job for months. Three things went with
   it because they existed only for it: `IExternalDisplayService`, the launcher's external-screen
   chase, and `AppPaths` — whose reasoning `DesktopPaths` carries where it still applies. iOS and
   Android stay: they are store platforms and they work.

### What the move actually required

4. **`launchSettings.json`, and the reason it matters.** Static web assets 404'd because the project
   had none, so `dotnet run` started in Production, where `StaticWebAssetsLoader` — which teaches
   the file provider where `_content/*` lives — does not run. Development then turned on container
   validation, which named two missing registrations, and `LiveLayout`'s `IStatusBarService`, which
   only Web and MAUI had. Recorded because the symptom pointed at routing and the cause was the
   environment.

5. **Media is served over HTTP by the same handler.** `/api/images`, `/api/live-images`, `/api/audio`
   and `/api/theme-images` route to `MediaRequestHandler` — the class the `WKUrlSchemeHandler`
   called on Catalyst, unchanged, because it was never platform-specific. Uploads needed a picker
   rather than a rewrite: `MauiMediaUploader`'s portable half moved to `MediaIngestService` in
   `Shared`, leaving each host its own dialog.

6. **`[Authorize]` on a page component is also `[Authorize]` on an endpoint here.** MAUI escaped
   that by having no HTTP pipeline at all. `DeviceAuthenticationHandler` gives the middleware the
   same answer `DeviceAuthStateProvider` gives Blazor, so the two cannot drift.

7. **The projector window is placed on the first non-primary display and put into kiosk *after*
   ready-to-show, not before.** Given coordinates and fullscreen at once, Electron can take over the
   primary instead. Measured with a display attached: black edge to edge, no menu bar, the operator
   window untouched on the primary.

   `ILiveWindowLauncher` gains `HasExternalDisplayAsync`, and where a host answers true the browser
   Presentation API is not consulted at all. It had been the only path: Electron's Chromium defines
   it but cannot serve it — it looks for Cast receivers, not the monitor on the desk — so the click
   rejected into a swallowing catch and the button did nothing.

### Identity, updates and release

8. **The bundle identifier is `com.gospelpresenter.app`**, per ADR 0002 (13); the Catalyst app that
   held it is retired. Everything identifying the app had been derived from the project file name.
   The identifier is the part that matters beyond appearances: Apple requires reverse-DNS, it is what
   a Developer ID certificate is issued against, what notarization records, and what macOS keys a URL
   scheme registration on — so it has to be settled before the certificate is bought, not after.

9. **`gospelpresenter://` is declared in the bundle, not only claimed at runtime.**
   `setAsDefaultProtocolClient` is enough while developing; on macOS the durable claim is read from
   `CFBundleURLTypes`. Left out, the packaged app would open the browser to sign in and never hear
   the answer come back — and it would have looked like a sync bug.

10. **`IAppUpdater` is implemented on electron-updater.** The seam ADR 0002 (18) defined had no
    implementation after Catalyst was retired, so the restart indicator resolved nothing on every
    host. The behaviour in (16)–(18) falls out of two settings rather than logic: `AutoDownload`
    makes the download silent, `AutoInstallOnAppQuit` applies it at the next start. The negative rule
    is unchanged and still lives in the component: while anything is being presented there is no
    restart, no prompt and no toast.

11. **Every target is one electron-updater can update.** The inherited configuration had none:
    `portable` on Windows is a self-extracting exe with nothing to replace in place, `tar.xz` on
    Linux is a tarball, and there was no `mac` section at all — so macOS shipped no `zip`, which is
    the format Squirrel.Mac updates from and without which electron-builder writes no
    `latest-mac.yml`. Now `nsis`, `AppImage`, and `dmg` + `zip`. NSIS installs per-user for the same
    reason `/Applications` was rejected in ADR 0002 (5).

12. **A pushed tag builds all three platforms into a draft release**, and electron-builder does the
    uploading. Not a preference: it is the half that writes the update manifests, so a workflow that
    collected the installers itself would produce a release that looks complete and updates nobody.
    Draft, because ADR 0002 (26) says there is no rollback.

13. **The feed stays compiled in**, per ADR 0002 (30) — a server that names the feed can make the
    client download and run anything, and that is only acceptable once a signature proves the package
    came from us. GitHub Releases per (8), whose reasoning survives the toolchain change: the
    repository is public, so this is Fastly's bandwidth, and it keeps the Cloudflare Tunnel off the
    path a church computer needs in order to update itself.

14. **macOS ships Apple Silicon only.** electron-builder writes one `latest-mac.yml` per invocation
    and Electron.NET drives one invocation per RID, so an `osx-x64` build would emit a second
    manifest listing only its own file and overwrite the first — an Intel Mac would then be offered
    the arm64 build. Both arches need a single multi-arch electron-builder run, which these MSBuild
    targets cannot express.

15. **The language comes from the host, not from `CultureInfo`.** On macOS the two disagree:
    `CultureInfo` follows the POSIX `LANG` variable, which a terminal or a launch agent sets to
    whatever it likes, while the language a Mac is actually read in lives in `AppleLanguages`.
    Measured: with `LANG=en_US.UTF-8` `CultureInfo` said `en-US`, with `LANG` unset it said `sv-SE`,
    and macOS said `sv-SE` throughout. Electron already resolves the real preference and hands it to
    its own renderer as `--lang`. Order: the user's stored choice, then the operating system as
    Electron reports it, then English.

## Consequences

- **Nothing shippable on macOS until the Apple account is bought** — unchanged from ADR 0002, but
  the cost has moved. Without a Developer ID certificate the first launch takes four steps in System
  Settings, *and* the app cannot update itself on macOS at all: Squirrel.Mac verifies that the
  replacement bundle carries the same signature as the running one. Windows and Linux update
  regardless. The download page says so in both languages rather than promising otherwise.
- **The update button is reachable and will not work on unsigned macOS.** The check and the download
  succeed, the indicator appears, and `quitAndInstall` fails — the app quits and comes back on the
  same version. It resolves itself the moment the certificate exists; until then it is a known sharp
  edge, not a mystery.
- **Windows is no longer blocked**, which is a change to ADR 0002 (1): the reason it was deferred was
  the Catalyst-only media scheme handler, and there is no scheme handler now.
- **A 382 MB bundle**, of which Electron and the self-contained .NET runtime are the two large parts.
  Both have to be there; there is nothing duplicated to remove.
- **npm is now in the build path.** electron-builder is fetched at publish time and the Electron
  version is pinned by the ElectronNET package, not by us.
- The file-system layout, the client version headers and the protocol floor — ADR 0002 (20)–(25) —
  carry over unchanged, and `DesktopPaths` holds their reasoning.

## Open questions

- **The Developer ID certificate**, which gates macOS distribution, macOS updates, and ADR 0002 (30).
  Everything that depends on the identifier is settled so the purchase does not force a rebuild.
- **Intel Macs**, per (14).
- **Linux token storage is not encrypted** — a 0600 file, documented as the honest gap in
  `DesktopSecureTokenStore`. A libsecret binding is the fix, and is worth having before anyone runs
  this on a shared Linux machine.
- **The release pipeline has never run.** Everything but the upload is verified locally; the upload
  is the one step that cannot be exercised without a real release.
