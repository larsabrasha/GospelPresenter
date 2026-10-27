import { describe, expect, it } from 'vitest';
import { LIVE_MESSAGE_MAX, liveClientMessageSchema, PUBLIC_SLIDE_LIMITS, toPublicSlide, type LiveOwnState } from '@gp/core';

describe('live reports', () => {
  it('the largest valid report fits the server limit, even when every character needs escaping', () => {
    const worst = '\u0001'; // JSON writes it as \u0001: six characters for one
    const id = 'x'.repeat(100);
    const state: LiveOwnState = {
      sessionId: id,
      presentationId: id,
      presentationName: worst.repeat(200),
      deviceName: worst.repeat(100),
      remote: true,
      pointer: { itemId: id, partIndex: 10_000, black: false, rev: Number.MAX_SAFE_INTEGER },
      outputs: Array.from({ length: 50 }, () => id),
      takeOver: Array.from({ length: 50 }, () => id),
      slide: {
        kind: 'bible',
        text: worst.repeat(PUBLIC_SLIDE_LIMITS.text),
        verses: Array.from({ length: PUBLIC_SLIDE_LIMITS.segments }, () => ({ n: 999, t: worst.repeat(PUBLIC_SLIDE_LIMITS.text / PUBLIC_SLIDE_LIMITS.segments) })),
        image: 'a'.repeat(64),
        credits: worst.repeat(PUBLIC_SLIDE_LIMITS.credits),
        themeId: id,
      },
    };
    const message = { type: 'own', state };
    expect(liveClientMessageSchema.safeParse(message).success).toBe(true);
    expect(JSON.stringify(message).length).toBeLessThanOrEqual(LIVE_MESSAGE_MAX);
  });

  it('cuts a slide to what a report may carry, so a long song part or long verses never block a report', () => {
    const long = toPublicSlide({ kind: 'song', text: 'a'.repeat(9000), verses: null, image: null, credits: 'c'.repeat(900) }, 'classic');
    expect(long.text).toHaveLength(PUBLIC_SLIDE_LIMITS.text);
    expect(long.credits).toHaveLength(PUBLIC_SLIDE_LIMITS.credits);
    const verses = toPublicSlide(
      { kind: 'bible', text: '', verses: [{ n: 1, t: 'v'.repeat(4000) }, { n: 2, t: 'w'.repeat(4000) }, { n: 3, t: 'x' }], image: null, credits: null },
      'classic',
    );
    expect(verses.verses!.map((v) => [v.n, v.t.length])).toEqual([
      [1, 4000],
      [2, 1000],
    ]);
    const message = { type: 'own', state: { sessionId: 'S', presentationId: 'P', presentationName: '', deviceName: '', remote: false, pointer: { itemId: null, partIndex: 0, black: false, rev: 0 }, slide: verses } };
    expect(liveClientMessageSchema.safeParse(message).success).toBe(true);
  });
});
