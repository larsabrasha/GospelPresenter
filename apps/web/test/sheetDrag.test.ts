import { describe, expect, it } from 'vitest';
import { closesOnRelease, rubberBand } from '../src/ui/sheetDrag.ts';

describe('closesOnRelease', () => {
  it('closes a sheet thrown down, however little it moved', () => {
    const release = { dy: 20, speed: 1.2, height: 400 };

    const closes = closesOnRelease(release);

    expect(closes).toBe(true);
  });

  it('closes a sheet pulled past half its height and let go still', () => {
    const release = { dy: 220, speed: 0, height: 400 };

    const closes = closesOnRelease(release);

    expect(closes).toBe(true);
  });

  it('springs back from a short, slow pull', () => {
    const release = { dy: 60, speed: 0.2, height: 400 };

    const closes = closesOnRelease(release);

    expect(closes).toBe(false);
  });

  it('springs back when the finger was already moving up at letting go', () => {
    const release = { dy: 300, speed: -0.5, height: 400 };

    const closes = closesOnRelease(release);

    expect(closes).toBe(false);
  });
});

describe('rubberBand', () => {
  it('gives less the further it is pulled, and never past its limit', () => {
    const limit = 40;

    const near = rubberBand(20, limit);
    const far = rubberBand(2000, limit);

    expect(near).toBeLessThan(20);
    expect(far).toBeLessThan(limit);
    expect(far).toBeGreaterThan(near);
  });
});
