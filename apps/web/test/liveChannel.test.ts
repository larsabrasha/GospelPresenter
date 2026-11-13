import { afterEach, describe, expect, it } from 'vitest';
// An output window says bye on `pagehide`; Node has no window.
globalThis.addEventListener ??= () => undefined;

import { LiveChannel } from '../src/live/live.ts';

// The live pointer between the windows of one machine (live.ts), over a real BroadcastChannel.

const opened: LiveChannel[] = [];
const open = (org: string, role: 'operator' | 'output') => {
  const c = new LiveChannel(org, role);
  opened.push(c);
  return c;
};
/** Lets the channel's messages arrive. */
const settle = () => new Promise((r) => setTimeout(r, 30)); // a BroadcastChannel delivers in a later task
afterEach(() => {
  for (const c of opened.splice(0)) c.close();
});

describe('two presenting windows on one machine', () => {
  it('a window opened later takes the pointer the outputs show, so what it sets reaches them', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const output = open(org, 'output');
    const first = open(org, 'operator');
    for (const partIndex of [0, 1, 2]) first.set({ presentationId: 'P', itemId: 'I1', partIndex, black: false });
    await settle();

    const later = open(org, 'operator');
    await settle();
    later.set({ presentationId: 'P', itemId: 'I1', partIndex: 5, black: false });
    await settle();

    expect([later.pointer.rev, output.pointer.partIndex]).toEqual([4, 5]);
  });

  it('only the window that set the pointer last presents: the other plays no sound or video', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const first = open(org, 'operator');
    const second = open(org, 'operator');
    first.set({ presentationId: 'P', itemId: 'I1', partIndex: 0, black: false });
    await settle();
    const before = [first.presents(), second.presents()];

    second.set({ presentationId: 'P', itemId: 'I1', partIndex: 1, black: false });
    await settle();

    expect([before, [first.presents(), second.presents()]]).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
