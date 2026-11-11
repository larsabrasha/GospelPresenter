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

**Not done yet.** The host's Google client built in (today `GP_GOOGLE_CLIENT_ID` and `GP_GOOGLE_CLIENT_SECRET` from
the environment, which a packaged app started from the Dock does not have); "2.0" in the version the app shows (today
the commit alone); updates (electron-updater on Windows and Linux; on a Mac a notice with a download link until
there is a signature, D32); building on Windows and Linux, and where the packages are published.
