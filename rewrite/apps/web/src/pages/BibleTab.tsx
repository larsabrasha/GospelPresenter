import {
  bibleItemSlides,
  bibleLabel,
  bibleTitle,
  isOldTestament,
  MAX_VERSES_PER_ITEM,
  searchVerses,
  splitBibleSlides,
  swedishBookName,
  versesInRange,
  type BibleBookText,
  type Theme,
  type Verse,
} from '@gp/core';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { bibleBooks, listBibles } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { BookOpenIcon, ChevronDownIcon, ChevronLeftIcon } from '../ui/icons.tsx';
import { AddFooter, EmptyTab, SearchField } from '../ui/Picker.tsx';
import { tileClass } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';

/** How many slides the preview draws; a long passage says how many more there are. */
const PREVIEW_SLIDES = 12;

type Step = 'startChapter' | 'startVerse' | 'endChapter' | 'endVerse';

interface Browse {
  book: BibleBookText;
  step: Step;
  start: [number, number] | null;
  end: [number, number] | null;
  /** The end chapter while its verse is being chosen. */
  endChapter: number | null;
}

const chaptersOf = (book: BibleBookText) => [...new Set(book.verses.map(([c]) => c))];
const versesOf = (book: BibleBookText, chapter: number) => book.verses.filter(([c]) => c === chapter).map(([, v]) => v);
const before = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** A book, chapter or verse to pick (AddItem/Bible/BibleBookPicker.razor and the rest). */
const CELL = 'rounded-lg bg-neutral-50 dark:bg-neutral-700/50 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
/** A picked verse: tinted sky (BibleVersePicker.razor). */
const CELL_PICKED = 'rounded-lg bg-sky-500/15 dark:bg-sky-500/20 ring-1 ring-inset ring-sky-500/30 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

/** The book picker, the Old Testament then the New (BIBLE-R10), in canonical order. */
function BookPicker({ books, onPick }: { books: BibleBookText[]; onPick: (b: BibleBookText) => void }) {
  const groups = [
    { title: t('bible.oldTestament'), books: books.filter((b) => isOldTestament(b.code)) },
    { title: t('bible.newTestament'), books: books.filter((b) => !isOldTestament(b.code)) },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm" data-testid="book-picker">
      {groups.map(
        (g) =>
          !!g.books.length && (
            <section key={g.title} className="flex flex-col gap-1">
              <h3 className="text-xs/4 font-semibold text-neutral-400 uppercase tracking-wide px-3 mb-1 sticky top-0 bg-white dark:bg-neutral-800 py-2 z-10">{g.title}</h3>
              {g.books.map((b) => (
                <AppButton key={b.code} variant="plain" className={`${CELL} px-3 py-2 text-left`} onClick={() => onPick(b)}>
                  {swedishBookName(b.code)}
                </AppButton>
              ))}
            </section>
          ),
      )}
    </div>
  );
}

