# The LAN, https, the service worker, a reverse proxy and addresses

## A tablet over plain http

A phone or tablet that opens the desktop host at its LAN address over http is not a secure context (ADR 0007
decision 7: https on the LAN was rejected). It has no OPFS, so it keeps its data in memory and says so; no
`crypto.randomUUID`, so ids come from `randomId` (core), which falls back to `getRandomValues`; and no
`crypto.subtle`, so SHA-256 (checking every downloaded picture, audio file and Bible text, and naming an import)
is plain JavaScript (`packages/core/src/sha256.ts`). That runs on the database worker's thread, so it gives
the thread back every 256 KiB: hashed in one go, a 19 MB audio file being fetched held the page's queries, and
"Ta kontroll" took about 830 ms with the CPU slowed four times, against about 125 ms now
(`apps/desktop/e2e/performance.spec.ts` keeps it under 500 ms). `apps/desktop/e2e/remote.spec.ts` opens the
host from Chromium at the machine's LAN address and checks it is not a secure context.

## https on the LAN

The desktop host can serve the LAN over https with a certificate the operator provides, so a tablet that trusts
it is a secure context: its database is a file in OPFS that survives a reload, and it has Web Crypto. ADR 0007
decision 7 rejected https on the LAN as the way for every church, since every device must trust the
certificate; this is an option for whoever is willing to set that up, beside plain http (see [A tablet over
plain http](#a-tablet-over-plain-http)) and the tablet app to come.

```sh
GP_LAN=1 GP_TLS=self-signed pnpm --filter @gp/desktop start                         # the host makes its own certificate
GP_LAN=1 GP_TLS_CERT=cert.pem GP_TLS_KEY=key.pem pnpm --filter @gp/desktop start   # or brings one; https on :47843 (GP_TLS_PORT)
```

`GP_TLS=self-signed` is the way of the author's other apps (`@vitejs/plugin-basic-ssl`): the host makes a
certificate with openssl for its LAN addresses, its `.local` name and localhost, keeps it in its data folder
(`tls/`), and makes it again only when it has an address the certificate does not name (not when its networks are
listed in another order, nor when one goes away; a new one names the old addresses too). Each device accepts it
once in its browser's warning. Whether Safari then counts the page as a secure context and allows its worker
and `wss` is not tested here (the e2e accepts it in Chromium).

With a certificate, the LAN gets https only: plain http stays on 127.0.0.1 for the host's own window, so
Electron, passkeys at `localhost` and Google's redirect URI are as before. Links the host shows for other devices
(remote control, invites) use https on that port, at the LAN address, or at `GP_TLS_HOSTNAME` if set (when the
certificate names the Mac's `name.local` rather than its address). The same app, API and sockets answer on both
(`startNodeServer({ tls })`); `apps/server/test/tls.test.ts` checks pages, the API and both sockets over https,
and that a client that does not trust the certificate cannot connect; `apps/desktop/e2e/https.spec.ts` has a
browser that trusts it pair, keep its database in OPFS through a reload, and keep working when the host goes.

Making a certificate an iPad trusts, with mkcert (`brew install mkcert`): `mkcert -install`, then
`mkcert 192.168.1.59 $(scutil --get LocalHostName).local` (the Mac's LAN address and name) for the two PEM
files. On the iPad: send it `$(mkcert -CAROOT)/rootCA.pem` (AirDrop), install the profile under Settings, and
switch on full trust under Settings → General → About → Certificate Trust Settings. Then open
`https://192.168.1.59:47843`. With the host gone the open page keeps working from its database, and a service
worker keeps the page itself, so a reload starts the app too (see [Starting the app without the host](#starting-the-app-without-the-host)). Not
tested on a real iPad: whether Safari there gives the database worker OPFS's synchronous access handles, which wa-sqlite uses.

## Starting the app without the host

A device over https on the LAN keeps the built web app in a service worker, so it can reload, or open any
page of the app by its address, while the host is gone; its data is already in OPFS. The worker is
`apps/web/sw/sw.ts`, about 60 lines and no library, built by a small Vite plugin in `apps/web/vite.config.ts` as
`/sw.js`. The plugin writes into it the build's files (index.html and everything under `/assets/`: the scripts,
the database worker, wa-sqlite's wasm, the CSS, fonts and the background) and a hash of their contents.

- **One cache per build**, `gp-app-{hash}`, filled whole when the worker installs; if one file fails, the
  install fails and the old worker and its cache stay. So the kept index.html always has its own assets.
- **Pages come from the network first**, so a host with a newer build is used at once, and the worker's
  index.html only when the network fails or does not answer in 3 s (a host that is off may stay silent rather
  than refuse). Every page address is a page: `/`, `/presentations/{id}`, `/admin/songs`, `/output`,
  `/watch/{code}`.
- **The build's files come from the cache first**: their names carry their contents' hash, so a kept copy is
  never stale. A file the cache does not have goes to the network.
- **Nothing under `/api/` ever goes through a cache** (sync, sign-in, live sockets, media, public outputs); nor
  does anything but GET or another origin.
- **Updating.** Every start registers the worker again, which makes the browser ask the host for `/sw.js`. A new
  build has a new hash in it, so a new worker installs, fills its own cache, takes over at once
  (`skipWaiting`, `clients.claim`) and deletes the old cache. An old page that is still open needs no more
  files from it: the app loads everything at start. A device that started from its kept copy while the host was
  gone, and finds the host back with a newer build (the sync's "update first", 426), gets the new app with a
  reload, since a page comes from the network first.
- **Where it registers** (`apps/web/src/keep-app.ts`): only a built app (not `pnpm dev`), only in a secure context,
  and never in the desktop app's windows, whose page comes from their own server. Not for `/watch/{code}`, as
  a viewer's phone needs no copy of the app; a device that already has the worker gets `/watch/` through it,
  network first. Over plain http on the LAN a browser allows no service worker, so such a tablet still needs the
  host to load the page.
- **On the server**, `index.html`, `/sw.js` and every page address are sent with `cache-control: no-cache`, so a
  new build is seen at once; the CSP's `worker-src 'self'` covers the worker.

Tested in `apps/web/test/sw-route.test.ts` (which requests go where), `apps/server/test/tls.test.ts` (headers)
and `apps/desktop/e2e/https.spec.ts`: a browser over https on the LAN pairs, the host goes, the page reloads and
shows its songs, another page opens by its address, and `/api/` fails rather than coming from a cache; the host
comes back with another build, which one reload brings, and which the worker keeps instead of the old one. The
host's own window has no worker. All in Chromium; not tested in Safari or on a real iPad.

## Behind a reverse proxy

A self-hosted Node server behind nginx or Caddy sees every client at the proxy's address, so the throttles
(setup token, pairing code, public output codes; see [Assumptions](assumptions.md)) would lock out a whole church at once.
`GP_TRUSTED_PROXIES` (for the desktop host and `serve`; `trustedProxies` for `startNodeServer`) names the
proxies, as addresses or CIDR blocks, comma-separated:

```sh
GP_TRUSTED_PROXIES=127.0.0.1,::1 pnpm --filter @gp/desktop serve   # Caddy or nginx on the same machine
GP_TRUSTED_PROXIES=10.0.0.0/8 …                                      # a proxy somewhere on that network
```

Only a request whose socket is one of them has its `X-Forwarded-For` read, from the right: each trusted proxy
is skipped, and the first address that is not one is the client. A client may write anything at the left of the
header, but never past a trusted proxy, which appends the address it saw. So list the proxies only: a block
that also holds the clients would let a client name itself anything. An entry that is not an address or a
block stops the server at start. Without the setting the header is ignored, as before. The address the proxy
names is also what the host's own sign-in (Google, passkeys) is held to: from this machine only
(`isLoopback`). The Worker is not affected: there the address is `CF-Connecting-IP`, which Cloudflare sets.

Code in `apps/server/src/proxy.ts`, tested in `apps/server/test/proxy.test.ts`: the walk, and the setup
throttle locking out one client behind a proxy and not the next, and, without the setting, both.

## Addresses

The app's pages are plain paths through the History API (`apps/web/src/ui/router.ts`): `/` (the
presentations, the start page), `/presentations/{id}`, `/live/{id}`, `/trash?kind=Image`, `/logins`,
`/settings`, `/signin`, `/signed-in`, `/output`, and the admin pages under `/admin/` (as in the current app):
`songs`, `songs/{id}`, `users`, `devices`, `bibles`, `images`, `audios`, `overlays`, `themes`, `displays`;
`/admin` alone is the songs. `/songs`, `/songs/{id}` and `/presentations` from before still open their pages.
Everything the server answers itself is under `/api/`, so no page can collide with it, and an unknown `/api/…`
path is a JSON 404, never the app. An unknown page address is the start page. The one fragment left is an invite's token, `/invite#{token}`, because a
fragment never reaches a server and so never a log. The Node server (and so the desktop host) answers any
GET with no file extension outside `/api/` with `index.html`; a missing file (`/assets/x.js`) is a 404. The
Worker does the same from Workers static assets (see [On Cloudflare](cloudflare.md)), except that an unknown `/api/…` path is a
plain-text 404 there, not JSON.
Links are ordinary `<a href>`: one click handler (`installLinkHandler`) turns same-origin clicks into
History navigation. For `pnpm dev` the Vite proxy forwards `/api` (and its WebSocket) to the server.

**Moving the API under `/api/` changed the Google redirect URI** to `{origin}/api/auth/google/callback`:
a real Google client registered with the old one must get the new one.
