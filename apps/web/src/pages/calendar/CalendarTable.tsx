import { useDataReading, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { CARD } from '../../ui/List.tsx';
import { loadingText } from '../../ui/playful.ts';
import { href } from '../../ui/router.ts';
import { cellDate, fullDate, tileOf } from '../dashboard.ts';
import { calendarTable, CALENDAR_READS, eventSuggestions, usePeople, type Scope, type TableData } from './data.ts';
import { PresentationButton } from './EventList.tsx';
import { FieldEntries } from './FieldEntries.tsx';

// Tabell (docs/planning.md): the sheet the church had, a row per event and a column per task. The date and time stay
// in view as it scrolls sideways; a cell is edited where it is, and one the event has no field for is grey, a click
// adding it. A cell with nothing in it says "saknas".

const TH = 'text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 px-2 py-2 whitespace-nowrap bg-surface';
const TD = 'border-t-[0.5px] border-separator align-middle';

export function CalendarTable({ scope, keep, today, emptyText }: { scope: Scope; keep: (row: TableData['rows'][number]) => boolean; today: string; emptyText: string }) {
  const db = useDb();
  const trySave = useTrySave();
  const people = usePeople();
  const all = useDataReading((d) => calendarTable(d, scope), [JSON.stringify(scope)], CALENDAR_READS);
  // The rows the filters let through, and the columns those rows have.
  const rows = all?.rows.filter(keep);
  const data = all && rows ? { columns: all.columns.filter((c) => rows.some((r) => r.cells[c])), rows } : undefined;
  const suggestions = useDataReading(eventSuggestions, [], ['events', 'event_fields']);
  if (!data) return <div className={CARD}><div className="loading-line px-4 py-3 text-stone-400">{loadingText()}</div></div>;
  if (!data.rows.length) return <p className="px-5 text-sm text-stone-400">{emptyText}</p>;
  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full text-sm border-collapse" style={{ minWidth: `${28 + data.columns.length * 10}rem` }}>
        <thead>
          <tr>
            <th className={`${TH} sticky left-0 z-10`}>{t('calendar.column.when')}</th>
            <th className={TH}>{t('calendar.column.title')}</th>
            <th className={TH}>{t('calendar.column.screen')}</th>
            {data.columns.map((c) => (
              <th key={c} className={TH}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((e) => {
            const tile = e.date ? tileOf(e.date) : null;
            return (
              <tr key={e.id}>
                <td className={`${TD} sticky left-0 z-10 bg-surface`}>
                  <a href={href({ page: 'event', id: e.id })} title={e.date ? fullDate(e.date) : undefined} className="block px-2 py-2 whitespace-nowrap tabular-nums no-underline text-inherit hover:text-sky-600">
                    <span className="text-[11px] font-semibold uppercase text-stone-500 dark:text-stone-400 mr-1">{tile?.weekday}</span>
                    {e.date ? cellDate(e.date, today) : ''}
                    <span className="text-stone-400"> · {e.time ?? t('event.allDay')}</span>
                  </a>
                </td>
                <td className={TD}>
                  <a href={href({ page: 'event', id: e.id })} className="block px-2 py-2 font-medium no-underline text-inherit hover:text-sky-600 min-w-40">
                    {e.title || <span className="text-stone-400 font-normal">{t('calendar.untitled')}</span>}
                  </a>
                </td>
                <td className={`${TD} text-center px-1`}>
                  <PresentationButton e={e} />
                </td>
                {data.columns.map((c) => {
                  const cell = e.cells[c];
                  return (
                    <td key={c} className={`${TD} px-2 min-w-40 ${cell ? '' : 'bg-stone-100/70 dark:bg-white/[0.03]'}`}>
                      {cell ? (
                        <FieldEntries compact label={`${c}, ${e.title || t('calendar.untitled')}`} entries={cell.entries} people={people} texts={suggestions?.texts[c] ?? []} onChange={(entries) => void trySave(db.mutate('updateEventField', { id: cell.id, entries }))} />
                      ) : (
                        <AppButton
                          variant="plain"
                          aria-label={t('calendar.addFieldHere', { name: c, title: e.title || t('calendar.untitled') })}
                          className="w-full h-8 grid place-items-center text-stone-300 hover:text-sky-600 dark:text-stone-600 cursor-pointer"
                          onClick={() => void trySave(db.mutate('addEventField', { id: newId(), eventId: e.id, name: c }))}
                        >
                          <PlusIcon className="size-3.5" />
                        </AppButton>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