/** Choosing a passage by clicking: chapter, verse, then the end (spec 05 "Bibeltexter"). */
function BrowsePicker({ browse, setBrowse, onBack }: { browse: Browse; setBrowse: (b: Browse) => void; onBack: () => void }) {
  const { book, step, start, end } = browse;
  const name = swedishBookName(book.code);
  // The reference so far, each part a link to pick it again; the part being picked is orange (BibleBrowsePicker.razor).
  const crumb = (label: string, target: Step, current: boolean) => (
    <AppButton
      variant="plain"
      className={`px-2 py-1 rounded-md cursor-pointer ${current ? 'text-orange-500 dark:text-orange-400 font-medium bg-orange-500/10' : 'text-sky-500 hover:text-sky-600 hover:bg-sky-500/10'}`}
      onClick={() => setBrowse({ ...browse, step: target })}
    >
      {label}
    </AppButton>
  );
  const prompt = {
    startChapter: t('bible.pickStartChapter'),
    startVerse: t('bible.pickStartVerse'),
    endChapter: t('bible.pickEndChapter'),
    endVerse: t('bible.pickEndVerse'),
  }[step];
  const pickedChapter = step === 'startVerse' ? (browse.start?.[0] ?? null) : step === 'endVerse' ? browse.endChapter : null;

  const choose = (n: number) => {
    if (step === 'startChapter') setBrowse({ ...browse, start: [n, 0], end: null, endChapter: n, step: 'startVerse' });
    else if (step === 'startVerse') setBrowse({ ...browse, start: [start![0], n], end: null, endChapter: start![0], step: 'endVerse' });
    else if (step === 'endChapter') setBrowse({ ...browse, endChapter: n, end: null, step: 'endVerse' });
    else {
      // An end before the start swaps them.
      const picked: [number, number] = [browse.endChapter!, n];
      if (start && before(picked, start)) setBrowse({ ...browse, start: picked, end: start, step: 'endVerse' });
      else setBrowse({ ...browse, end: picked, step: 'endVerse' });
    }
  };

  const options = pickedChapter === null ? chaptersOf(book) : versesOf(book, pickedChapter);
  return (
    <div data-testid="browse">
      <AppButton
        variant="plain"
        aria-label={t('common.back')}
        title={t('common.back')}
        onClick={onBack}
        className="mb-2 -ml-1 cursor-pointer p-2.5 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
      >
        <ChevronLeftIcon className="size-5" />
      </AppButton>
      <div className="flex flex-wrap items-center gap-x-0.5 ml-1">
        <span className="px-2 py-1 font-medium">{name}</span>
        {start && crumb(String(start[0]), 'startChapter', step === 'startChapter')}
        {start && start[1] > 0 && <span className="text-neutral-400">:</span>}
        {start && start[1] > 0 && crumb(String(start[1]), 'startVerse', step === 'startVerse')}
        {browse.endChapter !== null && start && start[1] > 0 && <span className="text-neutral-400 mx-0.5">—</span>}
        {browse.endChapter !== null && start && start[1] > 0 && crumb(String(browse.endChapter), 'endChapter', step === 'endChapter')}
        {end && <span className="text-neutral-400">:</span>}
        {end && crumb(String(end[1]), 'endVerse', step === 'endVerse')}
      </div>
      <p className="text-sm text-orange-500 dark:text-orange-400 mt-3 mb-3 px-3">{prompt}</p>
      <div className="flex flex-wrap gap-1.5 text-sm" role="group" aria-label={prompt}>
        {options.map((n) => {
          const picked = (step === 'endVerse' && end?.[1] === n && end?.[0] === browse.endChapter) || (step === 'startVerse' && start?.[1] === n);
          return (
            <AppButton key={n} variant="plain" aria-pressed={picked} className={`size-10 flex items-center justify-center ${picked ? CELL_PICKED : CELL}`} onClick={() => choose(n)}>
              {n}
            </AppButton>
          );
        })}
      </div>
    </div>
  );
}

/** The verses a complete browse selection covers (start to end, or the start verse alone). */
function browseVerses(b: Browse | null): Verse[] {
  if (!b?.start || b.start[1] === 0) return [];
  return versesInRange(b.book, b.start, b.end ?? b.start);
}

/**
 * The Bible tab of the add-item modal (spec 05). Search by reference, or
 * browse; add at most the 500 verses shown (BIBLE-R14). Like the song tab,
 * it never closes after an add (D15).
 */
