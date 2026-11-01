import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { CloseIcon } from './icons.tsx';
import { useSheetDrag } from './sheetDrag.ts';

/**
 * A sheet from the bottom, as iOS draws one at its medium height (docs/layout-2-0.md): as high as its content,
 * floating off the sides and the bottom, a grabber, the title in the middle and ✕ at the right. Pulled down
 * (`useSheetDrag`), a tap outside, ✕ or Escape closes it; Escape closes only the sheet, not what is under it.
 */
export function Sheet({ title, onClose, leading, children }: { title: string; onClose: () => void; leading?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
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
      className="dialog-in fixed inset-0 z-[140] flex items-end justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg m-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] max-h-[85svh] overflow-y-auto rounded-[2.25rem] bg-sheet text-neutral-900 dark:text-neutral-100 shadow-2xl pb-5"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div ref={bar} className="touch-none">
          <div className="flex justify-center pt-1.5">
            <span className="w-9 h-1.5 rounded-full bg-neutral-300 dark:bg-raised-2" aria-hidden="true" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 pt-1 pb-3">
            <div className="justify-self-start">{leading}</div>
            <h2 id={titleId} className="text-[17px] font-semibold truncate">
              {title}
            </h2>
            <AppButton
              variant="plain"
              aria-label={t('common.close')}
              onClick={onClose}
              className="justify-self-end size-11 rounded-full flex items-center justify-center cursor-pointer bg-neutral-200 dark:bg-raised/60"
            >
              <CloseIcon className="size-4" />
            </AppButton>
          </div>
        </div>
        <div className="px-4 flex flex-col gap-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A group of rows in a sheet or a list, as iOS's inset grouped lists: rounded, the rows split by hairlines. */
export const GROUP = 'rounded-[1.375rem] overflow-hidden bg-sheet-cell divide-y-[0.5px] divide-separator';
