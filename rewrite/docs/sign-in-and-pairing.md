# Sign-in, membership and pairing

Sign-in is with Google or a passkey, and nothing else: no passwords and no generic OIDC provider
(ADR 0007 decision 12). A user has one or more logins in `user_logins`: a Google account, linked by
its `sub`, and passkeys, by their credential id. One user may have both kinds, and signing in either
way lands on the same user. The email is only filled in, and never used to find a user (spec 01,
AUTH-R4). There is no self-registration: a Google account or passkey that is not linked is refused.

The first start of the host shows "Välkommen!": the person names themselves and the church, and setup
answers with an invite for the new SuperAdmin, which they accept by making a passkey or signing in
with Google. Setup is done when that link exists; until then it can be done again, and finishes the
same SuperAdmin rather than making a second church. The host window gets the setup token from the main process; a server
without one prints it (`Setup token: …`) and the setup form asks for it (D19). After that every
account comes from an admin: Användare → Skapa makes the user and an invite link, shown once, valid
for 7 days and once (AUTH-R1). The invited person opens it and makes a passkey or signs in with
Google, and that becomes their way in. A new invite for a user is the reset: the login that accepts it
replaces every login the user had, passkeys and Google alike, and the user's sessions end.

Under Inloggningsmetoder (in the menu behind the user's picture in the top bar) a signed-in user sees their own logins, adds
a passkey, links a Google account, renames a passkey and removes any login but the last. Adding needs
a sign-in from the last 10 minutes, made by the user themselves (not by a pairing); otherwise the page
asks them to sign out and in again. Linking a Google account that is already another user's is
refused (`login-taken`). Nothing takes a user id: no one, an admin included, adds or removes another
user's logins. An admin's new invite is the only way back for someone who lost every login. The same page changes roles and removes users, with spec 01's
rules (PERM-R4–R6, D20, D21) in `packages/core/src/accounts.ts`, which the server and the UI share.

How the sign-in runs (`apps/server/src/google.ts`, `auth/sign-in-routes.ts`): the authorization code flow with PKCE
(S256), `state` and `nonce`, and `prompt=select_account`. A sign-in in progress is a row in
`login_flows`: single use, 10 minutes, and bound to the browser that started it by a cookie, so a
callback from another browser, a forged `state` or a replay is refused. The ID token is checked with
Web Crypto: RS256 only, against Google's published keys (cached, fetched again for a new key at most
once a minute), then `iss`, `aud`, `exp`, `iat`, `nonce`, `sub` and `email_verified`. Why a sign-in was
refused goes to the server log; the user sees one generic error (spec 01). A browser comes back to
`/signed-in`, and the page collects its session with a one-time cookie (`POST /api/auth/google/finish`),
so no token is in a URL.

The desktop app never shows Google in its own windows. It opens the server's `/api/app-login?device=…&
callback_scheme=…` in the system browser (spec 01 device sign-in), or, to accept an invite, a flow its
window began; the server hands the token back on the app's callback scheme in the URL fragment. The
schemes are `gospelpresenter`, `gospelpresenter-test` and `gospelpresenter-local`, compared exactly;
any other is refused before a sign-in even starts, and no token is minted (AUTH-R10). The app waits 5
minutes for one callback and ignores any other. A development build uses `gospelpresenter-local` and
registers it with the operating system only with `GP_REGISTER_SCHEME=1`, so a dev run does not take
over the scheme; on macOS it then arrives as `open-url`, elsewhere as a second launch.

Signing in needs the internet once. After that the host opens straight into its own database with
its session, with no network. On a host, the system browser's sign-in is answered only from the host
machine itself (loopback): a device on the LAN never signs in with Google against the host.

A sign-in gives the device a session token (`gpdt_…`, only its SHA-256 stored). Every request reads
the session and the user's role from the global tables (D22): a demoted user's next pull starts over
with the new role, and a removed user's next request gets 401. A signed-in device opens straight into
its own database with no network; when the server refuses it, sync stops, local edits wait, and a
strip under the top bar asks it to sign in again (SYNC-A15).

The desktop host refuses every API request from a device it has not paired, on localhost too: only
the static app and `/api/pair/status`, `/api/pair/claim` answer (and the sign-in above, from the host machine).
Its own window's requests carry a host token that the Electron main process adds and no page sees. On
the host, Enheter → Anslut enhet asks who the device signs in as (the admin, or a member they may make
an invite for), and shows a six-digit code (10 minutes, one use, dead after five wrong guesses); the
other device types it and gets a device token (`gppd_…`) and a session as that member. Pairing is how
a device signs in to a host, also after its session ends. Enheter also disconnects a device, which
stops it and ends the session its pairing made. `pnpm --filter @gp/desktop serve` has no pairing
unless `GP_LAN=1`.

**Configuration of passkeys.** An explicit RP ID and the exact origins ceremonies may come from;
without both, passkeys are off and `/api/auth/state` says so. Node: `startNodeServer({ passkeys: { rpId,
origins } })`, and `GP_PASSKEY_RP_ID`, `GP_PASSKEY_ORIGINS` (comma-separated) for `serve`. The Worker:
`PASSKEY_RP_ID`, `PASSKEY_ORIGINS` (vars, not secrets; e.g. `app.example.org` and
`https://app.example.org`). The desktop host always has RP ID `localhost` and origin
`http://localhost:{port}`. A wrong configuration stops the server at start: an IP address as RP ID, an
origin that is not on the RP ID, or plain http anywhere but localhost.

