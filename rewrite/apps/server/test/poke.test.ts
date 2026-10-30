// How the server's announcements of a change are coalesced (SYNC-R38, R39): the first at once, the
// rest of its window in one at the end. On fake timers; the adapters' own pokes are in sync.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PokeCoalescer } from '@gp/sync/server';

let sent: { exclude: string | null; seq: number }[];
let poke: PokeCoalescer;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  poke = new PokeCoalescer((exclude, seq) => sent.push({ exclude, seq }), 500);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pokes (SYNC-R38, R39)', () => {
  it('announces the first change at once, without waking its writer', () => {
    poke.changed('alice', 1);

    expect(sent).toEqual([{ exclude: 'alice', seq: 1 }]);
  });

  it('announces the rest of a burst once, at the end of the window, with its last change', () => {
    poke.changed('alice', 1);
    poke.changed('alice', 2);
    poke.changed('alice', 3);
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(500);

    expect(sent).toEqual([
      { exclude: 'alice', seq: 1 },
      { exclude: 'alice', seq: 3 },
    ]);
  });

  it('at the end of the window, wakes all but the one writer since the first poke, or everyone when two wrote', () => {
    poke.changed('alice', 1); // at once: bob hears of it
    poke.changed('bob', 2);
    vi.advanceTimersByTime(500);
    expect(sent.at(-1)).toEqual({ exclude: 'bob', seq: 2 }); // alice hears of bob's; bob had alice's already

    poke.changed('bob', 3);
    poke.changed('carol', 4);
    vi.advanceTimersByTime(500);

    expect(sent.at(-1)).toEqual({ exclude: null, seq: 4 });
  });

  it('sends nothing at the end of a window with no further change, and the next change goes at once', () => {
    poke.changed('alice', 1);
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(1);

    poke.changed('bob', 2);

    expect(sent).toEqual([
      { exclude: 'alice', seq: 1 },
      { exclude: 'bob', seq: 2 },
    ]);
  });

  it('sends at most two announcements in a window, however many changes come', () => {
    for (let i = 1; i <= 20; i++) {
      poke.changed('alice', i);
      vi.advanceTimersByTime(20);
    }
    // 400 ms of changes: the first at once, then nothing until the window ends.
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(100);

    expect(sent).toHaveLength(2);
  });
});
