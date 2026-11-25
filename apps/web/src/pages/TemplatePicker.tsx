import type { Presentation } from '@gp/core';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { ROUND_CLOSE } from '../ui/glass.ts';
import { CAPTION, GROUP_ROW } from '../ui/Group.tsx';
import { ChevronRightIcon, CloseIcon, DocumentIcon, DocumentTextIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { href } from '../ui/router.ts';
import { templateDetails } from './templates.ts';

/** A group of rows, hairlines between them, as Inställningar's. */
const GROUP = `${CARD} flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator`;
/** A row: what it starts from, and ›. */
const ROW = `${GROUP_ROW} w-full text-left cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06]`;

/**
 * The first step of Skapa when there are templates (Dashboard.razor): a blank presentation, then the templates, the last
 * used first, as rows of groups as Inställningar's (Lars, 2026-11-25: the cards were dull, a suggested one at the
 * top was not better). Each opens the details, the date and the time filled in and still to change, where Skapa makes
 * it. Who may change the templates has Hantera mallar beside the caption (Lars, 2026-11-02).
 */
export function TemplatePicker({ templates, manage, onPick, onClose }: { templates: Presentation[]; manage: boolean; onPick: (template: Presentation | null) => void; onClose: () => void }) {
  return (
    <Dialog title={t('presentations.createTitle')} onClose={onClose}>
      <AppButton variant="plain" className={`absolute top-4 right-4 ${ROUND_CLOSE}`} title={t('common.close')} aria-label={t('common.close')} onClick={onClose}>
        <CloseIcon className="size-5" />
      </AppButton>
      <div className={GROUP}>
        <AppButton variant="plain" className={ROW} onClick={() => onPick(null)}>
          <span className="flex items-center gap-3 min-w-0">
            <DocumentIcon className="size-5 shrink-0 text-stone-400 dark:text-stone-500" />
            <span className="truncate">{t('templates.blank')}</span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
        </AppButton>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2">
        <h3 className={CAPTION}>{t('templates.pickerTitle')}</h3>
        {manage && (
          // A button, not a link (Lars, 2026-11-25), small beside the caption.
          <AppButton variant="secondary" href={href({ page: 'templates' })} onClick={onClose} className="h-8! touch:h-11! px-3! text-[13px]">
            {t('templates.manage')}
          </AppButton>
        )}
      </div>
      <div className={GROUP}>
        {templates.map((tp) => (
          <AppButton key={tp.id} variant="plain" className={ROW} onClick={() => onPick(tp)}>
            <span className="flex items-center gap-3 min-w-0">
              <DocumentTextIcon className="size-5 shrink-0 text-stone-400 dark:text-stone-500" />
              <span className="min-w-0">
                <span className="block truncate">{tp.name}</span>
                {templateDetails(tp) && <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{templateDetails(tp)}</span>}
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
          </AppButton>
        ))}
      </div>
    </Dialog>
  );
}
