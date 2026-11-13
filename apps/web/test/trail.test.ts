import { beforeEach, describe, expect, it } from 'vitest';
import { BUG_REPORT_LIMITS } from '@gp/core';
import { clearTrail, note, trail } from '../src/report/trail.ts';

describe('the steps a bug report carries', () => {
  beforeEach(() => clearTrail());

  it('keeps them oldest first', () => {
    note('page', '/presentations', 1);
    note('press', 'Starta presentation', 2);

    expect(trail().map((s) => s.what)).toEqual(['/presentations', 'Starta presentation']);
  });

  it('counts the same step in a row once, at its last time', () => {
    note('change', 'updateSong', 1);
    note('change', 'updateSong', 2);
    note('change', 'updateSong', 3);

    expect(trail()).toEqual([{ at: 3, kind: 'change', what: 'updateSong', times: 3 }]);
  });

  it('counts a step again once another came between', () => {
    note('press', 'Nästa', 1);
    note('live', 'P1/I1 #2', 2);
    note('press', 'Nästa', 3);

    expect(trail().map((s) => s.times)).toEqual([1, 1, 1]);
  });

  it('lets the oldest go once the ring is full', () => {
    for (let i = 0; i <= BUG_REPORT_LIMITS.trail; i++) note('page', `/p${i}`, i);

    expect([trail().length, trail()[0]!.what]).toEqual([BUG_REPORT_LIMITS.trail, '/p1']);
  });

  it('cuts a long text', () => {
    note('error', 'x'.repeat(500), 1);

    expect(trail()[0]!.what).toHaveLength(80);
  });
});
