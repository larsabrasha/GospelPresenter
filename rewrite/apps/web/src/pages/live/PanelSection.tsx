import { useId, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ChevronDownIcon } from '../../ui/icons.tsx';
import { CAPTION } from '../../ui/Toggle.tsx';

/**
 * A section of the live panel (LivePanel.razor): its caption opens and closes
 * it, with the chevron, and the round "i" beside it shows what the section is
 * for. Closed, its content is inert, so neither Tab nor a screen reader finds it.
 */
export function PanelSection({ title, hint, open: initiallyOpen, badge, children }: { title: string; hint: string; open: boolean; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [info, setInfo] = useState(false);
  const id = useId();
  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 min-w-0">
          <AppButton variant="plain" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="cursor-pointer flex items-center gap-2 w-full text-left py-2 -my-2">
            <ChevronDownIcon className={`size-3 text-neutral-400 dark:text-neutral-500 transition-transform duration-300 ${open ? '' : '-rotate-90'}`} />
            <span className={CAPTION}>{title}</span>
            {badge}
          </AppButton>
        </h2>
        <AppButton
          variant="plain"
          aria-pressed={info}
          aria-label={t('live.hint', { title })}
          title={hint}
          onClick={() => setInfo((v) => !v)}
          className={`size-4 shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold border cursor-pointer transition-colors ${
            info ? 'bg-sky-500 border-sky-500 text-white' : 'border-neutral-300 dark:border-neutral-500 text-neutral-400 dark:text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
          }`}
        >
          i
        </AppButton>
      </div>
      {info && <p className="mt-2 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700/50 text-neutral-600 dark:text-neutral-300 text-xs leading-relaxed">{hint}</p>}
      <div id={id} inert={!open} className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="flex flex-col gap-3 p-1 pt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
