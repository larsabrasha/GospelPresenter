import type { Presentation } from '@gp/core';
import { useDataReading, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { SMALL_ACTION } from '../../ui/Group.tsx';
import { CalendarIcon } from '../../ui/icons.tsx';
import { RowChevron, ROW_HOVER } from '../../ui/List.tsx';
import { href, navigate } from '../../ui/router.ts';
import { fullDate } from '../dashboard.ts';
import { CALENDAR_READS, presentationEvent, whenText } from './data.ts';

/**
 * A presentation's side of the link (docs/planning.md, "The link"): the event it belongs to, as a row that opens it, the
 * date and time said to be the calendar's; or, for one with a date that is not in the calendar, Lägg i kalendern.
 */
export function CalendarLink({ presentation: p, manage }: { presentation: Presentation; manage: boolean }) {
  const db = useDb();
  const trySave = useTrySave();
  const event = useDataReading((d) => presentationEvent(d, p.id), [p.id], CALENDAR_READS);
  if (event === undefined) return null;
  if (event)
    return (
      <div className="space-y-1">
        <a href={href({ page: 'event', id: event.id })} aria-label={`${t('presentation.inCalendar')}: ${event.title}`} className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-surface no-underline text-inherit ${ROW_HOVER}`}>
          <span className="size-8 shrink-0 rounded-lg grid place-items-center bg-stone-200 dark:bg-white/10 text-stone-600 dark:text-stone-300">
            <CalendarIcon className="size-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium truncate">{event.title || t('calendar.untitled')}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{[event.date ? fullDate(event.date, false) : '', whenText(event), event.place].filter(Boolean).join(' · ')}</span>
          </span>
          <RowChevron />
        </a>
      </div>
    );
  if (!manage || !p.eventDate) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-surface">
      <span className="text-xs text-stone-500 dark:text-stone-400">{t('presentation.notInCalendar')}</span>
      <AppButton
        variant="plain"
        className={SMALL_ACTION}
        onClick={async () => {
          const id = newId();
          if (await trySave(db.mutate('createEventFromPresentation', { presentationId: p.id, eventId: id, at: Date.now() }))) navigate({ page: 'event', id });
        }}
      >
        <CalendarIcon className="size-3.5" />
        {t('presentation.addToCalendar')}
      </AppButton>
    </div>
  );
}
