import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ROUND_CLOSE } from '../../ui/glass.ts';
import { CloseIcon } from '../../ui/icons.tsx';
import { useSheetDrag } from '../../ui/sheetDrag.ts';

// Keynote's Format on a phone (docs/custom-slides.md): a sheet over the lower part of the screen, the page still in
// view above it; pulled down, ✕ or Escape, it goes. On a computer and an iPad the same panel stands beside the page.

export function FormatSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useSheetDrag(sheet, bar, onClose, () => undefined);
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
  return createPortal(
    <div
      ref={sheet}
      role="dialog"
      aria-label={title}
      className="sheet-in fixed inset-x-0 bottom-0 z-[150] max-h-[55svh] flex flex-col rounded-t-[2rem] bg-sheet text-stone-900 dark:text-stone-100 shadow-[0_-8px_30px_rgba(0,0,0,0.25)] pb-safe-bottom"
      data-testid="format-sheet"
    >
      <div ref={bar} className="shrink-0 touch-none">
        <div className="flex justify-center pt-1.5">
          <span className="w-9 h-1.5 rounded-full bg-stone-300 dark:bg-raised-2" aria-hidden="true" />
        </div>
        <div className="relative flex items-center justify-center h-12 px-4">
          <h2 className="font-semibold text-[17px]">{title}</h2>
          <AppButton variant="plain" aria-label={t('common.close')} title={t('common.close')} className={`absolute right-3 ${ROUND_CLOSE}`} onClick={onClose}>
            <CloseIcon className="size-4" />
          </AppButton>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
    </div>,
    document.body,
  );
}
