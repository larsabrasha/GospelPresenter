import { useLayoutEffect, useState, type RefObject } from 'react';
import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, PaintBrushIcon } from '../../ui/icons.tsx';

// What the slideshows', the overlays' and the themes' editors share around the slide (docs/custom-slides.md, Lars
// 2026-11-26), as Keynote's: round buttons in capsules, Ångra and Gör om, the brush that shows and hides Format, and a
// row of choices under the slide.

/** A round button of an editor's toolbar, and the capsule a group of them sits in. */
export const TOOL =
  'size-9 rounded-full flex items-center justify-center cursor-pointer text-sky-600 dark:text-sky-400 hover:bg-raised-2 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-default';
export const GROUP = 'flex items-center rounded-full bg-surface dark:bg-raised p-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.12)]';

/** From this width of the editor's column, Format is a panel beside the slide; narrower, a popover or a sheet. */
const PANEL_FROM = 640;

/** Whether `ref`'s element is at least `from` wide (by default room for Format beside the slide), kept up as it changes. */
export function useWide(ref: RefObject<HTMLElement | null>, from = PANEL_FROM): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= from);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return wide;
}

export function UndoRedo({ canUndo, canRedo, onUndo, onRedo }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  return (
    <>
      <AppButton variant="plain" className={TOOL} disabled={!canUndo} aria-label={t('slideEditor.undo')} title={t('slideEditor.undo')} onClick={onUndo}>
        <ArrowUturnLeftIcon className="size-5" />
      </AppButton>
      <AppButton variant="plain" className={TOOL} disabled={!canRedo} aria-label={t('slideEditor.redo')} title={t('slideEditor.redo')} onClick={onRedo}>
        <ArrowUturnRightIcon className="size-5" />
      </AppButton>
    </>
  );
}

/** The brush: Format shown or hidden, filled while it is open. */
export function FormatButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <AppButton variant="plain" className={`${TOOL} ${open ? 'bg-sky-500! text-white!' : ''}`} aria-label={t('slideEditor.format')} title={t('slideEditor.format')} aria-pressed={open} onClick={onToggle}>
      <PaintBrushIcon className="size-5" />
    </AppButton>
  );
}

/** A row of choices under the slide, as a segmented control with its label before it. */
export function ChoiceRow<V extends string>({ label, value, choices, onChange, className = '' }: { label: string; value: V; choices: [V, TextKey][]; onChange: (v: V) => void; className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-[13px] ${className}`}>
      <span className="text-stone-500 dark:text-stone-400 whitespace-nowrap">{label}</span>
      <div className="flex flex-1 rounded-full bg-stone-200 dark:bg-raised p-0.5" role="radiogroup" aria-label={label}>
        {choices.map(([v, key]) => (
          <AppButton
            key={v}
            variant="plain"
            role="radio"
            aria-checked={value === v}
            className={`flex-1 h-8 px-3 rounded-full whitespace-nowrap cursor-pointer ${value === v ? 'bg-surface dark:bg-raised-2 shadow font-medium' : 'text-stone-600 dark:text-stone-300'}`}
            onClick={() => onChange(v)}
          >
            {t(key)}
          </AppButton>
        ))}
      </div>
    </div>
  );
}
