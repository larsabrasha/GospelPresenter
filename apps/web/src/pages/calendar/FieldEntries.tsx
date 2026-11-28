import { entryText, EVENT_LIMITS, type FieldEntry } from '@gp/core';
import { useId, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { withMaxChars } from '../../ui/maxChars.ts';
import { CloseIcon } from '../../ui/icons.tsx';
import { href } from '../../ui/router.ts';
import type { Person } from './data.ts';

// What is in a field of an event (docs/planning.md, "Fields"): its names as chips, a member as a link to them and
// anything else as text, and a field to type the next one in, offering the members first and then what was written
// before in fields of this name. Enter or a comma adds what is typed; Backspace in an empty field takes the last back.

const CHIP = 'inline-flex items-center gap-0.5 max-w-full rounded-full pl-2.5 pr-1 py-0.5 text-sm';

type Offer = { kind: 'person'; person: Person } | { kind: 'text'; text: string };

/** The offers for `query`: members whose name has it, then texts written before, none already in the field. */
function offersFor(query: string, people: Person[], texts: string[], entries: FieldEntry[]): Offer[] {
  const q = query.trim().toLocaleLowerCase('sv');
  if (!q) return [];
  const taken = new Set(entries.map((e) => ('person' in e ? `p:${e.person}` : `t:${e.text}`)));
  const persons = people.filter((p) => p.name.toLocaleLowerCase('sv').includes(q) && !taken.has(`p:${p.id}`)).slice(0, 5);
  const words = texts.filter((x) => x.toLocaleLowerCase('sv').includes(q) && !taken.has(`t:${x}`) && !persons.some((p) => p.name === x)).slice(0, 5);
  return [...persons.map((person) => ({ kind: 'person' as const, person })), ...words.map((text) => ({ kind: 'text' as const, text }))];
}

export function FieldEntries({
  label,
  entries,
  people,
  texts,
  onChange,
  compact,
}: {
  /** The field's name, for the input's label and the chips' remove buttons. */
  label: string;
  entries: FieldEntry[];
  people: Person[];
  texts: string[];
  onChange: (entries: FieldEntry[]) => void;
  /** A cell of Tabell: one line, no border. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const listId = useId();
  // Where the offers show in a table's cell: fixed under the input, so the table's scrolling does not cut them off.
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const offers = offersFor(query, people, texts, entries);
  const full = entries.length >= EVENT_LIMITS.entriesPerField;

  const add = (e: FieldEntry) => {
    setQuery('');
    setAt(0);
    if (!full) onChange([...entries, e]);
  };
  const addTyped = () => {
    const text = query.trim().slice(0, EVENT_LIMITS.entry);
    if (text) add({ text });
  };
  const pick = (o: Offer) => add(o.kind === 'person' ? { person: o.person.id, name: o.person.name } : { text: o.text });

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = (by: number) => {
      e.preventDefault();
      setAt((at + by + offers.length) % offers.length);
    };
    if (e.key === 'ArrowDown' && offers.length) move(1);
    else if (e.key === 'ArrowUp' && offers.length) move(-1);
    else if (e.key === 'Enter' || (e.key === ',' && query.trim())) {
      e.preventDefault();
      const o = offers[at];
      if (o && e.key === 'Enter') pick(o);
      else addTyped();
    } else if (e.key === 'Backspace' && !query && entries.length) onChange(entries.slice(0, -1));
    else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    }
  };

  return (
    <div className={`relative flex-1 flex flex-wrap items-center gap-1 min-w-0 ${compact ? 'py-1' : 'py-1.5'}`}>
      {entries.map((e, i) => (
        <span key={i} className={`${CHIP} ${'person' in e ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200' : 'bg-stone-100 dark:bg-white/10'}`}>
          {'person' in e ? (
            <a href={href({ page: 'person', id: e.person })} className="truncate no-underline text-inherit hover:underline">
              {e.name}
            </a>
          ) : (
            <span className="truncate">{e.text}</span>
          )}
          <AppButton
            variant="plain"
            aria-label={t('event.removeEntry', { name: entryText(e) })}
            className="size-5 shrink-0 grid place-items-center rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            <CloseIcon className="size-3.5" />
          </AppButton>
        </span>
      ))}
      {!full && (
        <input
          aria-label={label}
          role="combobox"
          aria-expanded={offers.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          placeholder={entries.length ? '' : t('calendar.missingCell')}
          onChange={withMaxChars(EVENT_LIMITS.entry, (e) => {
            setQuery(e.target.value);
            setAt(0);
            const r = e.target.getBoundingClientRect();
            setBox({ top: r.bottom + 4, left: Math.min(r.left, innerWidth - 272) });
          })}
          onKeyDown={onKey}
          onBlur={addTyped}
          className="flex-1 min-w-24 bg-transparent outline-none py-1 placeholder:text-amber-600/80 dark:placeholder:text-amber-400/70"
        />
      )}
      {/* Under the field, moving with the page (a phone's keyboard moves it); fixed in a table, whose scrolling would cut
          it off, and which a phone does not show. */}
      {offers.length > 0 && (!compact || box) && (
        <ul
          id={listId}
          role="listbox"
          style={compact ? (box ?? undefined) : undefined}
          className={`${compact ? 'fixed z-50' : 'absolute left-0 top-full mt-1 z-30'} w-64 max-w-[80vw] rounded-xl border-[0.5px] border-separator bg-surface shadow-lg py-1`}
        >
          {offers.map((o, i) => (
            <li
              key={o.kind === 'person' ? `p:${o.person.id}` : `t:${o.text}`}
              role="option"
              aria-selected={i === at}
              // Picked on mouse down, before the input's blur adds what was typed.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              className={`px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 ${i === at ? 'bg-stone-100 dark:bg-white/10' : ''}`}
            >
              <span className="flex-1 truncate">{o.kind === 'person' ? o.person.name : o.text}</span>
              <span className="text-xs text-stone-400">{o.kind === 'person' ? t('event.member') : t('event.writtenBefore')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
