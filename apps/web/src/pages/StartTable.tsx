import type { Presentation } from '@gp/core';
import { useState, type ReactNode } from 'react';
import { useData } from '../db/react.tsx';
import { presentationTable, type TableSort } from '../db/views.ts';
import { locale, t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../ui/Dropdown.tsx';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { href, navigate } from '../ui/router.ts';
import { useStoredChoice } from '../ui/SortMenu.tsx';
import { SWITCH } from '../ui/Toggle.tsx';
import { cellDate, localToday, monthTitle, tileOf } from './dashboard.ts';

// Tabell (Lars, 2026-11-27: as a spreadsheet): a row a presentation and a column a thing about it, the name first and
// kept at the left while the rest scrolls sideways. A click on a column's caption sorts by it, again the other way.
// What is planned and what has no date; Tidigare takes the past in. Which columns show, the order and Tidigare are
// this device's.

// The weekday, date and time are one column, Datum: "fre 27 nov · 11:00"; no Tema; Beskrivning on one line, cut
// short with "…" and whole in its tooltip (Lars, 2026-11-27).
type Column = 'date' | 'location' | 'description' | 'changed';
const COLUMNS: Column[] = ['date', 'location', 'description', 'changed'];
const SORTS: TableSort[] = ['date', 'name', 'location', 'description', 'changed'];
const STORE = 'library:presentations-columns';

const CAPTION: Record<Column | 'name', () => string> = {
  name: () => t('presentation.name'),
  date: () => t('presentation.date'),
  location: () => t('presentation.location'),
  description: () => t('presentation.description'),
  changed: () => t('presentations.columnChanged'),
};

/** A description on one line, its line breaks as spaces. */
const oneLine = (text: string | null) => text?.replace(/\s+/g, ' ').trim() || null;

/** The columns shown, this device's: all at first. */
function useColumns(): [Column[], (c: Column) => void] {
  const [shown, setShown] = useState<Column[]>(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(STORE) ?? 'null') as unknown;
      return Array.isArray(kept) ? COLUMNS.filter((c) => kept.includes(c)) : COLUMNS;
    } catch {
      return COLUMNS;
    }
  });
  const toggle = (c: Column) => {
    const next = shown.includes(c) ? shown.filter((x) => x !== c) : COLUMNS.filter((x) => x === c || shown.includes(x));
    setShown(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // no storage: the columns hold until the page is left
    }
  };
  return [shown, toggle];
}

