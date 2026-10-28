import { liveReconnectDelay, type WatchEvent } from '@gp/core';

// A public output's stream (spec 04 §6, LIVE-R35). EventSource reconnects by
// itself after a network error, but gives up for good after any answer that
// is not 200 (a 502 while a server restarts), so this reconnects itself then,
// with the backoff of LIVE-R51, until the code turns out not to exist.

/** The part of EventSource this uses, so a test can stand in for it. */
export interface StreamSource {
  readonly readyState: number;
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void;
  close(): void;
}

export interface StreamDeps {
  open(url: string): StreamSource;
  /** The status of the output's `/exists`, or null when the server cannot be reached. */
  exists(): Promise<number | null>;
  later(fn: () => void, ms: number): unknown;
}

const CLOSED = 2;

export function followStream(
  url: string,
  on: { event: (e: WatchEvent) => void; notFound: () => void },
  deps: StreamDeps,
): () => void {
  let source: StreamSource | null = null;
  let stopped = false;
  let attempt = 0;

  const stop = () => {
    stopped = true;
    source?.close();
    source = null;
  };

  const connect = () => {
    if (stopped) return;
    const s = deps.open(url);
    source = s;
    for (const type of ['meta', 'slide', 'canvas', 'idle', 'full', 'unpaired']) {
      s.addEventListener(type, (e) => {
        const m = JSON.parse(e.data) as WatchEvent;
        on.event(m);
        if (m.type === 'full' || m.type === 'unpaired') stop(); // too many watching, or let go: do not hammer the server
      });
    }
    s.addEventListener('open', () => (attempt = 0));
    s.addEventListener('error', () => {
      if (stopped || source !== s) return;
      const gaveUp = s.readyState === CLOSED;
      // A code that does not exist, or no longer does (a new code, a deleted output), would retry forever.
      void deps.exists().then((status) => {
        if (stopped || source !== s) return;
        if (status === 404) {
          stop();
          on.notFound();
        } else if (gaveUp) {
          s.close();
          source = null;
          deps.later(connect, liveReconnectDelay(attempt++));
        }
      });
    });
  };

  connect();
  return stop;
}
