import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type TouchEvent } from 'react';
import Moveable, { type OnDragEnd, type OnResizeEnd } from 'react-moveable';
import { CANVAS, type CustomElement, type CustomPage, type Theme } from '@gp/core';
import { t } from '../../i18n.ts';
import { mainCss, stageCss } from '../../themes.ts';
import { CustomPageView } from '../../ui/CustomPageView.tsx';
import { HoldMenu } from '../../ui/RemoveMenu.tsx';
import { nextBeneath } from './slideModel.ts';

// The page being edited (docs/custom-slides.md), as Keynote's: drawn as every output draws it, scaled to the column,
// with Moveable's handles on the picked element, outside the scaled stage so they keep their size on a phone. A tap
// picks an element, a tap beside them all picks none, a tap on the picked one picks the one beneath it (as Figma's
// and Freeform's, for an element covered by another); the picked one is dragged, even from under another, sized by
// its handles, lined up by yellow guides; a text tapped twice is written on the slide; a held finger or a right click
// opens the menu.

/** How long a tap on the picked element waits before picking the one beneath, so that a double tap still writes. */
const BENEATH_AFTER = 250;
/** A press that moves further or lasts longer is a drag or a held finger, not a tap. */
const TAP_SLOP = 4;
const TAP_LONGEST = 500;

interface Press {
  x: number;
  y: number;
  at: number;
  /** The elements under it, the top one first. */
  stack: string[];
  /** Whether the picked element was among them. */
  onPicked: boolean;
}

/** Where its box sits after a move or a size, in stage pixels: a line keeps the way it runs. */
function boxAfter(e: CustomElement, left: number, top: number, width: number, height: number): Pick<CustomElement, 'x' | 'y' | 'w' | 'h'> {
  if (e.kind !== 'line') return { x: Math.round(left), y: Math.round(top), w: Math.round(width), h: Math.round(height) };
  // A line is drawn in an svg its width larger on every side (CustomPageView).
  const [l, tp, w, h] = [left + e.strokeWidth, top + e.strokeWidth, Math.max(0, width - 2 * e.strokeWidth), Math.max(0, height - 2 * e.strokeWidth)];
  return { x: Math.round(e.w >= 0 ? l : l + w), y: Math.round(e.h >= 0 ? tp : tp + h), w: Math.round(e.w >= 0 ? w : -w), h: Math.round(e.h >= 0 ? h : -h) };
}

/** The drawn box's corner, before a move: a line's svg starts its width before the line. */
function drawnLeftTop(e: CustomElement): [number, number] {
  const pad = e.kind === 'line' ? e.strokeWidth : 0;
  return [Math.min(e.x, e.x + e.w) - pad, Math.min(e.y, e.y + e.h) - pad];
}

