import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { addMonths, calendarDays, fullDate, monthTitle, tileOf } from './dashboard.ts';

const ROUND = 'size-9 touch:size-11 rounded-full flex items-center justify-center cursor-pointer text-sky-600 dark:text-sky-400 hover:bg-raised-2';

/**
 * Välj dag, a filter of the start page (docs/planning.md, "One list"; Lars, 2026-11-28): a month at a time, Monday
 * first, ‹ › to any month, the past too; a dot under a day with events (those the other filters let through), blue ahead
 * and grey behind. The list or table under it shows the month; a tap on a day shows that day, a second the month again.
 */
export function MonthFilter({
  month,
  onMonth,
  day,
  onDay,
  today,
  days,
}: {
  month: string;
  onMonth: (month: string) => void;
  day: string | null;
  onDay: (day: string | null) => void;
  today: string;
  /** The days that have events shown. */
  days: ReadonlySet<string>;
}) {
  const go = (next: string) => {
    onMonth(next);
    onDay(null);
  };
  return (
    // As wide as a month reads well, not the page's width (Lars, 2026-11-28): days near square, at the left as the filters are.
    <div className="space-y-2 w-full max-w-sm">
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
          const inMonth = d.startsWith(month);
          return (
            <AppButton
              key={d}
              variant="plain"
              aria-label={fullDate(d)}
              aria-pressed={day === d}
              className={`h-11 flex flex-col items-center pt-1 gap-0.5 rounded-lg cursor-pointer hover:bg-raised-2 ${inMonth ? '' : 'text-stone-300 dark:text-stone-600'}`}
              onClick={() => onDay(day === d ? null : d)}
            >
              <span className={`size-7 flex items-center justify-center rounded-full text-[15px] tabular-nums ${day === d ? 'bg-stone-800 text-white dark:bg-white dark:text-stone-900 font-semibold' : d === today ? 'bg-stone-200 dark:bg-white/20 font-semibold' : ''}`}>
                {Number(d.slice(8))}
              </span>
              {inMonth && days.has(d) && <span className={`size-1.5 rounded-full ${d < today ? 'bg-stone-400' : 'bg-sky-500'}`} />}
            </AppButton>
          );
        })}
      </div>
    </div>
  );
}
