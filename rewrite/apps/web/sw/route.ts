// What the service worker does with a request (docs/lan-https-and-addresses.md, "Starting the app
// without the host"). Pure, so it is tested without a worker.

/** `pass`: the network only, as if there were no worker. `page`: network first, the kept index.html if that fails. `file`: the kept copy first. */
export type Handling = 'pass' | 'page' | 'file';

export function handling(request: { method: string; mode: string; url: string }, origin: string): Handling {
  if (request.method !== 'GET') return 'pass';
  const url = new URL(request.url);
  if (url.origin !== origin) return 'pass';
  // Sync, sign-in, live sockets, media and public outputs: never from a cache.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'pass';
  if (request.mode === 'navigate') return /\.[a-z0-9]+$/i.test(url.pathname) && url.pathname !== '/index.html' ? 'file' : 'page';
  return 'file';
}
