import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageEdit } from '@gp/core';
import { t } from '../../i18n.ts';

// The crop's frame over the picture, as Photos draws it: the picture outside it dimmed, white corners to drag, the
// frame itself dragged to move it, and a thin grid of thirds while it moves. With a format (`aspect`) a corner keeps
// it. A finger held still on the picture shows the original until it lets go (`onHold`), as Photos does. The crop is in
// fractions of the picture shown (`width` × `height` px on the screen).

type Crop = ImageEdit['crop'];
type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** How long a still finger waits before it shows the original, and how far it may move meanwhile. */
const HOLD_MS = 350;
const HOLD_SLOP = 4;

/** The smallest crop, a fraction of either side. */
const MIN = 0.08;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `crop` with `corner` dragged by (dx, dy), fractions; with `aspect` (output width / height) the height follows the width. */
export function dragCorner(crop: Crop, corner: Corner, dx: number, dy: number, aspect: number | null, frameAspect: number): Crop {
  const left = corner === 'nw' || corner === 'sw';
  const top = corner === 'nw' || corner === 'ne';
  let x0 = crop.x;
  let y0 = crop.y;
  let x1 = crop.x + crop.w;
  let y1 = crop.y + crop.h;
  if (left) x0 = clamp(x0 + dx, 0, x1 - MIN);
  else x1 = clamp(x1 + dx, x0 + MIN, 1);
  if (aspect) {
    // The height that keeps the format, from the width, kept inside the picture.
    let h = ((x1 - x0) * frameAspect) / aspect;
    const room = top ? y1 : 1 - y0;
    if (h > room) {
      h = room;
      const w = (h * aspect) / frameAspect;
      if (left) x0 = x1 - w;
      else x1 = x0 + w;
    }
    if (top) y0 = y1 - h;
    else y1 = y0 + h;
  } else if (top) y0 = clamp(y0 + dy, 0, y1 - MIN);
  else y1 = clamp(y1 + dy, y0 + MIN, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** `crop` moved by (dx, dy), fractions, kept inside the picture. */
export function moveCrop(crop: Crop, dx: number, dy: number): Crop {
  return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.w), y: clamp(crop.y + dy, 0, 1 - crop.h) };
}

export function CropFrame({
  width,
  height,
  crop,
  aspect,
  hidden,
  onChange,
  onHold,
}: {
  width: number;
  height: number;
  crop: Crop;
  aspect: number | null;
  /** While the original shows: kept, so the finger holding it still lets go here. */
  hidden: boolean;
  onChange: (crop: Crop) => void;
  onHold: (holding: boolean) => void;
}) {
  const drag = useRef<{ x: number; y: number; crop: Crop; corner: Corner | null; held: boolean; moved: boolean } | null>(null);
  const timer = useRef(0);
  const start = (corner: Corner | null) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = { x: e.clientX, y: e.clientY, crop, corner, held: false, moved: false };
    drag.current = d;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (drag.current !== d || d.moved) return;
      d.held = true;
      onHold(true);
    }, HOLD_MS);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.held) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < HOLD_SLOP) return;
    d.moved = true;
    const dx = (e.clientX - d.x) / width;
    const dy = (e.clientY - d.y) / height;
    onChange(d.corner ? dragCorner(d.crop, d.corner, dx, dy, aspect, width / height) : moveCrop(d.crop, dx, dy));
  };
  const end = () => {
    clearTimeout(timer.current);
    if (drag.current?.held) onHold(false);
    drag.current = null;
  };
  const box = { left: crop.x * width, top: crop.y * height, width: crop.w * width, height: crop.h * height };
  const corner = (c: Corner) => {
    const at = { nw: 'left-0 top-0 border-l-[3px] border-t-[3px]', ne: 'right-0 top-0 border-r-[3px] border-t-[3px]', sw: 'left-0 bottom-0 border-l-[3px] border-b-[3px]', se: 'right-0 bottom-0 border-r-[3px] border-b-[3px]' }[c];
    return (
      <span
        key={c}
        data-corner={c}
        aria-hidden="true"
        className={`absolute size-6 -m-[3px] border-white touch-none cursor-${c === 'nw' || c === 'se' ? 'nwse' : 'nesw'}-resize ${at}`}
        onPointerDown={start(c)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    );
  };
  return (
    <div className={`absolute inset-0 ${hidden ? 'opacity-0' : ''}`} data-testid="crop-frame">
      <div
        role="img"
        aria-label={t('imageEditor.cropFrame')}
        className="absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] cursor-move touch-none"
        style={box}
        onPointerDown={start(null)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* Thirds, as a camera's grid. */}
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
        <span className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
        <span className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
        {(['nw', 'ne', 'sw', 'se'] as const).map(corner)}
      </div>
    </div>
  );
}
