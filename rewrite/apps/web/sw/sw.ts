// The service worker (README, "Starting the app without the host"): keeps
// this build of the web app, so a device that reached the host over https
// can reload and start with the host gone. Its data is already in OPFS.
//
// One cache per build, filled whole at install from the list the build wrote
// in (vite.config.ts), so the kept index.html always has its own assets.
// Pages come from the network first, so a host with a newer build is used
// at once; the kept copy only when the network fails.
import { handling } from './route.ts';

/** Written in by the build: a hash of every file, and the files' paths. */
declare const GP_BUILD: { version: string; files: string[] };

const sw = self as unknown as ServiceWorkerGlobalScope;
const PREFIX = 'gp-app-';
const { version, files } = GP_BUILD;
const CACHE = PREFIX + version;
const INDEX = '/index.html';
/** How long a page waits for the host before it starts from the kept copy: a host that is off may not refuse, only stay silent. */
const PAGE_WAIT_MS = 3_000;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload`: from the host, never a copy the HTTP cache may hold of another build. Any failure fails the install.
      await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const how = handling(event.request, sw.location.origin);
  if (how === 'page') event.respondWith(page(event.request));
  else if (how === 'file') event.respondWith(file(event.request));
});

async function page(request: Request): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PAGE_WAIT_MS);
  try {
    return await fetch(request, { signal: abort.signal });
  } catch {
    return (await caches.match(INDEX, { cacheName: CACHE })) ?? Response.error();
  } finally {
    clearTimeout(timer);
  }
}

async function file(request: Request): Promise<Response> {
  // An asset's name carries its content's hash, so a kept copy is never stale.
  return (await caches.match(request, { cacheName: CACHE })) ?? fetch(request);
}
