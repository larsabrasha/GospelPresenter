/**
 * Headers for the static app, the same from the Node server and the Worker: a
 * strict CSP (ADR 0007, decision 6). wa-sqlite compiles WebAssembly, React
 * sets inline style attributes, and pictures and sounds play from this
 * device's own copies as blob: URLs. `worker-src 'self'` covers the database
 * worker and the service worker (`/sw.js`).
 */
export const STATIC_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; " +
    "connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** The headers for one static path. index.html and sw.js keep their names from build to build: always asked again, so a new build is seen at once. */
export function staticHeaders(path: string): Record<string, string> {
  return path.startsWith('/assets/') ? { ...STATIC_HEADERS } : { ...STATIC_HEADERS, 'cache-control': 'no-cache' };
}

/** An address with no file behind it (no extension) is a page of the app: the client's router draws it from index.html. */
export function isAppPage(path: string): boolean {
  return !/\.[a-z0-9]+$/i.test(path);
}
