import { createContext, useContext, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { CloseIcon } from './icons.tsx';
import { useSheetDrag } from './sheetDrag.ts';

/**
 * A sheet from the bottom, as iOS draws one at its medium height (docs/layout-2-0.md): as high as its content,
 * floating off the sides and the bottom, a grabber, the title in the middle and ✕ at the right. Pulled down
 * (`useSheetDrag`), a tap outside, ✕ or Escape closes it; Escape closes only the sheet, not what is under it.
 * From the `sm` width (an iPad) it is centred, as iPadOS's form sheet, without the grabber. On a phone it slides up
 * from below as it opens (`sheet-in`) and down off the screen as it closes; centred it grows out of its place and
 * fades as it closes. However it is closed: ✕, a tap outside, Escape, or a choice in it (`useSheetDismiss`).
 */
export function Sheet({ title, onClose, leading, children }: { title: string; onClose: () => void; leading?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  /** Slides the sheet off the bottom of the screen (or fades it, centred) and the dimming away, then closes it and runs `then`. */
  const dismiss = (then?: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    const done = () => {
      onClose();
      then?.();
    };
    const el = panel.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    el.getAnimations().forEach((a) => a.cancel()); // one still sliding in starts down from where it stands
    if (matchMedia('(width >= 40rem)').matches) {
      el.style.transition = `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`;
      el.style.transform = 'scale(0.96)';
      el.style.opacity = '0';
    } else {
      el.style.transition = `transform ${OUT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      el.style.transform = `translateY(${innerHeight - el.getBoundingClientRect().top}px)`;
    }
    const shade = backdrop.current;
    if (shade) {
      shade.style.transition = `background-color ${OUT_MS}ms`;
      shade.style.backgroundColor = 'rgb(0 0 0 / 0)';
    }
    setTimeout(done, OUT_MS);
  };
  // The page under it brightens as the sheet is pulled away.
  useSheetDrag(panel, bar, onClose, (progress, ms) => {
    const el = backdrop.current;
    if (!el) return;
    el.style.transition = ms ? `background-color ${ms}ms` : 'none';
    el.style.backgroundColor = `rgb(0 0 0 / ${0.4 * (1 - progress)})`;
  });
  return createPortal(
    <div
      ref={backdrop}
      data-overlay
      className="dialog-in fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // No room kept for a scrollbar (app.css keeps it in every box that scrolls): a sheet is short, and its rows
        // stand as far from the right edge as from the left (Lars, 2026-11-02).
        className="sheet-in w-full max-w-lg m-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] sm:mb-2 max-h-[85svh] overflow-y-auto [scrollbar-gutter:auto] rounded-[2.25rem] bg-sheet text-stone-900 dark:text-stone-100 shadow-2xl pb-4"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') dismiss();
        }}
      >
        <div ref={bar} className="touch-none">
          <div className="flex justify-center pt-1.5 sm:invisible">
            <span className="w-9 h-1.5 rounded-full bg-stone-300 dark:bg-raised-2" aria-hidden="true" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 pt-1 pb-3">
            <div className="justify-self-start">{leading}</div>
            <h2 id={titleId} className="text-[17px] font-semibold truncate">
              {title}
            </h2>
            <AppButton
              variant="plain"
              aria-label={t('common.close')}
              onClick={() => dismiss()}
              className="justify-self-end size-11 rounded-full flex items-center justify-center cursor-pointer bg-stone-200 dark:bg-raised/60"
            >
              <CloseIcon className="size-4" />
            </AppButton>
          </div>
        </div>
        <Dismiss.Provider value={dismiss}>
          <div className="px-4 flex flex-col gap-4">{children}</div>
        </Dismiss.Provider>
      </div>
    </div>,
    document.body,
  );
}

/** How long a sheet takes to slide off the screen as it closes. */
const OUT_MS = 300;

const Dismiss = createContext<(then?: () => void) => void>((then) => then?.());

/** Closes the sheet this is in as iOS does, sliding it away, then runs `then`: for a choice in a sheet. */
export function useSheetDismiss() {
  return useContext(Dismiss);
}

/** A group of rows in a sheet or a list, as iOS's inset grouped lists: rounded, the rows split by hairlines. */
export const GROUP = 'rounded-[1.375rem] overflow-hidden bg-sheet-cell divide-y-[0.5px] divide-separator';
