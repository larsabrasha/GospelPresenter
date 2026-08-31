# 2. App distribution and updates

- **Status:** Partly superseded — see the note below
- **Date:** 2026-08-28
- **Scope:** the MAUI app (`GospelPresenter/GospelPresenter`), macOS first
- **Blocked on:** an Apple Developer Program membership, which has been deliberately deferred — see
  (28) and *Open questions*

> **Superseded in part, 2026-08-29.** The desktop app moves to Electron.NET, which brings its own
> windowing, its own installer and its own updater. That retires everything here that was specific
> to shipping a Mac Catalyst bundle: Velopack (6), the `.pkg` and its per-user installer rewrite (5),
> the release workflow and the tag-to-three-versions derivation (8)–(11), and the Gatekeeper
> reasoning in (7). The decisions that were about *the product* rather than the toolchain still
> stand and carry over: direct download rather than an app store (2), macOS first (1), updates that
> apply at the next start and never interrupt a live presentation (16)–(18), the `IAppUpdater` seam
> (18), the file-system layout and its reasoning (20)–(23), the client version headers and protocol
> floor (24)–(25), and the two deferred features (29)–(30).
>
> The measurements that led here are in the commit history and in ADR 0003.

## Context

The MAUI app reached feature completeness on `offline-sync-foundation` (S1–S5 server-side, M1–M8
client-side) but has never been distributed to anyone. There is no installer, no release pipeline,
no version strategy, and no way to get a fixed build onto a machine that already runs an old one.
`maui-build.yml` runs `dotnet build` for four target frameworks and nothing else — no `publish`, no
signing, no artifacts.

The goal is the behaviour users already know from Chrome and Spotify: download once, double-click,
and never think about updates again. The audience is a shared computer in a church hall, operated by
whichever volunteer is on rota that Sunday. Nobody there is the machine's owner, nobody knows the
admin password, and nobody will act on an "update available" prompt.

Constraints that shaped the decisions below:

