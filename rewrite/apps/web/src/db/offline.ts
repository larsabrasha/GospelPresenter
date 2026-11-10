// Background work in the database worker (media, Bibles, videos) tries again at the next change or poll when the server
// cannot be reached; anything else is a fault to report (the review, 2026-11-09: every error was taken for "offline").

/** Whether `e` is the network: fetch could not reach the server (each browser words it its own way), or was cut off. */
export function isOffline(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === 'AbortError' || e.name === 'NetworkError';
  return e instanceof TypeError && /fetch|load failed|network/i.test(e.message);
}
