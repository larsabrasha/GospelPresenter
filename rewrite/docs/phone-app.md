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

**Signing in** will run as the desktop app's does (`apps/desktop/src/main.ts`): in the system browser through
`/api/app-login`, the token handed back on the `gospelpresenter` scheme, since a passkey is bound to the server's
domain. A device on a host's LAN pairs with a code, as now.

**Updates outside the App Store** (Lars, 2026-11-03: hosted by us): the server hands out its own web bundle with
its version, and the app fetches it with Capgo's `capacitor-updater` in its manual mode from the server it talks
to, so the app and its server never drift apart, in the cloud or on a LAN. Changes to the shell itself (its
plugins, a native tab bar) still go through the App Store.

**Not done yet:** the shell (`apps/mobile`, app id `com.gospelpresenter.app`, iOS first), its sign-in through the
system browser, the bundle on the server and the updater, and Android.
