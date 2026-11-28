import type { Presentation } from '@gp/core';
import { useState, type HTMLAttributes } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CalendarIcon, ChevronDownIcon, ChevronRightIcon } from '../ui/icons.tsx';
import { CARD, ListLinkRow, ROW_HOVER } from '../ui/List.tsx';
import { href } from '../ui/router.ts';
import { fullDate, tileOf } from './dashboard.ts';

// The start page's rows (Lars, 2026-11-27: as a calendar): each with its date in a tile at its start, a little wider
// than tall and all grey, today's a darker grey (Lars, 2026-11-28: red read as a holiday), its time and place under its
// name and no number of items; what has no date folded into one row.

const TILE = 'w-12 shrink-0 rounded-lg flex flex-col items-center justify-center py-1';
const GREY_TILE = `${TILE} bg-stone-100 dark:bg-white/10`;

/** A tile without a date: a calendar in grey, as tall as a dated one. */
const EMPTY_TILE = `${GREY_TILE} h-14 text-stone-400 dark:text-stone-500`;

/** The weekday, the day and the month, on grey; today's on a darker grey. A calendar for one without a date. */
export function DateTile({ date, today }: { date: string | null | undefined; today: boolean }) {
  if (!date)
    return (
      <span aria-hidden="true" className={EMPTY_TILE}>
        <CalendarIcon className="size-5" />
      </span>
    );
  const { weekday, day, month } = tileOf(date);
  return (
    <span aria-hidden="true" className={`${today ? `${TILE} bg-stone-300 dark:bg-white/25` : GREY_TILE} h-14`}>
      <span className="text-[11px]/3.5 font-semibold text-stone-500 dark:text-stone-400">{weekday}</span>
      <span className="text-lg/5 font-semibold tabular-nums">{day}</span>
      <span className="text-[11px]/3.5 text-stone-500 dark:text-stone-400">{month}</span>
    </span>
  );
}

/** A presentation: its tile, its name (today's with "Idag" beside it), and under it its time and place. */
function PresentationRow({ p, today, live, nav }: { p: Presentation; today: string; live: boolean; nav?: HTMLAttributes<HTMLAnchorElement> }) {
  const isToday = p.eventDate === today;
  return (
    <ListLinkRow
      href={href({ page: 'presentation', id: p.id })}
      start={<DateTile date={p.eventDate} today={isToday} />}
      title={
        <>
          {p.name}
          {/* Hidden from the link's name, which stays the presentation's; the tile's red says it too. */}
          {isToday && (
            <span aria-hidden="true" className="ml-2 align-[2px] px-2 py-px rounded-full bg-red-500 text-white text-[11px] font-semibold">
              {t('presentations.today')}
            </span>
          )}
        </>
      }
      subtitle={[p.time, p.location].filter(Boolean).join(' · ') || undefined}
      subtitleTitle={p.eventDate ? fullDate(p.eventDate) : undefined}
      nav={nav}
      end={
        // A small red dot, as Music marks what plays in a list: the card "Visas just nu" above says it (Lars, 2026-11-03).
        live && <span role="img" aria-label={t('presentations.live')} title={t('presentations.live')} className="shrink-0 size-2 rounded-full bg-red-500" />
      }
    />
  );
}

/**
 * What has no date, folded into one card's row, "2 utan datum" and their names, that unfolds them under it (Lars,
 * 2026-11-27: it shows, but takes no room); none, no card.
 */
export function UndatedRows({ rows, today, liveId }: { rows: Presentation[]; today: string; liveId: string | undefined }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <ul className={CARD} aria-label={t('presentations.undated')}>
      <li className={`border-b border-separator last:border-b-0 first:rounded-t-xl last:rounded-b-xl ${ROW_HOVER}`}>
        <AppButton variant="plain" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-3 text-left cursor-pointer rounded-[inherit]">
          <span aria-hidden="true" className={EMPTY_TILE}>
            <CalendarIcon className="size-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block truncate">{rows.length === 1 ? t('presentations.undatedOne') : t('presentations.undatedMany', { n: rows.length })}</span>
            <span className="block text-xs text-stone-400 dark:text-stone-500 truncate">{rows.map((p) => p.name).join(', ')}</span>
          </span>
          <Chevron className="size-4 shrink-0 -mr-1 text-stone-400 dark:text-stone-600" />
        </AppButton>
      </li>
      {open && rows.map((p) => <PresentationRow key={p.id} p={p} today={today} live={p.id === liveId} />)}
    </ul>
  );
}
