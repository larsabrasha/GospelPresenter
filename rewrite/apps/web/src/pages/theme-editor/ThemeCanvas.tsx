import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import Moveable, { type OnDragEnd, type OnResizeEnd } from 'react-moveable';
import { slideStyle, type TextStyle, type Theme } from '@gp/core';
import { SlideView } from '../../ui/SlideView.tsx';
import { clampArea, SAMPLES, type EditedKind, type TextRole } from './themeModel.ts';

// The slide a theme is edited on (docs/themes.md), as the slideshows' editor's page: drawn as every output draws it,
// a sample of the kind, with Moveable's handles on the picked text's box. A tap on the main text or the credits picks
// it, a tap beside them picks none (the background); the picked box is dragged and sized, lined up with the stage's
// edges and middle.

const SELECTOR: Record<TextRole, string> = { main: '.slide-content', credits: '.slide-credits-box' };

export function ThemeCanvas({
  theme,
  kind,
  picked,
  onPick,
  onArea,
}: {
  theme: Theme;
  kind: EditedKind;
  picked: TextRole | null;
  onPick: (role: TextRole | null) => void;
  onArea: (role: TextRole, area: TextStyle['area']) => void;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const moveable = useRef<Moveable>(null);
  useLayoutEffect(() => moveable.current?.updateRect());
  const stage = box?.querySelector<HTMLElement>('[data-testid="slide-stage"]') ?? null;
  const style = kind === 'media' || !picked ? null : slideStyle(theme, kind)[picked];

  const press = (e: PointerEvent) => {
    const at = e.target as Element;
    if (at.closest('.moveable-control-box')) return;
    onPick(kind === 'media' ? null : at.closest(SELECTOR.main) ? 'main' : at.closest(SELECTOR.credits) ? 'credits' : null);
  };
  const dragEnd = ({ lastEvent, target }: OnDragEnd) => {
    if (!lastEvent || !style || !picked) return;
    target.style.transform = '';
    const [tx, ty] = lastEvent.beforeTranslate;
    onArea(picked, clampArea({ ...style.area, x: style.area.x + tx, y: style.area.y + ty }));
  };
  const resizeEnd = ({ lastEvent, target }: OnResizeEnd) => {
    if (!lastEvent || !style || !picked) return;
    target.style.transform = '';
    const [tx, ty] = lastEvent.drag.beforeTranslate;
    onArea(picked, clampArea({ x: style.area.x + tx, y: style.area.y + ty, w: lastEvent.width, h: lastEvent.height }));
  };

  return (
    <div ref={setBox} className="theme-canvas relative w-full aspect-video select-none touch-none" onPointerDown={press} data-testid="theme-canvas" data-picked={picked ?? undefined}>
      <div className="absolute inset-0 overflow-hidden rounded-xl ring-1 ring-separator shadow-[0_2px_12px_rgba(0,0,0,0.12)]">
        <SlideView slide={SAMPLES[kind]} theme={theme} label={false} />
      </div>
      {box && stage && style && picked && (
        <Moveable
          // A new box each time another is picked, so its handles start where it is.
          key={`${kind}:${picked}`}
          ref={moveable}
          target={() => box.querySelector<HTMLElement>(SELECTOR[picked])!}
          draggable
          resizable
          throttleDrag={0}
          snappable
          snapContainer={stage}
          elementGuidelines={[stage]}
          snapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
          elementSnapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
          snapThreshold={6}
          onDrag={({ target, transform }) => {
            target.style.transform = transform;
          }}
          onDragEnd={dragEnd}
          onResize={({ target, width, height, drag }) => {
            target.style.width = `${width}px`;
            target.style.height = `${height}px`;
            target.style.transform = drag.transform;
          }}
          onResizeEnd={resizeEnd}
        />
      )}
    </div>
  );
}
