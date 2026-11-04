import { useEffect, useEffectEvent, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { FLOATING_EDGE, ROUND_CLOSE } from '../../ui/glass.ts';
import { CloseIcon } from '../../ui/icons.tsx';
import { useSheetDrag } from '../../ui/sheetDrag.ts';

// Keynote's Format where the editor is too narrow to have it beside the page (docs/custom-slides.md, Lars
// 2026-11-04): on a phone a sheet over the lower part of the screen, the page in view above it, pulled down to close;
// wider, as on an iPad, a popover under the brush, the page beside and under it still to tap and drag, the panel
// open while the picked element changes. ✕, Escape or the brush again closes either. Where the editor is wide enough
// (`@4xl`) the same panel stands beside the page and this is not shown.

const PHONE = '(width < 40rem)';

function usePhone(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const media = matchMedia(PHONE);
      media.addEventListener('change', changed);
      return () => media.removeEventListener('change', changed);
    },
    () => matchMedia(PHONE).matches,
  );
}

/** Escape closes the panel, unless a menu in it has the key. */
function useEscape(onClose: () => void) {
  const closeNow = useEffectEvent(onClose);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof Element && e.target.closest('[role="menu"]'))) return;
      e.stopPropagation();
      closeNow();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="relative flex items-center justify-center h-12 px-4">
      <h2 className="font-semibold text-[17px]">{title}</h2>
      <AppButton variant="plain" aria-label={t('common.close')} title={t('common.close')} className={`absolute right-3 ${ROUND_CLOSE}`} onClick={onClose}>
        <CloseIcon className="size-4" />
      </AppButton>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useSheetDrag(sheet, bar, onClose, () => undefined);
  return createPortal(
    <div
      ref={sheet}
      role="dialog"
      aria-label={title}
      className={`sheet-in fixed inset-x-0 bottom-0 z-[150] max-h-[55svh] flex flex-col rounded-t-[2rem] bg-sheet text-stone-900 dark:text-stone-100 shadow-[0_-8px_30px_rgba(0,0,0,0.25)] ${FLOATING_EDGE} pb-safe-bottom`}
      data-testid="format-sheet"
    >
      <div ref={bar} className="shrink-0 touch-none">
        <div className="flex justify-center pt-1.5">
          <span className="w-9 h-1.5 rounded-full bg-stone-300 dark:bg-raised-2" aria-hidden="true" />
        </div>
        <Header title={title} onClose={onClose} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
    </div>,
    document.body,
  );
}

/**
 * The popover: placed by the editor in its column, under the toolbar at the right (its parent is `relative`), so it
 * scrolls with the page and stands under the brush.
 */
function Popover({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className={`popover-in @4xl:hidden absolute right-0 top-12 z-[150] w-[23rem] max-w-full max-h-[min(70svh,40rem)] flex flex-col rounded-2xl bg-sheet text-stone-900 dark:text-stone-100 shadow-2xl ${FLOATING_EDGE}`}
      data-testid="format-sheet"
    >
      <Header title={title} onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
    </div>
  );
}

export function FormatSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const phone = usePhone();
  useEscape(onClose);
  return phone ? (
    <Sheet title={title} onClose={onClose}>
      {children}
    </Sheet>
  ) : (
    <Popover title={title} onClose={onClose}>
      {children}
    </Popover>
  );
}
