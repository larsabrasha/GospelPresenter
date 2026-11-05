import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import { rubberBand } from './sheetDrag.ts';

// Quick Look's fingers, as Photos on an iPhone (Lars, 2026-11-05): a swipe sideways goes to the picture before or
// after, the picture following the finger and giving at either end; two fingers pinch it larger, round the point
// between them; a double tap zooms in there or back out; one finger moves a picture zoomed in, and the sheet is not
// pulled down meanwhile (`zoomed`). A trackpad's pinch (a wheel with Ctrl) zooms too. Touch events, as the sheet's
// pull (ui/sheetDrag.ts), so a move can be kept from the browser's own zoom and scroll.

/** How large a picture may be pinched, and what a double tap zooms it to. */
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** A swipe this far, or this fast (px per ms), goes to the next. */
const SWIPE_PX = 60;
const SWIPE_SPEED = 0.4;
/** Two taps this close in time and place are a double tap. */
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;
const SETTLE = 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)';

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Gesture {
  kind: 'one' | 'pinch';
  startX: number;
  startY: number;
  at: number;
  view: View;
  /** The picture's centre at scale 1, on the screen. */
  centre: { x: number; y: number };
  /** One finger: whether it swipes (sideways at scale 1) or moves a zoomed picture; undecided until it has moved. */
  mode?: 'swipe' | 'pan' | 'none';
  dx: number;
  dist?: number;
  /** The picture's point under the fingers, at the pinch's start. */
  anchor?: { x: number; y: number };
}

const between = (a: Touch, b: Touch) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
const apart = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * The gestures on `area`, the item's room; `picture` finds the picture in it (null for a video or a sound, which only
 * swipe). `onZoom` says whether it is zoomed in, for the sheet's pull. `item` names the item shown: a new one starts
 * at scale 1, sliding in from the side it came from.
 */