- **Velopack does not support `com.apple.security.app-sandbox`.** The updater replaces the whole
  `.app` bundle in place and uses AppleScript to request elevation when the bundle sits in a
  privileged location; the sandbox forbids both.
  ([docs](https://docs.velopack.io/packaging/operating-systems/macos))
- **macOS Sequoia removed the Control-click Gatekeeper bypass.** An unnotarized download now takes
  the user through System Settings → Privacy & Security → "Open Anyway" → confirm. Notarization is
  therefore not a polish item; it is the difference between the product working and not.
- **`GpMediaSchemeHandler` exists only for Catalyst and iOS.** Offline media is broken on Windows and
  Android, which rules Windows out of a first release.
- **`Application.OpenWindow` throws on Catalyst** ("The application does not support multiple
  scenes"), so the projector window does not work. The app cannot yet show anything to a
  congregation.
- **`FileSystem.Current.AppDataDirectory` resolves to the user's Library directory** on iOS and
  Catalyst. Sandboxed that is a private container; unsandboxed it is `~/Library` itself.
- `Settings.ApiBaseUrl` returns an empty string for all three build schemes, with a `// TODO`.

## Decision

### Reach and channel

1. **macOS (Mac Catalyst) is the only v1 platform.** Windows moves to 1.1, after WebView2 gets an
   equivalent of `GpMediaSchemeHandler` and the app has run on real hardware — shipping it now would
   distribute a known broken offline mode. iOS and Android are store platforms and get **no update
   mechanism of our own**; the store is the update mechanism.
2. **Direct download, not the Mac App Store.** The store would supply installation and updates for
   free, but at the price of a review queue on every release. The client is tightly coupled to our
   own sync protocol, so a fix to a sync bug must be able to reach users the same day. The sandbox
   requirement in (4) follows from this choice, not the other way round.
3. **Windows code signing is deferred** and the SmartScreen warning is accepted when Windows ships.
   Since 2023 an OV certificate requires a hardware token or cloud HSM; Azure Trusted Signing is the
   cheap route if the organization can be verified. Neither blocks macOS.

### macOS packaging

4. **App Sandbox is removed from `Platforms/MacCatalyst/Entitlements.plist`.** It was inherited from
   the template, not chosen: Developer ID distribution outside the App Store does not require it, and
   the `SecureStorage` failure that was blamed on it turned out to follow the ad-hoc signature. It
   costs us Velopack (see the constraint above) and it costs us the five file-access entitlements
   added when the file picker silently refused to appear. `network.client` goes with it — it is only
   meaningful under the sandbox.

   The keychain TODO in that file stands unchanged: `keychain-access-groups` is added when a real
   provisioning profile exists, and not before, because macOS `SIGKILL`s an app that requests an
   unprovisioned entitlement.
5. **Installed to `~/Applications`, not `/Applications`.** In `/Applications` every single update
   would raise an admin password prompt, on a machine where nobody can answer it. Chrome solves this
   with Keystone, a privileged helper installed once; Velopack offers no equivalent. Per-user
   installation makes the app invisible to other accounts on the same machine — which costs nothing
   on a church computer with one shared login, and is revisited if a congregation turns out to have
   per-volunteer accounts.

   *Amended when step 2 was built:* Velopack does not offer this as an option. It emits a `.pkg`
   whose `Distribution` enables both `currentUserHome` and `localSystem`, and macOS Installer then
   defaults its destination pane to "Install for all users of this computer" — landing in
   `/Applications`, which is the outcome this decision exists to prevent. The release workflow
   therefore rewrites `enable_localSystem` to `false` after packing, leaving the per-user
   destination as the only choice. Safe there because the release manifests hash only the `.nupkg`
   the updater downloads; the `.pkg` is listed by filename alone. Once signing is added this step
   must move ahead of it, or the `.pkg` must be re-signed with `productsign` — flattening a signed
   package invalidates its signature.
6. **Velopack is the updater.** It is MIT, .NET-first, produces a signed `.pkg`, supports delta
   updates on macOS, and is the maintained successor to Squirrel.Windows. NetSparkle was rejected as
   the wrong model — its appcast flow is built around notifying and asking, and (16) says we do
   neither. Squirrel.Windows is unmaintained and Windows-only. Chrome's own Omaha is open source and
   entirely unrealistic for a .NET app.
7. **Signed with Developer ID and notarized.** Not optional, per the Sequoia constraint.

   *Amended when step 2 was built without a certificate:* the original wording — "Velopack cannot
   update an app whose replacement bundle Gatekeeper refuses" — overstated it. The quarantine
   attribute is set by the program that downloads a file, so it lands on the `.pkg` a browser
   fetches and not on a bundle the running app replaces itself. What is unsigned therefore costs is
   the **first launch**: System Settings → Privacy & Security → "Open Anyway" → confirm, once per
   machine. Updates after that are expected to apply silently. Expected, not verified — nothing has
   been installed from a real release yet, and that is the first thing to check when one is.

   The pipeline is built and runs without the certificate: `vpk` warns and skips both steps rather
   than failing. The four flags to add are marked `TODO(signing)` in `.github/workflows/release.yml`.

### Release pipeline

8. **The feed is GitHub Releases.** The repository is public, so this is Fastly's bandwidth rather
   than ours, and `maui-build.yml` can publish with the built-in `GITHUB_TOKEN` without new secrets.
   Hosting the feed on our own Garage bucket was rejected for one reason: it would put the Cloudflare
   Tunnel on the critical path for a church computer being able to update itself.
9. **Two channels, `stable` and `beta`, both pointing at the production server.** A beta that runs
   against test data is never used on a Sunday and therefore finds nothing. Beta testers get an
   unlisted link; an in-app channel switch (Velopack supports `ExplicitChannel` at runtime) waits
   until somebody asks to leave the beta channel.
10. **A pushed tag triggers the release**, rather than every merge or a button in the Actions UI. It
    is the one gesture that is hard to perform by accident.
11. **Three version values are derived from the tag, because they cannot be the same string.**
    `v1.2.0-beta.1` yields the full semver `1.2.0-beta.1` for Velopack, which sorts the feed on it;
    the truncated `1.2.0` for `ApplicationDisplayVersion`, because `CFBundleShortVersionString` must
    be one to three period-separated integers; and `github.run_number` for `ApplicationVersion`,
    which must be a monotonically increasing integer. `Directory.Build.GospelPresenter.props` keeps
    `1.0` / `1` as a conditional local-development default. MinVer and Nerdbank.GitVersioning were
    rejected: they turn the version into something you read off the history rather than something you
    decide, which contradicts (10).

### Build schemes and servers

12. **`SCHEME_PROD` → `https://app.gospelpresenter.com`.**
13. **`SCHEME_TEST` → `https://apptest.gospelpresenter.com`**, with its own `ApplicationId`
    (`com.gospelpresenter.app.test`) and its own display name. Without a distinct identifier a test
    build overwrites the working app, which is precisely when you least want to lose it. The separate
    identifier also produces separate data directories for free — see (20).
14. **`SCHEME_BETA` and `Directory.Build.GospelPresenterBeta.props` are deleted.** With (9) putting
    beta on the production server, the scheme differs from `SCHEME_PROD` in nothing at all. A channel
    is a `vpk` parameter, not a build scheme. If side-by-side beta installs are ever wanted, that is a
    new `ApplicationId` added at that point, not an empty scheme maintained in anticipation.
15. **A new `Local` scheme carries the empty `ApiBaseUrl`.** Once every real scheme has a real URL the
    "no server configured → developer identity" branch in `Settings.cs` becomes unreachable, and
    leaving it in place would be a branch that looks alive but is only reached by accident. Making it
    a scheme keeps the ability to start the app with no server at all — useful when the work is a
    Razor component — while making it a choice. The `GP_API_BASE_URL` override stays as it is.

    *Decided during implementation:* `Local` also becomes the default scheme in
    `Directory.Build.props`, replacing `Test`. Now that Test points at a real server, defaulting to
    it would make a bare `dotnet build` sign in against `apptest.gospelpresenter.com` — a silent
    change to what every developer gets. Local preserves the behaviour a plain build has always had.
    It carries its own `ApplicationId` and title for the same reason Test does (13).

### Update behaviour

16. **Check periodically, download silently, apply on next start, plus a discreet restart button.**
    `SyncScheduler` already knows when the app is awake and when the network is up, so an update check
    rides along on infrastructure that exists. Checking only at startup was rejected because the
    machine this is for is switched on all week.
17. **The negative rule overrides everything: while anything is being presented, there is no
    restart, no prompt, and no toast.** An app that restarts itself at 10:55 on a Sunday has ended
    the service.

    *Amended during implementation:* the signal is `SharedAppState.HasActivePresentation`, not
    "`ILiveWindowLauncher` has an open window" as originally written. Two reasons, both fatal to the
    original. A remote display or the public output is just as live to a congregation as a local
    projector window, and the launcher knows about none of them. And on Mac Catalyst the projector
    window cannot open at all yet, so a guard asking the launcher would answer "nothing is live"
    on the one platform v1 ships to — a rule that is vacuously true is worse than no rule, because
    it reads as protection.
18. **Updating gets a seam in `Shared` (`IAppUpdater`), resolved optionally**, in the same shape as
    `ILiveWindowLauncher`, `IMediaUploader`, `IDeviceSignIn` and `IAppCapabilities`. The web app
    leaves it unresolved and the restart component never renders — exactly how `SyncStatusIndicator`
    already behaves. The rule in (17) then lives as a condition between two seams in shared code
    rather than inside platform code, and it becomes unit-testable, which a Velopack call never is.
19. **`VelopackApp.Build().Run()` goes bare at the top of `Platforms/MacCatalyst/Program.cs`**, before
    `UIApplication.Main`. Velopack requires it to be the first executable code: install, update and
    uninstall hooks execute and exit the process from inside `Run()`, so anything above it runs again
    during those operations.

### File system layout

20. **Paths are prefixed with the bundle identifier under Apple's conventional directories.**
    Unsandboxed, the four call sites that build on `AppDataDirectory` would write
    `gospelpresenter.db`, `identity.json`, `log.txt` and a directory named `media` into the root of
    the user's `~/Library`, next to Apple's own — and `media` is a name any application might want.
21. **Data and logs are separated, per Apple's File System Programming Guide.** Data goes to
    `~/Library/Application Support/{bundle id}/`; logs go to `~/Library/Logs/GospelPresenter/`. The
    log location is not cosmetic: Console.app indexes `~/Library/Logs`, so a volunteer can find and
    send a log without knowing what a bundle identifier is. Both split automatically for the test
    scheme, which has its own identifier (13) and its own display name.

    *Amended during implementation:* "automatically" required deleting `CFBundleName` from
    `Platforms/MacCatalyst/Info.plist`, where it was hardcoded to `GospelPresenter`. Hardcoded, it
    overrode `$(ApplicationTitle)` from every scheme's props, so all three schemes built the same
    name into the bundle — and since the log directory derives from it, Prod, Test and Local would
    have shared one `~/Library/Logs/GospelPresenter`. Verified after the change: the Test bundle
    reports `com.gospelpresenter.app.test` / `GospelPresenter Test`, Prod reports
    `com.gospelpresenter.app` / `GospelPresenter`.

    Only Mac Catalyst branches. iOS and Android are sandboxed by the OS and Windows already resolves
    under a per-application `%LOCALAPPDATA%`, so all three keep `AppDataDirectory` — moving them
    would relocate data to fix a collision they cannot have.

    ```
    ~/Applications/GospelPresenter.app
    ~/Library/Application Support/com.gospelpresenter.app/
    ├── gospelpresenter.db          MauiProgram.cs:61
    ├── identity.json               MauiProgram.cs:136
    └── media/                      MauiProgram.cs:96
    ~/Library/Logs/GospelPresenter/
    └── log.txt                     MauiProgram.cs:33
    ```
22. **`media/` lives in Application Support, not in Caches**, despite being an LRU cache with a 2 GB
    budget. `PendingUpload` entries are never evicted because they are the only copy of something the
    user added and the server has not seen. `~/Library/Caches` is a directory macOS may purge under
    disk pressure and cleaning tools empty routinely. Splitting the store — pending uploads in
    Application Support, evictable blobs in Caches — was rejected: it adds a "the ledger has it but
    the file is gone" state to the component that already carries pinning, eviction and the upload
    queue, and buys only that macOS gets to tidy up for us.
23. **The paths live in an `AppPaths` class in the MAUI project**, exposing `DataDirectory` and
    `LogDirectory` with a `#if` inside, and creating the directories in one place. Windows needs no
    prefix at all — `AppDataDirectory` is already namespaced under `%LOCALAPPDATA%` — which is why
    this is a platform branch rather than a shared path. A seam in `Shared` would be the wrong level:
    the web app has no file system problem, so the interface would have exactly one implementation.

### Observability and rollback

24. **Two headers on sync requests: `X-Client-Version` and a separate `X-Client-Protocol`.** GitHub's
    download counter says nothing about which version is *running*, and that is the number that
    decides whether the protocol floor can be raised. The client already calls `/api/sync/pull`
    regularly with a device token, so this costs one header and no new round trip. The protocol
    number is kept apart from the app version deliberately: the app can go 1.2.0 → 1.9.0 in bug fixes
    without the sync contract changing once, and the server should not have to care.

    *Decided during implementation:* the admin view is `/admin/devices`, gated on the existing
    `ViewUsers` rather than a new `ViewDevices`/`ManageDevices` pair. A device belongs to a user, the
    audience is the same one that may see the user list, and the page is read-only — revoking is
    already the device owner's action through `/api/device-tokens`. Adding a permission for a
    diagnostic page is more machinery than the gate is worth. The version is recorded on
    `DeviceToken`, written on the throttled `LastUsedAt` update the auth handler already performs, so
    it costs no extra round trip; the column is bounded at 32 characters because the value arrives in
    a client-controlled header.
25. **The server enforces a minimum protocol version** and answers `426 Upgrade Required` below it.
    Promising indefinite backwards compatibility in a sync protocol still under development is a
    promise that gets broken as data corruption on a user's machine rather than as an error message.
26. **There is no rollback.** A bad release can be deleted from GitHub Releases so nobody new fetches
    it, but clients that already updated stay updated. The only way out is to ship a higher version
    number containing the old behaviour. Accepted; the alternative is a downgrade path that would be
    exercised approximately never and therefore be broken when needed.

### Migration and sequencing

27. **The data directory move is not handled.** Removing the sandbox moves `AppDataDirectory` out of
    the container, and (20) moves it again into a prefixed subdirectory — two relocations, both
    landing on an empty database. Nobody has the app installed, so a one-time migration would be code
    that runs once in its life and then stays forever as something a future reader must understand.
    The developer machine's sync journal is emptied once before the change; the last Aspire run left
    it empty already.
28. **The update mechanism is built before the projector window is fixed**, and before the Apple
    Developer Program membership is bought. Both were argued against and the decision stands: see
    *Open questions* for what that costs.

## Consequences

- **Nothing shippable exists until the Apple account is bought.** Without a Developer ID certificate
  there is no notarization, and without notarization the download takes a volunteer through four
  steps in System Settings — the opposite of the stated goal. Velopack falls with it, since Gatekeeper
  refuses the replacement bundle too.
- Per-user installation means the app is invisible to other macOS accounts on the same machine.
- Leaving the sandbox means the app can read the user's file system. That is what makes the file
  picker work at all, and it is the normal posture for a Developer ID app, but it is strictly less
  confinement than today.
- `media/` can occupy up to 2 GB in a directory the system will never reclaim.
- Windows users get nothing in v1, and the Windows target continues to be verified only by
  compilation in CI.
- Raising the protocol floor will lock out clients that have not updated. That is the point, and it
  is why (24) exists — the floor is only raised against a measured version distribution.

## Decided but not built

These came out of writing the download page, which exposed that the shipped app can only ever talk
to `app.gospelpresenter.com` — so a church that self-hosts can install it and then not sign in. The
website says so plainly for now; these two remove the limitation.

29. **A server field on the sign-in screen**, prefilled with `app.gospelpresenter.com`. The sign-in
    screen is the only place where "which server" is a question the user is already asking, and the
    only moment at which no local data is orphaned without anyone noticing — the local SQLite
    database holds one server's rows under that server's ids, so pointing the app elsewhere without
    clearing it mixes two worlds in the same tables. Changing the address therefore wipes local data
    through the path `RequiresFullResync` already uses, behind an explicit confirmation; signing out
    keeps the data, as it does today.

    Note for whoever builds it: `Settings.ApiBaseUrl` is read while the DI graph is built — the
    sync `HttpClient`'s `BaseAddress` among them — so the address cannot change mid-session. It
    belongs in `Preferences`, read at startup, with the change taking effect on the next launch.

30. **The update feed URL comes from the server, but not yet.** A self-hosted instance has to be
    able to say where *its* updates live, since ours are on our GitHub. The server grows the
    metadata field and an endpoint to serve it; the client does not obey it.

    The reason for the split is that obeying it is a code-execution decision, not a configuration
    one. Velopack's only integrity check today is a SHA listed in the manifest **from the same
    feed**, and there is no code signature behind it (7). A server that names the feed can therefore
    make the client download and run anything. The argument that this is acceptable — the server
    already holds all of a congregation's data and issued the device token — holds only once a
    signature proves the package came from us. Until then the feed URL stays compiled in.

    So: build the endpoint and the field now if convenient, and gate the client on the certificate.
    Do not let this become a `TODO` that is quietly satisfied by shipping the feature.

## Out of scope / follow-ups

- The Windows release: the WebView2 media scheme handler, `WindowsAppSDKSelfContained`, a second
  `vpk pack`, and a decision on code signing (3).
- In-app channel switching (`ExplicitChannel`), for beta testers who want out.
- A privileged helper for `/Applications`-wide installation, if per-user turns out to be wrong.
- Enterprise deployment (MSI/PKG for unattended rollout).
- Real telemetry (Sentry or equivalent), when there are hundreds of installations rather than none.
- Moving the Apple membership from an individual to an organization account, which requires a D-U-N-S
  number and takes weeks. Apple permits the transition later.

## Open questions

- **When is the Apple Developer Program membership bought?** Everything in *Release pipeline* and
  *macOS packaging* except (4) is blocked on it, and the approval wait is the one part that cannot be
  compressed by working harder. Until then the `IAppUpdater` seam has no implementation behind it —
  the weakest item in the first implementation step, and the only one that does not pay for itself
  immediately.
- **When does the projector window get fixed?** `Application.OpenWindow` is unavailable on Catalyst
  and the next route must avoid `UIScene` entirely: an AppKit `NSWindow` with a reparented
  `WKWebView`, through the same ObjC runtime interop as `MacExternalDisplayService`. Until that
  works, this ADR describes how to distribute a presentation application that cannot present.

## Implementation order

1. **Now, without the Apple account.** ✅ *Done.* Sandbox removed from `Entitlements.plist` (4),
   verified absent from the signed bundle; `AppPaths` and the four relocated paths (20)–(23);
   scheme cleanup — `SCHEME_BETA` and its icon deleted, the two real URLs filled in, `Local` added
   and made the default (12)–(15); version properties made overridable from CI (11), verified with
   `-p:ApplicationDisplayVersion=1.2.0 -p:ApplicationVersion=4711`; the `IAppUpdater` seam and
   `UpdateAvailableIndicator` with the live-presentation rule (17)–(18); `X-Client-Version`,
   `X-Client-Protocol`, the `ClientProtocolFloorFilter` and `/admin/devices` (24)–(25).

   `IAppUpdater` has no implementation behind it — that is step 2, and it is the known cost of
   deferring the Apple account. The seam, the component and the rule are testable and in place.
2. **The rest, built without waiting for the certificate.** ✅ *Done, except signing.* Velopack
   integration (6), (19) — `MauiAppUpdater`, registered only where a feed exists, so Test and Local
   never look for updates; `.github/workflows/release.yml`, tag-triggered, deriving the three
   versions and the channel from the tag (8)–(11); the per-user installer fix (5); `stable` and
   `beta` channels (9); the download section on `www.gospelpresenter.com`, detecting the platform in
   JavaScript and reading the version from the GitHub Releases API so it never needs redeploying
   when a release ships.

   `vpk pack` was run against a real Catalyst bundle to confirm it accepts one: it produced a
   66 MB `.pkg`, a portable `.zip`, the `.nupkg` and `releases.beta.json`, warning about the missing
   signing identities rather than failing.

3. **Still waiting on the Apple Developer Program.** The four `TODO(signing)` flags in the release
   workflow, and moving the installer-domain rewrite ahead of signing (5). Until then the first
   launch on any machine needs the Gatekeeper detour, which the download page states in plain
   language rather than as a footnote.
