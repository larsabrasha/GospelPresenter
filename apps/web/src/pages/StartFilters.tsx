import { useState, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CalendarIcon, DesktopIcon, SearchIcon, UserIcon, WarningIcon } from '../ui/icons.tsx';
import { SimpleInput } from '../ui/SimpleInput.tsx';

// The start page's filters (docs/planning.md, "One list"; Lars, 2026-11-28): a search, and quick filters that add up:
// Välj dag (a month above the list), Med presentation, Saknar folk and Mina. The quick filters are this device's, as
// the view is; the search is not kept.

export interface StartFlags {
  calendar: boolean;
  presentation: boolean;
  missing: boolean;
  mine: boolean;
}
const NONE: StartFlags = { calendar: false, presentation: false, missing: false, mine: false };
const KEY = 'start-filters';

/** The quick filters, kept on this device; a browser that keeps nothing starts with none. */
export function useStartFlags(): [StartFlags, (f: StartFlags) => void] {
  const [flags, setFlags] = useState<StartFlags>(() => {
    try {
      return { ...NONE, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<StartFlags>) };
    } catch {
      return NONE;
    }
  });
  const set = (f: StartFlags) => {
    setFlags(f);
    try {
      localStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      // storage refused: the filters hold until the page is left
    }
  };
  return [flags, set];
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <AppButton
      variant="plain"
      aria-pressed={on}
      className={`shrink-0 h-8 touch:h-9 px-3.5 rounded-full text-sm inline-flex items-center gap-1.5 cursor-pointer ${on ? 'bg-sky-500 text-white' : 'bg-stone-200/80 dark:bg-raised text-stone-600 dark:text-stone-300 hover:bg-stone-300/70 dark:hover:bg-raised-2'}`}
      onClick={onClick}
    >
      {children}
    </AppButton>
  );
}

export function StartFilters({ flags, onFlags, query, onQuery }: { flags: StartFlags; onFlags: (f: StartFlags) => void; query: string; onQuery: (q: string) => void }) {
  const flip = (k: keyof StartFlags) => onFlags({ ...flags, [k]: !flags[k] });
  // Always shown (Lars, 2026-11-28): four are few enough, and Saknar folk and Mina are worth seeing; a button to show
  // them would cost a tap and hide them from whoever has not found it.
  return (
    // Room under it, so the search and the filters stand apart from the list (Lars, 2026-11-28).
    <div className="flex flex-wrap items-center gap-2 px-2 pb-3">
      <SimpleInput
        type="search"
        icon={<SearchIcon className="size-4" />}
        aria-label={t('start.search')}
        placeholder={t('start.search')}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        className="w-full sm:w-56 bg-stone-200/80! dark:bg-raised!"
      />
      {/* On a phone one row that scrolls sideways, under the search, out to the screen's edges (the page's 12 px and this
          row's 8 px): the chips start in line with the search and run to the edge, with room after the last. */}
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] max-sm:-mx-5 max-sm:w-[calc(100%+2.5rem)] max-sm:pl-5 max-sm:after:content-[''] max-sm:after:w-3 max-sm:after:shrink-0">
        {/* Each with its icon, so the row reads as one set of filters (Lars, 2026-11-28). */}
        <Chip on={flags.calendar} onClick={() => flip('calendar')}>
          <CalendarIcon className="size-4" />
          {t('start.pickDay')}
        </Chip>
        <Chip on={flags.presentation} onClick={() => flip('presentation')}>
          <DesktopIcon className="size-4" />
          {t('start.withPresentation')}
        </Chip>
        <Chip on={flags.missing} onClick={() => flip('missing')}>
          <WarningIcon className="size-4" />
          {t('start.missing')}
        </Chip>
        <Chip on={flags.mine} onClick={() => flip('mine')}>
          <UserIcon className="size-4" />
          {t('start.mine')}
        </Chip>
      </div>
    </div>
  );
}
