import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Moveable, { type OnDragEnd, type OnResizeEnd } from 'react-moveable';
import { slideStyle, type TextStyle, type Theme } from '@gp/core';
import { t } from '../../i18n.ts';
import { arrowNudge, CANVAS_FOCUS, nextInTurn } from '../../ui/canvasKeys.ts';
import { SlideView } from '../../ui/SlideView.tsx';
import { clampArea, SAMPLES, type EditedKind, type TextRole } from './themeModel.ts';

// The slide a theme is edited on (docs/themes.md), as the slideshows' editor's page: drawn as every output draws it,
// a sample of the kind, with Moveable's handles on the picked text's box. A tap on the main text or the credits picks
// it, a tap beside them picks none (the background); the picked box is dragged and sized, lined up with the stage's
// edges and middle. By the keyboard as the slideshows' editor (ui/canvasKeys.ts): Tab picks the main text, then the
// credits; an arrow moves the picked box; Escape picks none.

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
  /** A box moved or sized; `run` for an arrow's, so that a run of them is one step for Ångra. */
  onArea: (role: TextRole, area: TextStyle['area'], run?: boolean) => void;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const moveable = useRef<Moveable>(null);
  useLayoutEffect(() => moveable.current?.updateRect());
  const stage = box?.querySelector<HTMLElement>('[data-testid="slide-stage"]') ?? null;
  const style = kind === 'media' || !picked ? null : slideStyle(theme, kind)[picked];

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      const roles = kind === 'media' ? [] : (['main', 'credits'] as const).filter((r) => box?.querySelector(SELECTOR[r]));
      const next = nextInTurn(roles, picked, e.shiftKey);
      if (!next) return onPick(null); // out of the slide, nothing picked behind it
      e.preventDefault();
      onPick(next);
      return;
    }
    if (!style || !picked) return;
    const by = arrowNudge(e);
    if (by) {
      e.preventDefault();
      onArea(picked, clampArea({ ...style.area, x: style.area.x + by[0], y: style.area.y + by[1] }), true);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onPick(null);
    }
  };
  const press = (e: PointerEvent) => {
    const at = e.target as Element;
    // The slide has the keys after a press on it (Moveable's drag keeps a press from focusing it).
    box?.focus({ preventScroll: true });
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
    <div
      ref={setBox}
      tabIndex={0}
      aria-label={t('slideEditor.canvas')}
      className={`theme-canvas relative w-full aspect-video select-none touch-none ${CANVAS_FOCUS}`}
      onKeyDown={onKey}
      onPointerDown={press} data-testid="theme-canvas" data-picked={picked ?? undefined}>
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
