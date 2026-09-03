# 5. The desktop app ships as one binary per environment, not one that switches

- **Status:** Accepted
- **Date:** 2026-09-03
- **Scope:** `GospelPresenter.Desktop`, `GospelPresenter.Web/DeviceTokenEndpoints.cs`,
  `scripts/register-url-scheme-linux.sh`, and the desktop CI workflows
- **Builds on:** ADR 0002 (13) — schemes, servers and per-scheme identifiers — and (20)–(21), the
  file-system layout
- **Amends:** ADR 0003 (8), (9) and (10)/(13). Their reasoning stands; each turns out to have been
  written about the production installation specifically rather than about the app.

## Context

The desktop app had no way to talk to the test server. `Server:BaseUrl` shipped empty and
`GP_API_BASE_URL` was a developer's environment variable, so a released build ran the fixed
developer identity against its local database and signed in to nothing. That is a shipping
blocker on its own, and settling it means answering a prior question: is a build that talks to
`apptest.gospelpresenter.com` the same application as the one that talks to
`app.gospelpresenter.com`, or a different one?

The MAUI app answered this at (13): different, with its own `ApplicationId`, name and icon. But it
answered it with `DefineConstants`, because an iOS bundle has nowhere to put a setting before it
runs. A desktop app does — `DesktopSettings` said as much — which reopens the question rather than
settling it, because the cheap thing is now available: one installed app, a server setting, and a
switch somewhere in the UI.

## Decision

1. **Two packaged apps, three build schemes, and no runtime switch.** `-p:Scheme=` selects
   `GospelPresenterProd`, `GospelPresenterTest` or `GospelPresenterLocal`, and each is a separate
   installation: its own bundle identifier, display name, icon, data directory, device token and
   callback scheme. Prod is what a `v*` tag releases; Test is built on demand; Local is never
   packaged.

2. **A runtime switch was rejected on the database, not on taste.** The local SQLite database is
   the app's entire state, and what it holds is not merely *data from* a server — sync watermarks,
   tombstones and queued uploads only mean anything against the server that produced them. A
   switch therefore has two possible implementations: wipe on switch, which throws away whatever
   the operator had edited offline, or partition per server — which is two installations with one
   installer wrapped around them, for a choice no church volunteer should ever be shown.

3. **The environment is a packaging parameter, not `DefineConstants`.** One compiled binary; the
   scheme's values reach it as `AssemblyMetadata` and are read by `DesktopBuild`. This keeps what
   (13) decided while keeping what `DesktopSettings` observed: the values still come from the
   build, but they are data the app reads rather than branches it contains, so nothing downstream
   has a per-environment code path.

4. **`appsettings.json` stays an override, and is now the only one that is not ours.** The
   precedence is `GP_API_BASE_URL`, then `Server:BaseUrl`, then the scheme's URL. The middle one is
   not for moving between our own environments — the scheme does that, and gives the installation
   its own database and callback scheme, which a setting cannot — but so an organisation running
   its own server behind its own tunnel can point the released app at it without building anything.

