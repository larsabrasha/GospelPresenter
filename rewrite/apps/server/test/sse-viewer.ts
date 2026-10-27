// An anonymous output's stream (spec 04 §5, §6), for the server tests.
import { expect } from 'vitest';
import type { WatchEvent } from '@gp/core';
import type { Harness } from './harness.ts';

/** An anonymous viewer's stream, keeping every event it got. */
export class Viewer {
  events: WatchEvent[] = [];
  ended = false;
  private constructor(
    readonly status: number,
    private abort: AbortController,
  ) {}

  /** A public output's viewer; `kind` 'display' or 'screen' follows a screen instead (spec 04 §5). */
  static async open(h: Harness, code: string, viewerId = randomViewer(), kind: 'watch' | 'display' | 'screen' = 'watch'): Promise<Viewer> {
    const abort = new AbortController();
    const res = await fetch(`${h.url}/api/${kind}/${code}/stream?v=${viewerId}`, { signal: abort.signal });
    const v = new Viewer(res.status, abort);
    if (res.status !== 200) return v;
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    void (async () => {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let at: number;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const data = block.split('\n').find((l) => l.startsWith('data:'));
            if (data) v.events.push(JSON.parse(data.slice(5).trim()) as WatchEvent);
          }
        }
      } catch {
        // aborted
      }
      v.ended = true;
    })();
    return v;
  }

  async next(match: (e: WatchEvent) => boolean, from = 0): Promise<WatchEvent> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const found = this.events.slice(from).find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no matching event; got ${JSON.stringify(this.events)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  last(): WatchEvent | undefined {
    return this.events.filter((e) => e.type !== 'meta').at(-1);
  }

  async waitEnded() {
    const deadline = Date.now() + 5000;
    while (!this.ended) {
      if (Date.now() > deadline) throw new Error('the stream did not end');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  close() {
    this.abort.abort();
  }
}

export const randomViewer = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

