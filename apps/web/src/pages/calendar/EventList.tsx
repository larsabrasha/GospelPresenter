import type { HTMLAttributes } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { SMALL_ACTION } from '../../ui/Group.tsx';
import { DesktopIcon, PlusIcon } from '../../ui/icons.tsx';
import { ListLinkRow, ListSection } from '../../ui/List.tsx';
import { useRovingList } from '../../ui/listNav.ts';
import { href, navigate } from '../../ui/router.ts';
import { fullDate, monthTitle } from '../dashboard.ts';
import { DateTile } from '../StartRows.tsx';
import { whenText, type ListRow } from './data.ts';

// The start page's rows (docs/planning.md, "One list"): each an event, its tile, its title, when and where and the
// first filled fields, how many are missing. A tap opens the event; the button at its end goes straight to its
// presentation, made first when it has none, so a Sunday is one tap (Lars, 2026-11-28).

/**
 * The way from an event to its presentation: Presentation when it has one, + Presentation to make one with the event's
 * title and open it. The word only from a tablet's width; on a phone the icon, named for screen readers.
 */
export function PresentationButton({ e }: { e: Pick<ListRow, 'id' | 'title' | 'presentation'> }) {
  const db = useDb();
  const trySave = useTrySave();
  const p = e.presentation;
  if (p)
    return (
      <AppButton variant="plain" href={href({ page: 'presentation', id: p.id })} aria-label={t('calendar.openPresentation', { name: p.name })} title={p.name} className={SMALL_ACTION}>
        <DesktopIcon className="size-3.5" />
        <span className="max-sm:hidden">{t('start.presentation')}</span>
      </AppButton>
    );
  const create = async () => {
    const presentationId = newId();
    const name = e.title.trim() || t('presentations.defaultName');
    if (await trySave(db.mutate('createPresentationForEvent', { eventId: e.id, presentationId, name, at: Date.now() }))) navigate({ page: 'presentation', id: presentationId });
  };
  return (
    <AppButton variant="plain" aria-label={t('start.createFor', { title: e.title || t('calendar.untitled') })} title={t('event.createPresentation')} className={`${SMALL_ACTION} opacity-70 hover:opacity-100`} onClick={() => void create()}>
      <PlusIcon className="size-3.5" />
      <span className="max-sm:hidden">{t('start.presentation')}</span>
    </AppButton>
  );
}

/** An event as a row of the start page's lists; `liveId` is the presentation this window presents. */
function EventRow({ e, today, liveId, nav }: { e: ListRow; today: string; liveId?: string; nav?: HTMLAttributes<HTMLAnchorElement> }) {
  const who = e.filled.map((f) => `${f.name}: ${f.text}`).join(' · ');
  const live = !!e.presentation && e.presentation.id === liveId;
  return (
    <ListLinkRow
      href={href({ page: 'event', id: e.id })}
      start={<DateTile date={e.date} today={e.date === today} />}
      title={e.title || <span className="text-stone-400">{t('calendar.untitled')}</span>}
      subtitle={[whenText(e), e.place, who].filter(Boolean).join(' · ') || undefined}
      subtitleTitle={e.date ? fullDate(e.date) : undefined}
      nav={nav}
      end={
        <span className="flex items-center gap-1.5 shrink-0">
          {e.missing > 0 && <span className="px-2 py-px rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">{t('calendar.missing', { n: e.missing })}</span>}
          {/* A small red dot, as Music marks what plays in a list: the card "Visas just nu" above says it. */}
          {live && <span role="img" aria-label={t('presentations.live')} title={t('presentations.live')} className="size-2 rounded-full bg-red-500" />}
        </span>
      }
      after={<PresentationButton e={e} />}
    />
  );
}

/** Events a list per month, ↑ ↓ Home End running through them as one list. */
export function EventList({ rows, today, liveId }: { rows: ListRow[]; today: string; liveId?: string }) {
  const months: { month: string; rows: ListRow[] }[] = [];
  for (const r of rows) {
    const month = (r.date ?? '').slice(0, 7);
    if (months.at(-1)?.month !== month) months.push({ month, rows: [] });
    months.at(-1)!.rows.push(r);
  }
  const starts = months.map((_, i) => months.slice(0, i).reduce((n, m) => n + m.rows.length, 0));
  const list = useRovingList(rows.length);
  return (
    <div className="space-y-5" onKeyDown={list.onKeyDown}>
      {months.map((m, mi) => (
        <ListSection key={m.month} title={monthTitle(m.month, today)}>
          {m.rows.map((e, i) => (
            <EventRow key={e.id} e={e} today={today} liveId={liveId} nav={list.item(starts[mi]! + i)} />
          ))}
        </ListSection>
      ))}
    </div>
  );
}
