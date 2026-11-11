import { describe, expect, it } from 'vitest';
import { cropOfAspect, editedSize, isNoEdit, NO_EDIT, readEdit, straightenScale } from '../src/media/imageEdit.ts';
import { dragCorner, moveCrop } from '../src/pages/image-editor/CropFrame.tsx';

describe("a picture's edit", () => {
  it('is no edit untouched, and one once turned', () => {
    expect(isNoEdit(NO_EDIT)).toBe(true);
    expect(isNoEdit({ ...NO_EDIT, rotate: 90 })).toBe(false);
  });

  it('turned a quarter, swaps the sides; cropped, keeps its part of them', () => {
    expect(editedSize(1600, 900, { ...NO_EDIT, rotate: 90 })).toEqual({ width: 900, height: 1600 });
    expect(editedSize(1600, 900, { ...NO_EDIT, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } })).toEqual({ width: 800, height: 900 });
  });

  it('straightened, grows just enough that no corner is empty, and not at all when level', () => {
    expect(straightenScale(1600, 900, 0)).toBe(1);
    const a = (10 * Math.PI) / 180;
    expect(straightenScale(1600, 900, 10)).toBeCloseTo((1600 * Math.sin(a) + 900 * Math.cos(a)) / 900);
    expect(straightenScale(1600, 900, -10)).toBe(straightenScale(1600, 900, 10));
  });

  it('cropped to 16:9 from a 4:3 picture, keeps the whole width in the middle', () => {
    const c = cropOfAspect(16 / 9, 1440, 1080);
    expect(c.x).toBe(0);
    expect(c.w).toBe(1);
    expect(c.h).toBeCloseTo(0.75);
    expect(c.y).toBeCloseTo(0.125);
  });

  it('reads a stored edit, and treats one that does not read as none', () => {
    expect(readEdit(JSON.stringify({ ...NO_EDIT, flip: true }))).toEqual({ ...NO_EDIT, flip: true });
    expect(readEdit('not json')).toEqual(NO_EDIT);
    expect(readEdit(null)).toEqual(NO_EDIT);
  });
});

describe("the crop's frame", () => {
  const whole = { x: 0, y: 0, w: 1, h: 1 };

  it('dragged by a corner, moves only that corner, and never past the picture', () => {
    expect(dragCorner(whole, 'se', -0.25, -0.5, null, 1)).toEqual({ x: 0, y: 0, w: 0.75, h: 0.5 });
    expect(dragCorner(whole, 'nw', -0.5, -0.5, null, 1)).toEqual(whole);
  });

  it('with a format, keeps it as the corner moves', () => {
    const c = dragCorner(whole, 'se', -0.5, 0, 1, 16 / 9);
    expect(((c.w * 16) / 9) / c.h).toBeCloseTo(1);
  });

  it('moved, stays inside the picture', () => {
    expect(moveCrop({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 0.3, -0.7)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });
});