export function BibleTab({
  presentationId,
  afterItemId,
  theme,
  onAdded,
}: {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
}) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const bibles = useData(listBibles, []);
  const [bibleId, setBibleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [browse, setBrowse] = useState<Browse | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const bible = bibles?.find((b) => b.id === bibleId) ?? bibles?.[0] ?? null;
  // A translation this device does not keep is fetched now, for this window only (docs/bibles-and-themes.md, "Bibles").
  const books = useData((d) => (bible ? bibleBooks(d, bible.contentHash, (hash) => db.fetchBibleText(hash)) : Promise.resolve(null)), [bible?.contentHash, bible?.stored]);

  if (!bibles) return null;
  if (!bibles.length || !bible) {
    return (
      <div data-testid="no-bibles">
        <EmptyTab icon={<BookOpenIcon className="size-12 text-neutral-300 dark:text-neutral-600" />}>
          <p>{t('bible.none')}</p>
        </EmptyTab>
      </div>
    );
  }

  const found = books && query.trim() ? searchVerses(query, books) : [];
  const shown = found.slice(0, MAX_VERSES_PER_ITEM);
  const chosen = browse ? browseVerses(browse) : shown;
  const slides = chosen.length ? bibleItemSlides(bibleTitle(chosen), { translation: bible.abbreviation, slides: splitBibleSlides(chosen) }) : [];

  const reset = () => {
    setQuery('');
    setBrowse(null);
    search.current?.focus();
  };

  const add = async () => {
    if (!chosen.length) return;
    if (!browse && found.length > shown.length) {
      // D13: say that only the first 500 go in, and ask.
      const ok = await ask({
        title: t('bible.truncatedTitle'),
        text: t('bible.truncated', { total: found.length, n: shown.length }),
        confirm: t('presentation.add'),
      });
      if (!ok) return;
    }
    const itemId = newId();
    const added = await trySave(
      db.mutate('addBibleToPresentation', {
        itemId,
        presentationId,
        bibleId: bible.id,
        translation: bible.abbreviation,
        verses: chosen.map(({ b, c, v, t: text }) => ({ b, c, v, t: text })),
        afterItemId,
      }),
    );
    if (!added) return;
    toast(t('presentation.added', { name: bibleTitle(chosen) }));
    onAdded(itemId);
    reset();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
      {dialog}
      <div className="shrink-0 flex gap-2">
        <SearchField
          inputRef={search}
          autoFocus
          label={t('bible.search')}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setBrowse(null);
          }}
        />
        <div className="relative shrink-0">
          <select
            aria-label={t('bible.translation')}
            value={bible.id}
            onChange={(e) => {
              setBibleId(e.target.value);
              setBrowse(null);
            }}
            className="appearance-none h-full py-2.5 pl-4 pr-8 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {bibles.map((b) => (
              <option key={b.id} value={b.id}>
                {b.abbreviation}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="size-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        </div>
      </div>
      <div className="mt-3 flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        <div className="w-full md:w-1/2 min-w-0 md:min-h-0 md:overflow-y-auto md:pr-3">
          {books === undefined && <p className="py-8 text-center text-sm text-neutral-400">{t('bible.downloading')}</p>}
          {books === null && <p className="py-8 text-center text-sm text-neutral-400">{t('bible.unavailable')}</p>}
          {books && query.trim() && !found.length && (
            <div className="text-center text-neutral-400 text-sm py-2">
              <p>{t('bible.noHits')}</p>
              <div className="text-xs mt-6">
                <p>{t('bible.tryReference')}</p>
                <p className="mt-1 text-neutral-500 dark:text-neutral-400">{t('bible.examples')}</p>
              </div>
            </div>
          )}
          {books && !!found.length && (
            <>
              <ol className="flex flex-col gap-1.5 text-sm" aria-label={t('bible.results')}>
                {shown.map((v) => (
                  <li key={`${v.b}${v.c}:${v.v}`} className="px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-700/50">
                    <span className="text-sky-500 font-semibold whitespace-nowrap">
                      {swedishBookName(v.b)} {v.c}:{v.v}
                    </span>{' '}
                    <span className="text-neutral-700 dark:text-neutral-300">{v.t}</span>
                  </li>
                ))}
              </ol>
              {found.length > shown.length && <p className="text-center text-neutral-400 text-xs py-1">{t('bible.showing', { n: shown.length, total: found.length })}</p>}
            </>
          )}
          {books && !query.trim() && !browse && <BookPicker books={books} onPick={(book) => setBrowse({ book, step: 'startChapter', start: null, end: null, endChapter: null })} />}
          {books && !query.trim() && browse && <BrowsePicker browse={browse} setBrowse={setBrowse} onBack={() => setBrowse(null)} />}
        </div>
        <div className="w-full md:w-1/2 min-w-0 md:min-h-0 md:overflow-y-auto overflow-x-hidden md:pl-3 pt-3 md:pt-0">
          {!slides.length && (
            <div className="flex flex-col items-center justify-center h-full py-8 text-sm text-neutral-400 dark:text-neutral-500 select-none">
              <BookOpenIcon className="size-12 mb-3 text-neutral-300 dark:text-neutral-600" />
              <p>{t('bible.noneSelected')}</p>
            </div>
          )}
          {!!slides.length && (
            <>
              <h3 className="mb-4 px-1 font-semibold text-sm/5">{bibleTitle(chosen)}</h3>
              <ol className="flex flex-col gap-2" aria-label={bibleTitle(chosen)}>
                {slides.slice(0, PREVIEW_SLIDES).map((s, i) => (
                  <li key={s.key} className={tileClass({ interactive: false })} aria-label={`${bibleTitle(chosen)} ${i + 1}`}>
                    <SlideView slide={s} theme={theme} />
                  </li>
                ))}
              </ol>
              {slides.length > PREVIEW_SLIDES && <p className="mt-2 text-center text-xs text-neutral-400">{t('bible.moreSlides', { n: slides.length - PREVIEW_SLIDES })}</p>}
            </>
          )}
        </div>
      </div>
      <AddFooter
        hint={t('presentation.addHint')}
        name={chosen.length ? bibleLabel(chosen) : undefined}
        label={chosen.length ? t('presentation.addSong', { name: bibleLabel(chosen) }) : undefined}
        onAdd={chosen.length ? () => void add() : undefined}
      />
    </div>
  );
}
