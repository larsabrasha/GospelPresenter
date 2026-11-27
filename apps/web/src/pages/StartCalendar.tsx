import type { Presentation } from '@gp/core';
import { useState } from 'react';
import { useData } from '../db/react.tsx';
import { calendarMonth } from '../db/views.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons.tsx';
import { CARD, ListSection } from '../ui/List.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { addMonths, calendarDays, fullDate, monthTitle, tileOf } from './dashboard.ts';
import { PresentationRow, UndatedRows } from './StartRows.tsx';

const ROUND = 'size-9 touch:size-11 rounded-full flex items-center justify-center cursor-pointer text-sky-600 dark:text-sky-400 hover:bg-raised-2';

/**
 * Kalender (Lars, 2026-11-27): a month at a time, Monday first, ‹ › to any month, the past too; a dot under a day
 * with presentations, blue ahead and grey behind. A tap on a day shows its presentations under the month, again the
 * whole month. What has no date has its folded row between.
 */
export function StartCalendar({ today, undated, liveId }: { today: string; undated: Presentation[]; liveId: string | undefined }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const rows = useData((db) => calendarMonth(db, month), [month]);
  const on = (day: string) => rows?.filter((p) => p.eventDate === day) ?? [];
  const shown = picked ? on(picked) : (rows ?? []);
  const list = useRovingList(shown.length);
  const go = (next: string) => {
    setMonth(next);
    setPicked(null);
  };
  const title = picked ? fullDate(picked) : monthTitle(month, today);
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 pl-5 pr-2">
          <h2 className="text-[17px] font-semibold">{monthTitle(month, today, true)}</h2>
          <span className="flex items-center gap-1">
            {month !== today.slice(0, 7) && (
              <AppButton variant="plain" className="h-9 touch:h-11 px-3 rounded-full text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2" onClick={() => go(today.slice(0, 7))}>
                {t('presentations.today')}
              </AppButton>
            )}
            <AppButton variant="plain" aria-label={t('presentations.previousMonth')} title={t('presentations.previousMonth')} className={ROUND} onClick={() => go(addMonths(month, -1))}>
              <ChevronLeftIcon className="size-5" />
            </AppButton>
            <AppButton variant="plain" aria-label={t('presentations.nextMonth')} title={t('presentations.nextMonth')} className={ROUND} onClick={() => go(addMonths(month, 1))}>
              <ChevronRightIcon className="size-5" />
            </AppButton>
          </span>
        </div>
        <div className={`${CARD} p-2 grid grid-cols-7 text-center`} role="group" aria-label={monthTitle(month, today, true)}>
          {calendarDays(month)
            .slice(0, 7)
            .map((d) => (
              <span key={d} aria-hidden="true" className="text-[11px] text-stone-500 dark:text-stone-400 pb-1">
                {tileOf(d).weekday}
              </span>
            ))}
          {calendarDays(month).map((d) => {
            const count = on(d).length;
            const inMonth = d.startsWith(month);
            return (
              <AppButton
                key={d}
                variant="plain"
                aria-label={fullDate(d)}
                aria-pressed={picked === d}
                className={`h-11 flex flex-col items-center pt-1 gap-0.5 rounded-lg cursor-pointer hover:bg-raised-2 ${inMonth ? '' : 'text-stone-300 dark:text-stone-600'}`}
                onClick={() => setPicked(picked === d ? null : d)}
              >
                <span
                  className={`size-7 flex items-center justify-center rounded-full text-[15px] tabular-nums ${picked === d ? 'bg-stone-800 text-white dark:bg-white dark:text-stone-900 font-semibold' : d === today ? 'text-red-500 font-semibold' : ''}`}
                >
                  {Number(d.slice(8))}
                </span>
                {inMonth && count > 0 && <span className={`size-1.5 rounded-full ${d < today ? 'bg-stone-400' : 'bg-sky-500'}`} />}
              </AppButton>
            );
          })}
        </div>
      </div>
      <UndatedRows rows={undated} today={today} liveId={liveId} />
      {rows && (
        <div onKeyDown={list.onKeyDown}>
          {shown.length ? (
            <ListSection title={title.charAt(0).toUpperCase() + title.slice(1)}>
              {shown.map((p, i) => (
                <PresentationRow key={p.id} p={p} today={today} live={p.id === liveId} nav={list.item(i)} />
              ))}
            </ListSection>
          ) : (
            <p className="px-5 text-sm text-stone-500 dark:text-stone-400">{t('presentations.noneThen')}</p>
          )}
        </div>
      )}
    </div>
  );
}