export function StartTable({ today }: { today: string }) {
  const [sort, setSort] = useStoredChoice('presentations-table-sort', SORTS);
  const [order, setOrder] = useStoredChoice('presentations-table-order', ['asc', 'desc']);
  const [past, setPast] = useStoredChoice('presentations-table-past', ['off', 'on']);
  const [columns, toggle] = useColumns();
  const groups = useData((db) => presentationTable(db, { today, past: past === 'on', sort: sort as TableSort, desc: order === 'desc', locale: locale() }), [today, sort, order, past]);
  const sortBy = (key: TableSort) => {
    if (key === sort) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setOrder('asc');
    }
  };
  const cell = (p: Presentation, c: Column): ReactNode => {
    if (c === 'date') return p.eventDate ? [`${tileOf(p.eventDate).weekday} ${cellDate(p.eventDate, today)}`, p.time].filter(Boolean).join(' · ') : null;
    if (c === 'location') return p.location;
    if (c === 'description') {
      const text = oneLine(p.description);
      return (
        text && (
          <span className="block truncate" title={text}>
            {text}
          </span>
        )
      );
    }
    return typeof p.updatedAt === 'number' ? cellDate(localToday(new Date(p.updatedAt)), today) : null;
  };
  // Every column sorts by its caption.
  const header = (c: Column | 'name') => {
    const on = c === sort;
    const Arrow = order === 'desc' ? ChevronDownIcon : ChevronUpIcon;
    return (
      <th key={c} scope="col" aria-sort={on ? (order === 'desc' ? 'descending' : 'ascending') : undefined} className={`text-left text-xs font-semibold whitespace-nowrap px-3 py-2 border-b border-separator ${c === 'name' ? `${STICKY} bg-surface` : ''}`}>
        <AppButton variant="plain" onClick={() => sortBy(c)} className={`inline-flex items-center gap-1 cursor-pointer ${on ? 'text-sky-600 dark:text-sky-400' : 'text-stone-500 dark:text-stone-400'}`}>
          {CAPTION[c]()}
          {on && <Arrow className="size-3" />}
        </AppButton>
      </th>
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" role="switch" className={SWITCH} checked={past === 'on'} onChange={(e) => setPast(e.target.checked ? 'on' : 'off')} />
          {t('presentations.past')}
        </label>
        <Dropdown
          className="relative"
          menuClassName="min-w-48"
          button={{ className: 'h-11 px-3 rounded-full flex items-center gap-1 text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2' }}
          trigger={
            <>
              {t('presentations.columns')}
              <ChevronDownIcon className="size-4" />
            </>
          }
        >
          {COLUMNS.map((c) => (
            <AppButton key={c} variant="plain" role="menuitemcheckbox" aria-checked={columns.includes(c)} className={MENU_ITEM} onClick={() => toggle(c)}>
              <CheckIcon className={`size-4 ${columns.includes(c) ? '' : 'invisible'}`} />
              {CAPTION[c]()}
            </AppButton>
          ))}
        </Dropdown>
      </div>
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>{(['name', ...columns] as const).map(header)}</tr>
          </thead>
          <tbody>
            {groups?.map((g) => (
              <Group key={String(g.month)} title={g.month === undefined ? null : g.month === null ? t('presentations.undated') : monthTitle(g.month, today)} span={columns.length + 1}>
                {g.rows.map((p) => {
                  const tint = p.eventDate === today ? 'bg-red-50 dark:bg-red-950' : 'bg-surface';
                  return (
                    <tr key={p.id} className="cursor-pointer hover:brightness-95 dark:hover:brightness-125" onClick={() => navigate({ page: 'presentation', id: p.id })}>
                      <td className={`${ROW_CELL} ${STICKY} ${tint}`}>
                        <a href={href({ page: 'presentation', id: p.id })} className="no-underline text-inherit" onClick={(e) => e.stopPropagation()}>
                          {p.name}
                        </a>
                      </td>
                      {columns.map((c) => {
                        const v = cell(p, c);
                        return (
                          // Beskrivning takes the room the others leave, at least 10 rem, and is cut there.
                          <td key={c} className={`${ROW_CELL} ${tint} ${c === 'description' ? 'w-full max-w-0 min-w-40' : ''} ${v ?(c === 'date' ? '' : 'text-stone-500 dark:text-stone-400') : 'text-stone-300 dark:text-stone-600'}`}>
                            {v || '–'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Group>
            ))}
          </tbody>
        </table>
        {groups && !groups.length && <p className="px-5 py-4 text-sm text-stone-500 dark:text-stone-400">{t('presentations.nothingPlanned')}</p>}
      </div>
    </div>
  );
}

const ROW_CELL = 'px-3 py-2.5 whitespace-nowrap border-b border-separator';
/** The name's column, kept at the left while the rest scrolls sideways, a line at its right; its ground the row's. */
const STICKY = 'sticky left-0 z-[1] shadow-[1px_0_0_var(--color-separator)]';

/** A month's (or Utan datum's) caption over its rows, the width of the table; none when sorted by another column. */
function Group({ title, span, children }: { title: string | null; span: number; children: ReactNode }) {
  return (
    <>
      {title && (
        <tr>
          <th colSpan={span} scope="colgroup" className="text-left text-xs font-semibold text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-black/30 px-3 py-1.5 border-b border-separator">
            <span className="sticky left-3">{title}</span>
          </th>
        </tr>
      )}
      {children}
    </>
  );
}
