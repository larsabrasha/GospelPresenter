import type { Presentation } from '@gp/core';
import { locale, t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { ROUND_CLOSE } from '../ui/glass.ts';
import { CAPTION, GROUP_ROW } from '../ui/Group.tsx';
import { ChevronRightIcon, CloseIcon, DocumentIcon, DocumentTextIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { href } from '../ui/router.ts';
import { nextDate, suggestedTemplate, templateDetails } from './templates.ts';

/** A row of the group under the suggestion: what it starts from, and ›. */
const ROW = `${GROUP_ROW} w-full text-left cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06]`;

/**
 * The first step of Skapa when there are templates (Dashboard.razor), as Calendar suggests the next event (Lars,
 * 2026-11-25: the list of cards was dull): the template whose next service comes soonest at the top, its date on a
 * calendar leaf, the whole card the choice; under it, in one group, a blank presentation and the other templates.
 * Each opens the details, the date and the time filled in and still to change, where Skapa makes it. Who may change
 * the templates has Hantera mallar beside the caption (Lars, 2026-11-02).
 */
export function TemplatePicker({ templates, manage, onPick, onClose }: { templates: Presentation[]; manage: boolean; onPick: (template: Presentation | null) => void; onClose: () => void }) {
  const suggested = suggestedTemplate(templates);
  const others = templates.filter((tp) => tp !== suggested);
  return (
    <Dialog title={t('presentations.createTitle')} onClose={onClose}>
      <AppButton variant="plain" className={`absolute top-4 right-4 ${ROUND_CLOSE}`} title={t('common.close')} aria-label={t('common.close')} onClick={onClose}>
        <CloseIcon className="size-5" />
      </AppButton>
      {suggested && <Suggestion template={suggested} onPick={() => onPick(suggested)} />}
      <div className="flex items-center justify-between gap-2 pt-2">
        <h3 className={CAPTION}>{t('templates.more')}</h3>
        {manage && (
          // A button, not a link (Lars, 2026-11-25), small beside the caption.
          <AppButton variant="secondary" href={href({ page: 'templates' })} onClick={onClose} className="h-8! touch:h-11! px-3! text-[13px]">
            {t('templates.manage')}
          </AppButton>
        )}
      </div>
      <div className={`${CARD} flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator`}>
        <AppButton variant="plain" className={ROW} onClick={() => onPick(null)}>
          <span className="flex items-center gap-3 min-w-0">
            <DocumentIcon className="size-5 shrink-0 text-stone-400 dark:text-stone-500" />
            <span className="truncate">{t('templates.blank')}</span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
        </AppButton>
        {others.map((tp) => (
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

/** The suggested template: its next date on a calendar leaf, its name, the day and time in words, the whole card the choice. */
function Suggestion({ template, onPick }: { template: Presentation; onPick: () => void }) {
  const date = nextDate(template);
  const day = date ? new Date(`${date}T12:00`) : null;
  const when = day ? [new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(day), template.time].filter(Boolean).join(' · ') : templateDetails(template);
  const line = [when, day && template.location].filter(Boolean).join(' · ');
  return (
    <AppButton
      variant="plain"
      data-testid="suggested-template"
      onClick={onPick}
      className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left bg-sky-500/10 hover:bg-sky-500/15 dark:bg-sky-400/15 dark:hover:bg-sky-400/20 cursor-pointer"
    >
      <span className="shrink-0 size-12 rounded-xl bg-surface flex flex-col items-center justify-center leading-none text-sky-600 dark:text-sky-400">
        {day ? (
          <>
            <span className="text-[10px] font-semibold uppercase">{new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(day).replace('.', '')}</span>
            <span className="text-xl font-semibold tabular-nums">{day.getDate()}</span>
          </>
        ) : (
          <DocumentTextIcon className="size-6" />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold truncate text-sky-700 dark:text-sky-300">{template.name}</span>
        {line && <span className="block text-sm text-sky-700/80 dark:text-sky-300/80 first-letter:uppercase truncate">{line}</span>}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-sky-600/70 dark:text-sky-400/70" />
    </AppButton>
  );
}
