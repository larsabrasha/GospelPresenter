import type { StartPage } from '../db/views.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ListSection } from '../ui/List.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { monthTitle } from './dashboard.ts';
import { PresentationRow, UndatedRows } from './StartRows.tsx';

/**
 * Lista (Lars, 2026-11-27: a church plans half a year at a time): what has no date folded into one row at the top,
 * then what is planned, a list per month, today's first; the past is Kalender's. ↑ ↓ Home End run through the months
 * as one list, Tab stopping once.
 */
export function StartList({ page, today, liveId, onCalendar }: { page: StartPage; today: string; liveId: string | undefined; onCalendar: () => void }) {
  const starts = page.months.map((_, i) => page.months.slice(0, i).reduce((n, m) => n + m.rows.length, 0));
  const list = useRovingList(page.months.reduce((n, m) => n + m.rows.length, 0));
  return (
    <div className="space-y-5" onKeyDown={list.onKeyDown}>
      <UndatedRows rows={page.undated} today={today} liveId={liveId} />
      {page.months.map((m, mi) => (
        <ListSection key={m.month} title={monthTitle(m.month, today)}>
          {m.rows.map((p, i) => (
            <PresentationRow key={p.id} p={p} today={today} live={p.id === liveId} nav={list.item(starts[mi]! + i)} />
          ))}
        </ListSection>
      ))}
      {/* Nothing planned and something past: said, with the way to it; with only undated ones their row says enough. */}
      {!page.months.length && page.past > 0 && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-stone-500 dark:text-stone-400">{t('presentations.nothingPlanned')}</p>
          <AppButton variant="secondary" onClick={onCalendar}>
            {t('presentations.viewCalendar')}
          </AppButton>
        </div>
      )}
    </div>
  );
}
