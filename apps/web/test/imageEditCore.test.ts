// The core's picture edit (`imageEditView`, crates/gp-core/src/image_edit.rs), which the native apps use, against the
// web's own (media/imageEdit.ts, image-editor/CropFrame.tsx), on random pictures and steps.
import type { ImageEdit } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { pageCore } from '../src/db/pageCore.ts';
import { cropOfAspect, editedSize, isNoEdit, turnedSize } from '../src/media/imageEdit.ts';
import { dragCorner, moveCrop } from '../src/pages/image-editor/CropFrame.tsx';

/** A small deterministic random source, so a failure repeats. */
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

interface Answer { edit: ImageEdit; frame: { width: number; height: number }; edited: { width: number; height: number }; none: boolean }
const core = (args: object) => pageCore().pure<Answer>('imageEditView', args);
const close = (a: ImageEdit['crop'], b: ImageEdit['crop']) => (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(a[k] - b[k]) < 1e-9);

describe('imageEditView against the web’s picture edit', () => {
  it('turns, sizes and crops as the web does', () => {
    const r = random(7);
    for (let i = 0; i < 500; i++) {
      const width = 50 + Math.floor(r() * 4000);
      const height = 50 + Math.floor(r() * 3000);
      const x = r() * 0.5;
      const y = r() * 0.5;
      const edit: ImageEdit = { straighten: 0, rotate: ([0, 90, 180, 270] as const)[i % 4]!, flip: r() > 0.5, crop: { x, y, w: 0.2 + r() * (0.8 - x), h: 0.2 + r() * (0.8 - y) } };
      const frame = turnedSize(width, height, edit.rotate);
      const aspect = [null, 16 / 9, 4 / 3, 1][i % 4]!;
      const format = ['free', '16:9', '4:3', 'square'][i % 4]!;
      const corner = (['nw', 'ne', 'sw', 'se'] as const)[Math.floor(r() * 4)]!;
      const [dx, dy] = [r() - 0.5, r() - 0.5];

      const now = core({ width, height, edit });
      const formatted = core({ width, height, edit, op: 'format', format });
      const cornered = core({ width, height, edit, op: 'corner', corner, dx, dy, format });
      const moved = core({ width, height, edit, op: 'move', dx, dy });

      expect([now.frame, now.edited, now.none]).toEqual([frame, editedSize(width, height, edit), isNoEdit(edit)]);
      expect(close(formatted.edit.crop, cropOfAspect(aspect, frame.width, frame.height))).toBe(true);
      expect(close(cornered.edit.crop, dragCorner(edit.crop, corner, dx, dy, aspect, frame.width / frame.height))).toBe(true);
      expect(close(moved.edit.crop, moveCrop(edit.crop, dx, dy))).toBe(true);
    }
  });
});