export function useLookGestures(
  area: RefObject<HTMLElement | null>,
  picture: () => HTMLElement | null,
  item: string,
  go: { previous?: () => void; next?: () => void },
  onZoom: (zoomed: boolean) => void,
) {
  const previous = useEffectEvent(() => go.previous?.());
  const next = useEffectEvent(() => go.next?.());
  const has = useEffectEvent((side: 'previous' | 'next') => !!go[side]);
  const zoomChanged = useEffectEvent(onZoom);
  const find = useEffectEvent(picture);
  /** The picture's zoom, kept across renders; a new item starts it again. */
  const shown = useRef<View>({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let gesture: Gesture | null = null;
    let lastTap: { at: number; x: number; y: number } | null = null;

    const draw = (v: View, animate: boolean) => {
      const img = find();
      if (!img) return;
      img.style.transition = animate ? SETTLE : 'none';
      img.style.transform = v.scale === 1 && v.x === 0 && v.y === 0 ? '' : `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    };
    const set = (v: View, animate: boolean) => {
      const was = shown.current.scale > 1;
      shown.current = v;
      draw(v, animate);
      if (was !== v.scale > 1) zoomChanged(v.scale > 1);
    };
    /** A zoomed picture kept over its room: no further out than its edges reach. */
    const kept = (v: View): View => {
      const img = find();
      if (!img || v.scale <= 1) return { scale: 1, x: 0, y: 0 };
      const w = (img.offsetWidth * v.scale - el.clientWidth) / 2;
      const h = (img.offsetHeight * v.scale - el.clientHeight) / 2;
      const clamp = (n: number, m: number) => (m <= 0 ? 0 : Math.max(-m, Math.min(m, n)));
      return { scale: v.scale, x: clamp(v.x, w), y: clamp(v.y, h) };
    };
    const centreOf = () => {
      const r = find()?.getBoundingClientRect() ?? el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - shown.current.x, y: r.top + r.height / 2 - shown.current.y };
    };
    /** Zoomed to `scale` with the picture's point under (x, y) kept there. */
    const zoomAt = (scale: number, x: number, y: number, from: View, centre: { x: number; y: number }): View => {
      const px = (x - centre.x - from.x) / from.scale;
      const py = (y - centre.y - from.y) / from.scale;
      return { scale, x: x - centre.x - scale * px, y: y - centre.y - scale * py };
    };
    const slide = (dx: number, animate: boolean) => {
      el.style.transition = animate ? SETTLE : 'none';
      el.style.transform = dx === 0 ? '' : `translateX(${dx}px)`;
    };

    const start = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (!a) return;
      if (b && find()) {
        const mid = between(a, b);
        const centre = centreOf();
        gesture = { kind: 'pinch', startX: mid.x, startY: mid.y, at: e.timeStamp, view: shown.current, centre, dx: 0, dist: apart(a, b), anchor: mid };
        e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      gesture = { kind: 'one', startX: a.clientX, startY: a.clientY, at: e.timeStamp, view: shown.current, centre: centreOf(), dx: 0 };
    };

    const move = (e: TouchEvent) => {
      const g = gesture;
      const [a, b] = [e.touches[0], e.touches[1]];
      if (!g || !a) return;
      if (g.kind === 'pinch') {
        if (!b) return;
        e.preventDefault();
        const mid = between(a, b);
        const raw = (g.view.scale * apart(a, b)) / g.dist!;
        // Past the limits it gives, as Photos lets a picture be pinched a little smaller and springs it back.
        const scale = raw < 1 ? 1 - rubberBand(1 - raw, 0.4) : raw > MAX_SCALE ? MAX_SCALE + rubberBand(raw - MAX_SCALE, 1) : raw;
        const zoomed = zoomAt(scale, g.anchor!.x, g.anchor!.y, g.view, g.centre);
        set({ scale, x: zoomed.x + mid.x - g.anchor!.x, y: zoomed.y + mid.y - g.anchor!.y }, false);
        return;
      }
      const dx = a.clientX - g.startX;
      const dy = a.clientY - g.startY;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < 8) return;
        g.mode = g.view.scale > 1 && find() ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'none';
      }
      if (g.mode === 'pan') {
        e.preventDefault();
        set({ scale: g.view.scale, x: g.view.x + dx, y: g.view.y + dy }, false);
      } else if (g.mode === 'swipe') {
        e.preventDefault();
        g.dx = dx;
        // Nothing on that side: it gives, and no more.
        const open = dx < 0 ? has('next') : has('previous');
        slide(open ? dx : Math.sign(dx) * rubberBand(Math.abs(dx), el.clientWidth * 0.2), false);
      }
    };

    const end = (e: TouchEvent) => {
      const g = gesture;
      if (!g || e.touches.length) {
        // A finger of a pinch lifted: the other may go on moving the picture.
        if (g?.kind === 'pinch' && e.touches.length === 1) {
          const a = e.touches[0]!;
          gesture = { kind: 'one', startX: a.clientX, startY: a.clientY, at: e.timeStamp, view: shown.current, centre: centreOf(), dx: 0, mode: shown.current.scale > 1 ? 'pan' : 'none' };
        }
        return;
      }
      gesture = null;
      if (g.kind === 'pinch') return set(kept(shown.current.scale < 1.02 ? { scale: 1, x: 0, y: 0 } : { ...shown.current, scale: Math.min(shown.current.scale, MAX_SCALE) }), true);
      if (g.mode === 'pan') return set(kept(shown.current), true);
      if (g.mode === 'swipe') {
        const speed = g.dx / Math.max(e.timeStamp - g.at, 1);
        const toNext = (g.dx < -SWIPE_PX || speed < -SWIPE_SPEED) && has('next');
        const toPrevious = (g.dx > SWIPE_PX || speed > SWIPE_SPEED) && has('previous');
        if (toNext || toPrevious) {
          // Off the side it went; the next comes in from the other (the effect for the new item).
          slide(toNext ? -el.clientWidth : el.clientWidth, true);
          setTimeout(() => (toNext ? next() : previous()), 180);
        } else slide(0, true);
        return;
      }
      // A tap: two close together zoom in at that point, or back out.
      const t = e.changedTouches[0];
      if (!t || g.mode || !find()) return;
      if (lastTap && e.timeStamp - lastTap.at < DOUBLE_TAP_MS && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < TAP_SLOP * 3) {
        lastTap = null;
        e.preventDefault();
        set(shown.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : kept(zoomAt(DOUBLE_TAP_SCALE, t.clientX, t.clientY, shown.current, centreOf())), true);
      } else lastTap = { at: e.timeStamp, x: t.clientX, y: t.clientY };
    };

    // A trackpad's pinch is a wheel with Ctrl; a wheel alone is left to the page.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !find()) return;
      e.preventDefault();
      const scale = Math.max(1, Math.min(MAX_SCALE, shown.current.scale * Math.exp(-e.deltaY * 0.01)));
      set(kept(zoomAt(scale, e.clientX, e.clientY, shown.current, centreOf())), false);
    };

    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('wheel', wheel);
    };
  }, [area]);

  // A new item: at scale 1, and in from the side the swipe sent the last one out (else where it is).
  const arrive = useEffectEvent((el: HTMLElement) => {
    shown.current = { scale: 1, x: 0, y: 0 };
    zoomChanged(false);
    const out = el.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
    if (!out) return;
    el.style.transition = 'none';
    el.style.transform = `translateX(${-Number(out[1]) * 0.4}px)`;
    void el.offsetWidth; // laid out there, so the move back is a transition
    el.style.transition = SETTLE;
    el.style.transform = '';
  });
  useEffect(() => {
    if (item && area.current) arrive(area.current);
  }, [area, item]);
}
