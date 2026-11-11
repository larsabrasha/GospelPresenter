import { describe, expect, it } from 'vitest';
import { inParallel } from '../src/media/inParallel.ts';

describe('work four at a time', () => {
  it('runs each item once, never more than four at once, and counts each one done', async () => {
    let running = 0;
    let most = 0;
    const seen: number[] = [];
    const counted: number[] = [];

    await inParallel(
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      async (n) => {
        most = Math.max(most, ++running);
        await new Promise((r) => setTimeout(r, 1)); // each item takes a moment, so they overlap
        seen.push(n);
        running--;
      },
      (n) => counted.push(n),
    );

    expect([seen.toSorted((a, b) => a - b), most, counted]).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9], 4, [1, 2, 3, 4, 5, 6, 7, 8, 9]]);
  });

  it('starts nothing more after a failure, and throws it', async () => {
    const started: number[] = [];

    const run = inParallel([1, 2, 3, 4, 5, 6, 7, 8], async (n) => {
      started.push(n);
      if (n === 1) throw new Error('refused');
      await new Promise((r) => setTimeout(r, 5)); // the others are still busy when the first fails
    });

    await expect(run).rejects.toThrow('refused');
    expect(started).toEqual([1, 2, 3, 4]);
  });
});
