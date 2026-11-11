// A newer build on the server, taken quietly (Lars, 2026-11-08: no line and no button, as Gmail does it). Now and
// then the page asks the server which build its index.html is; when that is not the page's own, the next move to
// another page is followed by a reload, and so the newer build. Never while something is live from this machine or
// this window drives another's, which a reload would cut. docs/lan-https-and-addresses.md, "Updating".

/** How often a page that is shown asks; also when it is shown again, and when the network comes back. */
const CHECK_MS = 10 * 60_000;
/** The first ask, after the start has had the network to itself. */
const FIRST_CHECK_MS = 5_000;
/**
 * How long after a move the reload waits: React has drawn the new page by then, so the page left has closed and
 * handed its last saves to the database (an editor flushes as it closes), which `settled` then waits for.
 */
const AFTER_MOVE_MS = 300;
const META = /<meta name="gp-build" content="([^"]+)"/;

/** The build this page runs, from the mark the build writes into index.html (vite.config.ts); read at install. */
let own: string | null = null;
let differs = false;
let swapping = false;
let holds = 0;
let busy: () => boolean = () => true;
let settled: () => Promise<boolean> = async () => false;

/** The build the server's index.html is now; null when the server cannot be asked or marks none. */
async function serverBuild(): Promise<string | null> {
  try {
    // `/`, not `/index.html`: the service worker keeps the latter and would answer with its own copy.
    const res = await fetch('/', { cache: 'no-store' });
    return res.ok ? (META.exec(await res.text())?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

/** Asks the server which build it has; a server back on this page's own build (a deploy rolled back) is no newer one. */
async function checkBuild(): Promise<void> {
  const server = await serverBuild();
  if (server === null) return;
  differs = server !== own;
  // Shown on the page for a bug report's picture and the e2e tests; nothing on screen says it.
  document.documentElement.toggleAttribute('data-newer-build', differs);
}

/**
 * Starts asking, for a window that moves between pages. `isBusy`: a reload would cut something (live from this
 * machine). `isSettled`: what the page wrote is safe across a reload, false if it is not within some seconds. Once
 * per window.
 */
export function installNewBuild(isBusy: () => boolean, isSettled: () => Promise<boolean>): void {
  own = document.querySelector('meta[name="gp-build"]')?.getAttribute('content') ?? null;
  if (!own) return; // the dev server's page has no mark
  busy = isBusy;
  settled = isSettled;
  setTimeout(() => void checkBuild(), FIRST_CHECK_MS);
  setInterval(() => document.visibilityState === 'visible' && void checkBuild(), CHECK_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkBuild());
  addEventListener('online', () => void checkBuild());
  // Back and forward are moves to another page too.
  addEventListener('popstate', movedPage);
}

/** Holds the newer build back while it is held (a window driving another's session, a long job); the result lets go. */
export function holdNewBuild(): () => void {
  holds++;
  return () => void holds--;
}

/** Runs a long job (an upload, an import, an export) with the newer build held back, so a move meanwhile cuts nothing. */
export async function whileHolding<T>(job: () => Promise<T>): Promise<T> {
  const release = holdNewBuild();
  try {
    return await job();
  } finally {
    release();
  }
}

/** The page moved to another in place: with a newer build waiting, and nothing a reload would cut, the reload follows. */
export function movedPage(): void {
  if (!differs || swapping) return;
  swapping = true;
  setTimeout(() => {
    void (async () => {
      const go = holds === 0 && !busy() && (await settled()) && holds === 0 && !busy();
      if (go) location.reload();
      else swapping = false;
    })();
  }, AFTER_MOVE_MS);
}
