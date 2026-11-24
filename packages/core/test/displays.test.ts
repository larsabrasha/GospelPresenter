import { describe, expect, it } from 'vitest';
import { DISPLAY_CODE, DISPLAY_CODE_ALPHABET, displayCode, randomId } from '@gp/core';

// LIVE-R30: public output codes.
describe('display codes', () => {
  it('are 7 characters from the unambiguous alphabet', () => {
    let seed = 1;
    const random = (n: number) => Uint8Array.from({ length: n }, () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) & 0xff);
    for (let i = 0; i < 200; i++) expect(displayCode(random)).toMatch(DISPLAY_CODE);
    expect(DISPLAY_CODE_ALPHABET).not.toMatch(/[ilo01]/);
  });

  it('skip bytes that would bias the choice, and keep drawing until the code is whole', () => {
    // 248 and above would make the first few letters likelier: they are skipped.
    const rolls = [Uint8Array.from([255, 254, 249, 248, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])];
    expect(displayCode((n) => rolls.shift() ?? new Uint8Array(n))).toBe('abcdefg');
    const thin = [Uint8Array.from(Array(16).fill(250)), Uint8Array.from(Array(16).fill(30))];
    expect(displayCode((n) => thin.shift() ?? new Uint8Array(n))).toBe('9999999');
  });
});

describe('random ids', () => {
  it('fall back to getRandomValues where randomUUID is missing (plain http on the LAN)', () => {
    const insecure = { getRandomValues: <T extends Uint8Array>(a: T) => a.fill(0xab) };
    const id = randomId(insecure);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomId({ ...insecure, randomUUID: () => 'from-randomUUID' })).toBe('from-randomUUID');
  });
});
