# The phone app

The web app, unchanged, in a thin Capacitor shell for iOS and Android (ADR 0007 (7); Lars, 2026-11-03: one code base,
Electron on computers and Capacitor on phones, no native GUI or Rust core for now). The shell gives what a browser
over plain http on a church's LAN cannot: storage that lasts, the clipboard, sharing, haptics, and the App Store.

**Which server.** In a browser and the desktop app the app talks to the server it came from. The phone app is in the
phone, so `apps/web/src/server.ts` decides: the cloud by default, built in as `GP_APP_SERVER` when the phone app's
web bundle is built (`apps/web/vite.config.ts`), or a church's own server typed under "Server: … Ändra" at the foot
of the sign-in page (`apps/web/src/pages/ServerChoice.tsx`), shown only in the phone app's build, as apps one may
host oneself have it. A typed address is tried as https and then http, and taken only once a Gospel Presenter
server answers its `/api/auth/state`; the app then starts again against it. Every call goes through `serverUrl`
(the `api()` helper, the database worker, the live and sync sockets, video uploads and streams); links others
open (invites, public outputs) are built on `serverOrigin`. The public pages (`/display`, `/watch`) always run in a
browser and keep their own origin.

**CORS.** The shell's pages come from `capacitor://localhost` (iOS) and `https://localhost` (Android), so its calls
are cross-origin. `apps/server/src/cors.ts` answers those two origins' preflights and marks their answers, on the
Node host and in the Worker alike, before any guard; every other origin is answered as before. The app signs in with
a bearer token, never a cookie, so letting the two origins in lets in no one's session.

**The shell** is `apps/mobile` (Capacitor 8, app id `com.gospelpresenter.app`, iOS only so far). `pnpm --filter
@gp/mobile sync` builds the web app into `apps/mobile/www` with `GP_APP_SERVER` (`apps/mobile/build.mjs`; the test
environment on Cloudflare unless `GP_APP_SERVER` is set) and copies it into the Xcode project; `pnpm --filter
@gp/mobile ios` also builds and starts it on a simulator, and `open` opens Xcode. The bundle is built outside turbo,
since it differs from the browser's by that one value. The native code is two files of the app's own:
`ios/App/App/AppViewController.swift`, Capacitor's view registering the plugin, and `WebAuthPlugin.swift`.

**Safe areas.** The page reaches the screen's edges (`viewport-fit=cover`, `apps/web/index.html`), in the phone app
and in a browser alike, and keeps what it draws out of the status bar, the notch or island, the corners and the home
indicator: the body is padded by the safe area at the top and sides (`px-safe-top` in `apps/web/src/app.css`), and a
layer fixed over the whole screen pads itself (a dialog with `p-safe-4`, at least 1rem; the phone's live view, a toast, the error bar, a public
output's text). A background still reaches the edges, at the foot too (Lars, 2026-11-03: a strip of the page's colour
under the columns looked unfinished): what stands there keeps above the home indicator by `pb-safe-*` and
`bottom-safe-*` (a page's scroll, a column's last line, the columns' toggles, Inställningar's +). Typing keeps it so too: the keyboard makes the web view shorter
(Capacitor's Keyboard plugin, `resize: native`, `apps/mobile/capacitor.config.ts`) rather than pushing the page up under
the status bar, the field being typed in is scrolled back into view when the page gets shorter (`apps/web/src/main.tsx`),
and on iOS the page has a largest scale of 1, since iOS zooms into a field under 16 px and stays zoomed (the song's text
is 15 px). Tried on an iPhone 17 Pro simulator, standing and lying down, with the keyboard up: the start page, the song
page from a presentation, Skapa presentation, an item's sheet and the phone's live view. Not tried: an iPad, Safari, a
phone without a notch.

**A reload** (a change of language or organisation) once left the phone app blank: iOS's web view kept the old page's
database worker, and the database file's lock with it. The page now ends its worker on `pagehide` (`apps/web/src/db/db.ts`), where the database is a
file: a host window's is in memory, and ending its worker there left a reload under load hanging in the e2e tests,
for a reason not found.

**Signing in** runs as the desktop app's does (`apps/desktop/src/main.ts`): never in the app's own web view, since
`capacitor://localhost` cannot be a passkey's RP ID and Google refuses a web view. The same `/api/app-login` opens in
ASWebAuthenticationSession, iOS's sheet for signing in (`WebAuthPlugin.swift`), which shares Safari's passkeys and
cookies and asks once whether the app may sign in with the server's site. The server hands the token back on
`gospelpresenter://auth#token=…`; the sheet catches that scheme itself, so it needs no registering and no other
app can take it. `apps/web/src/auth/appSignIn.ts` is the web app's side for both apps; Capacitor's JavaScript is
loaded only in the phone app's build. Closing the sheet goes back to the sign-in button without an error. A device
on a host's LAN pairs with a code, as now.

**Updates outside the App Store** (Lars, 2026-11-03: hosted by us): the server hands out its own web bundle with
its version, and the app fetches it with Capgo's `capacitor-updater` in its manual mode from the server it talks
to, so the app and its server never drift apart, in the cloud or on a LAN. Changes to the shell itself (its
plugins, a native tab bar) still go through the App Store.

**Tried** (2026-11-03, iPhone 17 Pro simulator, iOS 26.2, Xcode 26.2): the app starts against the test environment,
shows its sign-in page with the server at its foot, and "Logga in med passkey" opens the sheet on the server's passkey
page; closing the sheet goes back to the button. Not tried: a whole sign-in (the simulator has no passkey, and the
test environment has no Google), the app once signed in (the database on OPFS in WKWebView, the live and sync sockets,
media), a church's server over http or a self-signed https on a LAN (WKWebView likely blocks the first as mixed content and refuses the second's certificate), a
real iPhone or iPad, and signing for the App Store.

**Not done yet:** the bundle on the server and the updater; the app's icon and launch screen (Capacitor's
placeholders); Android.