5. **One URL scheme per installation: `gospelpresenter://`, `gospelpresenter-test://`,
   `gospelpresenter-local://`.** ADR 0003 (9) established that the claim has to be in the bundle;
   what it did not have to consider is that an operating system routes a scheme to *exactly one*
   application. Two installed builds claiming `gospelpresenter://` means a sign-in against one
   server hands its token to whichever of the two the OS picked — silently, and differently on
   different machines. The hyphen is legal (RFC 3986: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`)
   and works on macOS LaunchServices, the Windows registry and Android's `android:scheme`.

6. **The scheme is declared by the client and allow-listed by the server**, as
   `/app-login?callback_scheme=`, defaulting to `gospelpresenter` when absent. Not configured per
   deployment, which was the first design: a scheme identifies the *application*, not the server,
   and the same server serves apps that registered different ones. The default is what keeps the
   MAUI app working untouched — it asks for nothing and gets what it has always got.

7. **An allow-list, and an unknown value is a 400 before the token is minted.** The token travels
   in the fragment of the callback URL, so a scheme passed through unchecked would let anyone who
   can get a signed-in browser to `/app-login?callback_scheme=…` have a working device token handed
   to an application they control. Rejecting rather than falling back to the default matters for
   the same reason: a fallback would deliver the token to whichever app holds `gospelpresenter://`,
   which is the confusion the parameter exists to prevent. Rejecting *before* minting matters
   because a request that leaves a live token behind that no callback ever collects is a credential
   nobody knows exists.

8. **The data directory and the macOS keychain service carry the installation's name.** ADR 0002
   (21) said the layout splits automatically for the test scheme, and on Catalyst it did, from the
   bundle identifier. `DesktopPaths` inherited the reasoning and hardcoded one name, which was
   correct while one scheme existed and wrong the moment a second did. The keychain needs the same
   treatment for a reason the file system does not have: separate directories do not help there,
   because the login keychain is one namespace, so a Test build signing in would overwrite the real
   app's token.

9. **`AppFolderName` is not derived from the display name.** Prod stays `GospelPresenter` while it
   calls itself `Gospel Presenter`. Deriving it would rename the directory that existing
   installations keep their database, media library and device token in, and silently start them
   over with an empty library.

10. **The Test build has no update feed at all.** ADR 0002 (9) put beta testers on the production
    server, on the grounds that a beta running against test data is never used on a Sunday and
    therefore finds nothing — which leaves Test as a developer build with an audience of one. So
    `electron-builder.test.yml` names no publish provider and `IAppUpdater` is not registered,
    per (19). This is the safe answer and not only the cheap one: the only feed configured anywhere
    is this repository's GitHub Releases, which carries the real app's releases, so a Test build
    that looked for updates would find them and update itself into an application it is not. A
    channel would separate them; a channel is machinery to maintain for a build nobody needs
    updated in place.

11. **Local refuses to be packaged (`GP0003`), and an unknown scheme fails the build (`GP0002`).**
    Local is the default, so that a bare `dotnet run` never signs in against a real server — which
    means the release workflow must pass `-p:Scheme` and a run that forgets it should fail rather
    than release something nameless. A misspelled scheme would otherwise build: the props import is
    conditional on the file existing, so the app would come out with no server, no callback scheme
    and someone else's data directory, and nothing about the running app would say which scheme it
    was meant to be.

12. **The two halves of the scheme claim are checked against each other at build time (`GP0004`).**
    Answering a sign-in takes more than the server naming a scheme: the operating system has to
    know which application owns it. The app asks at runtime through
    `setAsDefaultProtocolClient`, and the packaging config's `protocols:` block is what becomes the
    durable registration — `CFBundleURLTypes` on macOS, registry keys from the NSIS installer on
    Windows, a `.desktop` file with `x-scheme-handler` on Linux. Those are two separate statements
    of one fact, in two file formats, and disagreeing produces no error anywhere: the browser is
    handed a URL the OS has no owner for, or hands it to a different installation of this app, and
    the sign-in waits out its five minutes. So `$(DesktopCallbackScheme)` is a property rather than
    only assembly metadata, and the build reads the YAML and compares. The match is on a stripped,
    delimited line, because `- gospelpresenter` is otherwise a substring of `- gospelpresenter-test`
    and the real app would validate against the test app's declaration.

    The server's allow-list is the third statement, and cannot be checked from this project. It is
    covered instead by a test case per scheme, so removing one breaks a test rather than an
    installation.

13. **Test builds come from a button, unlike releases.** ADR 0003 (12) made a pushed tag the only
    trigger, and the header of `desktop-release.yml` explains why a `workflow_dispatch` is not one.
    That rule is about the users' update feed — a published release makes every installed copy of
    the real app update itself. This workflow has no feed to publish to, so the worst a stray run
    produces is a download nobody asked for. There is no tag trigger available anyway: `v*` belongs
    to the release workflow and `web-*` to the container images.

## Consequences

- **An existing `~/Library/Application Support/GospelPresenter/` now belongs to Prod.** A default
  `dotnet run` moves to `GospelPresenter Local` and finds an empty database, and a later Prod
  install would open whatever a development build left behind — including the device token in the
  keychain under the service name `GospelPresenter`. Nothing migrates it; on a developer machine
  the answer is to move it aside, and no released app has ever existed to have data of its own.
- **A Test build against a server that predates (6) fails to hear back**, rather than taking the
  real app's place: the server ignores the parameter and answers on `gospelpresenter://`, which the
  Test build does not claim. That is the right way round of the two.
- **The `GP0004` check found that Local resolved a packaging config at all.** Local sets no
  `ElectronBuilderJson`, so the property falls through to ElectronNET's own default,
  `Properties/electron-builder.json` — which turns out to be written into the project by every
  build, from a template inside the package, declaring a portable exe and a tarball. ADR 0003's
  work deleted it from the index when the YAML replaced it, and it has been recreated and left
  showing as untracked on every build since, which reads like a file somebody forgot to commit. It
  is now in `.gitignore`, where build output belongs. Nothing was broken by it, because Local is
  never packaged — but it is why the check excludes Local rather than trusting the property to be
  empty, and why `GP0003` refuses to package Local rather than letting it fall through to whatever
  that file happens to say.
- **`register-url-scheme-linux.sh` registers `gospelpresenter-local://` by default**, since a
  `dotnet run` build is Local. Nothing registers a scheme for an unpackaged app on Linux, so
  without this the runtime claim has nowhere to land and a development sign-in ends in "No apps
  available". `GP_CALLBACK_SCHEME` overrides it for a build made with another
  `-p:Scheme`, and must be passed to `--remove` too.
- **The MAUI app is untouched and keeps one scheme across Prod and Test**, which is the same latent
  collision (5) describes — two installed MAUI builds can take each other's sign-ins. It is
  unchanged rather than fixed, and (6) is what makes fixing it possible without touching the
  server again. The Android half cannot be data: `[IntentFilter(DataScheme = …)]` needs a
  compile-time constant, so it would be `#if SCHEME_TEST`, and iOS needs a per-scheme
  `CFBundleURLTypes` through `PartialAppManifest`.
- **The desktop project still has no automated tests.** Not for want of trying to add them: a
  `dotnet build` of `GospelPresenter.Desktop` runs `npm install` and fetches Electron, so a project
  reference from `GospelPresenter.UnitTests` would pull that into every test run on CI. What is
  verified here is the server half, by three integration tests, and the desktop half by reflection
  against the built assembly plus a real macOS packaging run (`com.gospelpresenter.app.test`,
  `Gospel Presenter Test`, `CFBundleURLSchemes: [gospelpresenter-test]`, no `app-update.yml`).

## Open questions

- **Extracting the desktop host's pure logic somewhere testable**, so the precedence chain and the
  path derivation are covered by something other than a reflection probe.
- **A loopback redirect instead of a custom scheme**, which is what RFC 8252 prefers for native
  apps and which this host could use where the MAUI app cannot: it already runs an HTTP server on
  localhost, so `http://127.0.0.1:<port>/auth-callback` would remove the scheme registration, the
  per-installation claim and (5) entirely. It needs a second server-side branch and an allow-list
  of its own, so it is not obviously smaller — only differently shaped.
- **Whether Test ever needs installers that update themselves.** (10) says no on the strength of
  ADR 0002 (9). If a second person ever runs the test build, that is the assumption that broke.