export function EditorCanvas({
  page,
  theme,
  picked,
  editingText,
  menu,
  onPick,
  onChange,
  onEditText,
}: {
  page: CustomPage;
  theme: Theme;
  picked: string | null;
  /** The picked text is being written on the slide itself (a double tap), as Keynote's. */
  editingText: boolean;
  /** The menu a held finger or a right click opens: the picked element's choices. */
  menu: ReactNode;
  onPick: (id: string | null) => void;
  onChange: (id: string, patch: Partial<CustomElement>) => void;
  onEditText: (on: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const moveable = useRef<Moveable>(null);
  const [scale, setScale] = useState(0);
  const element = picked ? page.elements.find((e) => e.id === picked) : undefined;
  const writing = editingText && element?.kind === 'text' ? element : null;

  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => setScale(el.clientWidth / CANVAS.width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The picked element's node, looked up by Moveable when it draws (a picture's node changes once it has loaded); the
  // handles moved to where it is after each draw.
  const nodeOf = (id: string) => stage?.querySelector<HTMLElement | SVGElement>(`[data-element="${CSS.escape(id)}"]`) ?? null;
  const target = picked && stage ? () => nodeOf(picked)! : null;
  // The other elements and the stage's edges and middle to line up with, as Keynote's yellow guides.
  const guides = () => [stage!, ...page.elements.filter((e) => e.id !== picked).flatMap((e) => nodeOf(e.id) ?? [])];
  useLayoutEffect(() => moveable.current?.updateRect());

  const pressed = useRef<Press | null>(null);
  const beneath = useRef(0);
  useEffect(() => () => clearTimeout(beneath.current), []);
  /** The elements under a point on the stage, the top one first. */
  const stackAt = (x: number, y: number) => {
    const ids = document.elementsFromPoint(x, y).flatMap((n) => (stage?.contains(n) ? (n.closest('[data-element]')?.getAttribute('data-element') ?? []) : []));
    return [...new Set(ids)];
  };

  const press = (e: PointerEvent) => {
    const at = e.target as Element;
    pressed.current = null;
    if (at.closest('.moveable-control-box') || at.closest('[data-writing]')) return;
    const stack = stackAt(e.clientX, e.clientY);
    const onPicked = picked !== null && stack.includes(picked);
    pressed.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, stack, onPicked };
    if (onPicked) return; // it stays picked, and is dragged (`dragCovered`)
    const hit = stack[0] ?? null;
    if (hit !== picked) onEditText(false);
    onPick(hit);
  };
  /** The picked one dragged from under another; Moveable (Gesto) reads mouse and touch events, not pointer events. */
  const dragCovered = (e: MouseEvent | TouchEvent) => {
    const p = pressed.current;
    if (p?.onPicked && picked && p.stack[0] !== picked) moveable.current?.dragStart(e.nativeEvent, nodeOf(picked) ?? undefined);
  };
  const release = (e: PointerEvent) => {
    const p = pressed.current;
    pressed.current = null;
    if (!p?.onPicked || p.stack.length < 2 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP || e.timeStamp - p.at > TAP_LONGEST) return;
    clearTimeout(beneath.current);
    beneath.current = window.setTimeout(() => {
      onEditText(false);
      onPick(nextBeneath(p.stack, picked));
    }, BENEATH_AFTER);
  };

  const dragEnd = ({ lastEvent, target: el }: OnDragEnd) => {
    if (!lastEvent || !element) return;
    el.style.transform = '';
    const [tx, ty] = lastEvent.beforeTranslate;
    onChange(element.id, { x: Math.round(element.x + tx), y: Math.round(element.y + ty) });
  };
  const resizeEnd = ({ lastEvent, target: el }: OnResizeEnd) => {
    if (!lastEvent || !element) return;
    el.style.transform = '';
    const [left, top] = drawnLeftTop(element);
    const [tx, ty] = lastEvent.drag.beforeTranslate;
    onChange(element.id, boxAfter(element, left + tx, top + ty, lastEvent.width, lastEvent.height));
  };

  return (
    <HoldMenu label={t('slideEditor.elementMenu')} menu={menu} className="w-full">
      <div
        ref={box}
        className="relative w-full aspect-video select-none touch-none"
        onPointerDown={press}
        onPointerUp={release}
        onMouseDown={dragCovered}
        onTouchStart={dragCovered}
        onDoubleClick={(e) => {
          clearTimeout(beneath.current);
          if (element?.kind === 'text' && (e.target as Element).closest('[data-element]')) onEditText(true);
        }}
        data-testid="slide-canvas"
      >
        <div className="absolute inset-0 overflow-hidden rounded-xl ring-1 ring-separator shadow-[0_2px_12px_rgba(0,0,0,0.12)]">
          <div ref={setStage} className="absolute left-0 top-0 origin-top-left" style={{ width: CANVAS.width, height: CANVAS.height, transform: `scale(${scale})`, ...stageCss(theme, 'song') }}>
            <CustomPageView page={page} theme={theme} hide={writing?.id} />
            {writing && <InlineText element={writing} theme={theme} onChange={(text) => onChange(writing.id, { text })} onDone={() => onEditText(false)} />}
          </div>
        </div>
        {target && element && !writing && (
          <Moveable
            ref={moveable}
            target={target}
            draggable
            resizable
            keepRatio={element.kind === 'image'}
            throttleDrag={0}
            snappable
            snapContainer={stage}
            elementGuidelines={guides()}
            snapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
            elementSnapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
            snapThreshold={6}
            onDrag={({ target: el, transform }) => {
              el.style.transform = transform;
            }}
            onDragEnd={dragEnd}
            onResize={({ target: el, width, height, drag }) => {
              el.style.width = `${width}px`;
              el.style.height = `${height}px`;
              el.style.transform = drag.transform;
            }}
            onResizeEnd={resizeEnd}
          />
        )}
      </div>
    </HoldMenu>
  );
}

/** A text written on the slide itself: a field over it in its own size, font and colour; Escape or a tap beside it ends. */
function InlineText({ element: e, theme, onChange, onDone }: { element: Extract<CustomElement, { kind: 'text' }>; theme: Theme; onChange: (text: string) => void; onDone: () => void }) {
  const main = mainCss(theme, 'song');
  return (
    <textarea
      data-writing
      // eslint-disable-next-line jsx-a11y/no-autofocus -- a double tap asks to write here
      autoFocus
      aria-label={t('slideEditor.text')}
      value={e.text}
      maxLength={2000}
      onChange={(ev) => onChange(ev.target.value)}
      onBlur={onDone}
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return;
        ev.stopPropagation();
        onDone();
      }}
      className="absolute resize-none overflow-hidden bg-transparent outline-2 outline-sky-500 outline-offset-4"
      style={{
        left: e.x,
        top: e.y,
        width: e.w,
        height: Math.max(e.h, e.size * 1.5),
        ...main,
        fontSize: e.size,
        fontWeight: e.bold ? 700 : main.fontWeight,
        fontStyle: e.italic ? 'italic' : 'normal',
        textAlign: e.align,
        color: e.color ?? String(main.color),
        textShadow: 'none',
      }}
    />
  );
}
