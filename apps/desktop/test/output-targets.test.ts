import { describe, expect, it } from 'vitest';
import { goneTargets } from '../src/output-targets.ts';

describe('the outputs whose display went away', () => {
  it('are those on a display no longer there: a projector unplugged or gone to standby', () => {
    expect(goneTargets(['11', '22', 'window'], ['11'])).toEqual(['22']);
  });

  it('never include the output in a window of its own, which needs no display of its own', () => {
    expect(goneTargets(['window'], [])).toEqual([]);
  });
});
