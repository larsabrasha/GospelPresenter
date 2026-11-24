import { describe, expect, it } from 'vitest';
import { displaysToTurnOn } from '../src/live/autoOutputs.ts';

const projector = { id: '1', name: 'EPSON PJ' };
const tv = { id: '3', name: 'LG TV' };

describe('displaysToTurnOn', () => {
  it('turns on every display never switched by hand', () => {
    const ids = displaysToTurnOn([projector, tv], {});

    expect(ids).toEqual(['1', '3']);
  });

  it('leaves off a display last switched off by hand', () => {
    const ids = displaysToTurnOn([projector, tv], { 'LG TV': false });

    expect(ids).toEqual(['1']);
  });

  it('turns on a display last left on, by its name whatever its id is now', () => {
    const ids = displaysToTurnOn([{ id: '7', name: 'EPSON PJ' }], { 'EPSON PJ': true });

    expect(ids).toEqual(['7']);
  });

  it('turns on nothing with no display', () => {
    const ids = displaysToTurnOn([], { 'EPSON PJ': true });

    expect(ids).toEqual([]);
  });
});
