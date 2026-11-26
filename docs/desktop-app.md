# The desktop app's packages

The desktop app packaged as D32 decides (ADR 0007): electron-builder, a `.dmg` to install and a `.zip` for the
updater on macOS, an NSIS installer on Windows and an AppImage on Linux. Version 2.0.0-beta.1 (Lars, 2026-10-31: the
rewrite ships as 2.0), app id `com.gospelpresenter.desktop` (the phone app's is `com.gospelpresenter.app`, a separate
app).

**Making them.** From the repository's root:

```sh
pnpm --filter @gp/desktop release                 # this system's packages, in apps/desktop/release/
pnpm --filter @gp/desktop release -- --dir        # the .app (or folder) alone, no installer: quicker to try
```

`apps/desktop/release.mjs` builds through turbo with `GP_COMMIT` (the sign-in page's version) and `GP_RELEASE=1` (a
main process that refuses a fake Google, `build.mjs`), both part of turbo's hash so a release build is never taken for
a development one; then it runs electron-builder with `apps/desktop/electron-builder.yml`. On a Mac it makes both
arm64 and x64, about 130 MB each. Only `dist/main.mjs` and `dist/preload.cjs` go into `app.asar`, everything bundled;
the web app goes beside it in `Resources/web/dist`, where the main process looks (`../../web/dist` from `dist/`).

**Releases.** A pushed tag `v…`, the version in `apps/desktop/package.json` (`v2.0.0-beta.1`), builds the packages
in GitHub Actions (`.github/workflows/desktop-release.yml`, as 1.x did; Lars, 2026-11-26) into a draft release, each
on its own system: macOS arm64 and x64 (`.dmg`), Windows (NSIS `.exe`), Linux (AppImage, `.deb`, `.rpm`, `.pacman`,
the native three under the package name `gospel-presenter`). A version with a dash is a pre-release. The draft is
published by hand. The server and web app have tags of their own, `web-v…` (`web-release.yml`): the Docker image
gets the version's tag and a draft release says how to pull it; Cloudflare is deployed by hand
([cloudflare.md](cloudflare.md)).

**Google in a package.** A desktop host signs in with Google and passkeys alike, as the web does (Lars, 2026-11-26).
A release carries its own Google client, built in by `build.mjs` from the repository's secrets `GP_GOOGLE_CLIENT_ID`
and `GP_GOOGLE_CLIENT_SECRET` (the workflow refuses to build without them); `GP_GOOGLE_CLIENT_ID` and
`GP_GOOGLE_CLIENT_SECRET` in the environment still win. That client is of Google's type "Desktop app", a client of
its own beside the web's, never the web's: an installed app holds nothing secret, and Google does not treat a desktop
client's secret as one. The sign-in is protected by PKCE (`google.ts`) and by its redirect to loopback,
`http://127.0.0.1:47800/api/auth/google/callback`, which a desktop client allows. Someone who took the client from a
package could show Google's consent screen in Gospel Presenter's name, for name and e-mail only; the web's client is
untouched.

**What a package holds.** The callback scheme `gospelpresenter`, registered by the package itself (Info.plist on a
Mac, the installer elsewhere), so the system browser can hand back a sign-in. The icon,
`apps/desktop/build/icon.png`: the logo on a white plate with rounded corners in Apple's 824-of-1024 grid, made from
the current app's 1024 px favicon. A packaged app keeps its data in the system's place for it (on a Mac
`~/Library/Application Support/Gospel Presenter`), or `GP_DATA_DIR`.

**Signing.** macOS: ad-hoc only, no Developer ID and no notarization (D32). A downloaded copy is blocked at its first
start; the user allows it under System Settings → Privacy & Security → "Open Anyway". Windows: not signed, so
SmartScreen warns. A copy built on this computer carries no quarantine and starts at once.

**Tried** (2026-11-03, on an Apple Silicon Mac): the arm64 `.app` starts from a fresh data folder, is the host on
127.0.0.1:47800, serves the web app with this commit as its version, and its signature verifies
(`codesign --verify --deep --strict`). Not tried: the x64 build on an Intel Mac, the `.dmg` installed from a download,
signing in through the system browser with the packaged scheme, and the Windows and Linux packages, which are not
built on a Mac.

**Not done yet.** "2.0" in the version the app shows (today the commit alone); updates (electron-updater on Windows
and Linux; on a Mac a notice with a download link until there is a signature, D32), so a release writes no update
feed (`publish: null`). The Windows and Linux packages are built only in GitHub Actions and not tried on those
systems; the AppImage runs without `--no-sandbox`, which 1.x's needed on some distributions.