**Configuration of Google.** Node (`startNodeServer({ google })`, and `GP_GOOGLE_CLIENT_ID`,
`GP_GOOGLE_CLIENT_SECRET`, `GP_GOOGLE_REDIRECT_BASE_URL` for `serve`): the client id and secret, and
the public origin the redirect URI is built from (`{origin}/api/auth/google/callback`; without it, the
origin of the request). The desktop host reads `GP_GOOGLE_CLIENT_ID` and `GP_GOOGLE_CLIENT_SECRET`;
its redirect is `http://127.0.0.1:47800/api/auth/google/callback`. The Worker reads `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` (a secret) and `GOOGLE_REDIRECT_BASE_URL`. Without a client id and secret,
Google is off: `/api/auth/state` says so, and its sign-in is refused (503 `google-disabled`). With neither
Google nor passkeys, setup is refused too. Paired devices and sessions already made keep working.

**The fake Google** (`apps/server/test/fake-google.ts`) is an OIDC issuer with its own key, JWKS,
authorization and token endpoints, for the server tests and the e2e. A server uses it only through
`GoogleConfig.testIssuer` (`GOOGLE_TEST_ISSUER`, `GP_GOOGLE_TEST_ISSUER`), and only in a build that
defines `GP_TEST_ISSUER` as true: the Vitest config, the Miniflare harness and the development
desktop build. `pnpm --filter @gp/server build:worker`, `wrangler.toml` and a desktop build with
`GP_RELEASE=1` define it false, and such a build refuses to start with a test issuer set (tested for
the Worker deploy bundle and for `google.ts` bundled with and without the definition). A packaged
desktop app (`app.isPackaged`) also never reads `GP_GOOGLE_TEST_ISSUER`.

## Passkeys

How a ceremony runs (`apps/server/src/webauthn.ts`, `auth/passkey-routes.ts`): `POST /api/auth/passkey/begin` with
`mode` `signin` or `register` (with an invite, or for the caller's own session) makes a row in
`passkey_flows` with a fresh 32-byte challenge: single use, 5 minutes, bound to the browser by a
cookie, and to its kind, so a registration's challenge never signs anyone in. `POST
/auth/passkey/finish` finds the flow by the challenge in the client data, uses it up, and verifies with
Web Crypto, no library: the client data's type, origin (exactly one of the configured origins) and
`crossOrigin`, the RP ID hash, the user-present and user-verified flags (verification is required), the
signature over the authenticator data and the client data hash, and the user handle (the owner's
random user id). Keys: ES256, EdDSA (Ed25519) and RS256 of 2048 bits or more. Attestation "none" is
asked for and nothing is trusted from a statement; a packed self-attestation is checked. Passkeys are
discoverable, so sign-in names no user. The signature counter: 0 that stays 0 is fine (synced passkeys
keep none); otherwise it must grow, or the sign-in is refused as a possibly cloned passkey. A passkey
row keeps its COSE public key, counter, transports, a name the user chose, and when it was made and
last used. At most 20 unfinished ceremonies per address, as for Google; at most 5 logins per user
(ORG-R13).

**A passkey is bound to its RP ID.** One made for the cloud's domain does not work on a desktop host,
whose RP ID is `localhost`, and one made on a host works only on that host's machine. LAN devices still
join a host by pairing; a page from the host over `http://192.168.…` is not a secure context and could
not use a passkey anyway.

**The desktop app** runs every ceremony in the system browser, through the same `/api/app-login` device
flow (`?method=passkey`) or a flow its window began (`/api/auth/passkey/start?flow=…`), and the server
hands the token back on the callback scheme, as for Google. Not in Electron: its support for platform
authenticators (Touch ID, iCloud Keychain) is unreliable, and in the e2e a sign-in with a discoverable
passkey failed in an Electron window while it works in Chromium. The window's origin, `127.0.0.1`,
could not be an RP ID either: browsers refuse IP addresses. So the system browser opens the host at
`http://localhost:47800` for passkeys, while Google's sign-in stays on `127.0.0.1`, where its redirect
URI is registered; each sign-in stays on one host name from start to end, so its cookie holds. Adding
a passkey from the desktop opens the system browser too; the page then watches its list for the new
one. A passkey on the host needs no internet.

## Schema versions

A database records its schema version in `_schema`. The organisation database's migrations were dropped
before the first release (2026-10-29): it is made from one DDL, `orgDdl`, which is version 11
(`SCHEMA_BASELINE`; the numbering goes on, so an older file is never taken for a current one). A server or a
client refuses an organisation database older than that, with "delete it and start again": on a device,
clear the site's data. A change after the
baseline is a migration in `orgMigrations` again, run when the database is opened; a client then pulls
everything again, because the schema is part of the pull cookie. The server's global database has
its own version (`GLOBAL_SCHEMA_VERSION`, now 4): the placeholder memberships of milestones 1 and 2
are dropped when it migrates, so data made by the old desktop host belongs to no account afterwards.
Version 3 drops milestone 3's passwords and its per-account lockout, and adds `user_logins` and
`login_flows`; users, memberships and sessions stay. Nobody has a linked login after it, so setup opens
again and finishes the existing SuperAdmin and church; other users need a new invite, or on a host a
new pairing. Version 4 adds passkeys: columns for the key, counter, transports and name in
`user_logins`, the link columns in `login_flows`, and `passkey_flows`. Every login and session stays.
The global database keeps its migrations.
