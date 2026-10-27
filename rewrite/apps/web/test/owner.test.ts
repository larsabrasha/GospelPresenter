import { describe, expect, it } from 'vitest';
import type { LiveSessionInfo } from '@gp/core';
// The page announces a change of outputs on the window; Node has no window.
globalThis.dispatchEvent ??= () => true;

import { chosenOutputs, pendingTakeOver, refusedOutputs, setOutput, settleTakeOver } from '../src/live/owner.ts';

const session = (id: string, outputs: string[]): LiveSessionInfo => ({
  id,
  presentationId: 'P',
  presentationName: id,
  deviceName: '',
  remote: false,
  ownerOnline: true,
  pointer: { itemId: null, partIndex: 0, black: false, overlayId: null, rev: 0 },
  outputs: outputs.map((o) => ({ id: o, viewers: 0 })),
  audio: null,
});

// "Ta över" (LIVE-R23) must survive a report that never reached the server.
describe('taking an output over', () => {
  it('keeps asking until the server shows the output as ours, then forgets the takeover', () => {
    setOutput('D1', true, true);
    expect(pendingTakeOver()).toEqual(['D1']);
    // A report was lost; the server still shows D1 on the other session.
    settleTakeOver([session('MINE', []), session('OTHER', ['D1'])], 'MINE');
    expect(pendingTakeOver()).toEqual(['D1']);
    // A refusal meanwhile does not uncheck an output we asked to take over.
    expect(refusedOutputs([session('MINE', []), session('OTHER', ['D1'])], 'MINE')).toEqual([]);
    settleTakeOver([session('MINE', ['D1']), session('OTHER', [])], 'MINE');
    expect(pendingTakeOver()).toEqual([]);
    expect(chosenOutputs()).toEqual(['D1']);
  });

  it('an output chosen without a takeover, sent elsewhere, is refused; unchecking forgets a takeover', () => {
    setOutput('D2', true);
    expect(refusedOutputs([session('MINE', []), session('OTHER', ['D2'])], 'MINE')).toEqual(['D2']);
    setOutput('D3', true, true);
    setOutput('D3', false);
    expect(pendingTakeOver()).toEqual([]);
  });
});
