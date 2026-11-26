import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CAPTION } from '../../ui/Group.tsx';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, PaintBrushIcon } from '../../ui/icons.tsx';

// What the slideshows', the overlays' and the themes' editors share around the slide (docs/custom-slides.md, Lars
// 2026-11-26), as Keynote's: round buttons in capsules, Ångra and Gör om, the brush that shows and hides Format, and a
// row of choices under the slide.

/** A round button of an editor's toolbar, and the capsule a group of them sits in. */
export const TOOL =
  'size-9 rounded-full flex items-center justify-center cursor-pointer text-sky-600 dark:text-sky-400 hover:bg-raised-2 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-default';
export const GROUP = 'flex items-center rounded-full bg-surface dark:bg-raised p-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.12)]';

/**
 * The slide's column beside Format's panel: it stays at the top while the page scrolls to the panel's lower rows, so
 * the slide is in view while they are set, as Keynote's canvas beside its scrolling inspector (Lars, 2026-11-26).
 */
export const STAYS = 'sticky top-3 self-start';

/**
 * The slide over Format's panel under it, where the column is too narrow for the panel beside it: it stays at the top
 * on the page's ground while the panel scrolls up under it. Format never covers the slide (Lars, 2026-11-26).
 */
export const STAYS_ABOVE = 'sticky top-0 z-10 bg-ground py-2';

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

interface Choices<V extends string> {
  label: string;
  value: V;
  choices: [V, TextKey][];
  onChange: (v: V) => void;
  className?: string;
}

/** A segmented control, as macOS's for a view: the chosen word white on grey, as Kalender's Dag | Vecka | Månad. */
export function Segmented<V extends string>({ label, value, choices, onChange, className = '' }: Choices<V>) {
  return (
    <div className={`flex rounded-full bg-stone-200 dark:bg-raised p-0.5 text-[13px] ${className}`} role="radiogroup" aria-label={label}>
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
  );
}

/** A row of choices under the slide, as a segmented control with its label before it. */
export function ChoiceRow<V extends string>({ className = '', ...choices }: Choices<V>) {
  return (
    <div className={`flex items-center gap-2 text-[13px] ${className}`}>
      <span className="text-stone-500 dark:text-stone-400 whitespace-nowrap">{choices.label}</span>
      <Segmented {...choices} className="flex-1" />
    </div>
  );
}

/**
 * Format's tabs, as Keynote's: the chosen one filled in the app's colour; with `label` over them, as every group's
 * title in the panel and lined up with them, so they have a name only where there are tabs (Lars, 2026-11-26).
 */
export function FormatTabs<V extends string>({ tabs, value, onChange, label }: { tabs: [V, TextKey][]; value: V; onChange: (v: V) => void; label?: string }) {
  const row = (
    <div className="flex w-full rounded-full bg-stone-200 dark:bg-raised p-0.5" role="tablist" aria-label={label}>
      {tabs.map(([v, key]) => (
        <AppButton
          key={v}
          variant="plain"
          role="tab"
          aria-selected={value === v}
          className={`flex-1 h-8 px-3 rounded-full text-[13px] cursor-pointer ${value === v ? 'bg-sky-500 text-white font-medium' : 'text-stone-600 dark:text-stone-300'}`}
          onClick={() => onChange(v)}
        >
          {t(key)}
        </AppButton>
      ))}
    </div>
  );
  return label ? (
    <div className="space-y-1.5">
      <h2 className={CAPTION}>{label}</h2>
      {row}
    </div>
  ) : (
    row
  );
}

/** Format's panel, beside the slide or under it (`beside`). */
export function FormatPanel({ beside, children }: { beside: boolean; children: ReactNode }) {
  return (
    <section className={beside ? 'w-80 shrink-0' : 'pt-2'} aria-label={t('slideEditor.format')} data-testid="format-panel">
      {children}
    </section>
  );
}
