import { englishBookName, isOldTestament, MAX_VERSES_PER_ITEM, swedishBookName, type Theme, type Verse } from '@gp/core';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { bibleSlides, verseSearchPlan } from '@gp/core/core';
import { useData, useDataReading, useDb } from '../db/react.tsx';
import { listBibles } from '../db/queries.ts';
import { language, t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { BookOpenIcon, ChevronDownIcon, ChevronLeftIcon } from '../ui/icons.tsx';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../ui/Picker.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { tileClass } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';

/** How many slides the preview draws; a long passage says how many more there are. */
const PREVIEW_SLIDES = 12;

type Step = 'book' | 'startChapter' | 'startVerse' | 'endChapter' | 'endVerse';

interface Browse {
  /** The book's code. */
  book: string;
  step: Step;
  start: [number, number] | null;
  end: [number, number] | null;
  /** The end chapter while its verse is being chosen. */
  endChapter: number | null;
}

/**
 * What the core's bibleView reads of a translation, a stored book at a time: its books' codes, a book's chapters, a
 * chapter's verses (`[chapter, verse, text]`) and a passage's; null when the text cannot be had.
 */
interface BibleRead {
  books: string[];
  chapters?: number[];
  verses?: [number, number, string][];
  passage?: Verse[];
}

/** What a translation's text is read again after: it arriving, or going. */
const TEXT_TABLES = ['bible_texts', 'bible_blobs'];

/** A book's name in the page's language (spec 05: Swedish under sv, else English). */
const bookName = (code: string) => (language() === 'sv' ? swedishBookName(code) : englishBookName(code));
const before = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** A book, chapter or verse to pick (AddItem/Bible/BibleBookPicker.razor and the rest). */
const CELL = 'rounded-lg bg-raised/70 dark:bg-raised/50 hover:bg-raised-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
/** A picked verse: tinted sky (BibleVersePicker.razor). */
const CELL_PICKED = 'rounded-lg bg-sky-500/15 dark:bg-sky-500/20 ring-1 ring-inset ring-sky-500/30 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

/**
 * The book picker, the Old Testament then the New (BIBLE-R10), in canonical order, in a box of its
 * own that scrolls. The arrows run down both columns as one list, Tab stopping once.
 */
function BookPicker({ books, onPick }: { books: string[]; onPick: (code: string) => void }) {
  const groups = [
    { title: t('bible.oldTestament'), books: books.filter((code) => isOldTestament(code)) },
    { title: t('bible.newTestament'), books: books.filter((code) => !isOldTestament(code)) },
  ];
  const list = useRovingList(books.length);
  let index = 0;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" onKeyDown={list.onKeyDown}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mt-4" data-testid="book-picker">
        {groups.map(
          (g) =>
            !!g.books.length && (
              <section key={g.title} className="flex flex-col gap-1">
                <h3 className="text-sm/5 font-semibold text-stone-400 px-3 mb-1 sticky top-0 bg-surface py-2 z-10">{g.title}</h3>
                {g.books.map((code) => (
                  <AppButton key={code} variant="plain" {...list.item(index++)} className={`${CELL} px-3 py-2 text-left`} onClick={() => onPick(code)}>
                    {bookName(code)}
                  </AppButton>
                ))}
              </section>
            ),
        )}
      </div>
    </div>
  );
}

/** The chapters as a grid of numbers; all four arrows move, Tab stopping once (BibleChapterPicker.razor). */
function ChapterPicker({ chapters, label, onPick }: { chapters: number[]; label: string; onPick: (n: number) => void }) {
  const list = useRovingList(chapters.length, 'grid');
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" onKeyDown={list.onKeyDown}>
      <div className="flex flex-wrap gap-1.5 text-sm" role="group" aria-label={label}>
        {chapters.map((n, i) => (
          <AppButton key={n} variant="plain" {...list.item(i)} className={`size-10 flex items-center justify-center ${CELL}`} onClick={() => onPick(n)}>
            {n}
          </AppButton>
        ))}
      </div>
    </div>
  );
}

/** A chapter's verses with their text, the chosen range tinted (BibleVersePicker.razor). */
function VersePicker({ verses, label, picked, onPick }: { verses: [number, number, string][]; label: string; picked: (verse: number) => boolean; onPick: (n: number) => void }) {
  const list = useRovingList(verses.length);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" onKeyDown={list.onKeyDown}>
      <div className="flex flex-col gap-1.5 text-sm" role="group" aria-label={label}>
        {verses.map(([, v, text], i) => (
          <AppButton key={v} variant="plain" {...list.item(i)} aria-pressed={picked(v)} className={`px-3 py-2 text-left ${picked(v) ? CELL_PICKED : CELL}`} onClick={() => onPick(v)}>
            <span className="font-semibold whitespace-nowrap text-sky-500">{v}</span>{' '}
            <span className="ml-1 text-stone-700 dark:text-stone-300">{text}</span>
          </AppButton>
        ))}
      </div>
    </div>
  );
}

/**
 * Choosing a passage by clicking (spec 05 "Bibeltexter", BibleBrowsePicker.razor): the book, a
 * chapter and a verse, then the end chapter and verse. The reference so far stands above, each part
 * a link to pick it again, the part being picked orange, and an orange "_" where the next goes.
 */
function BrowsePicker({
  browse,
  books,
  read,
  setBrowse,
  onBack,
}: {
  browse: Browse;
  books: string[];
  /** The browsed book's chapters and the chapter's verses, once read; undefined while they are. */
  read: BibleRead | undefined;
  setBrowse: (b: Browse) => void;
  onBack: () => void;
}) {
  const { book, step, start, end } = browse;
  const crumb = (label: string, target: Step) => (
    <AppButton
      variant="plain"
      className={`px-2.5 py-1 rounded-full cursor-pointer ${step === target ? 'text-orange-500 dark:text-orange-400 font-medium bg-orange-500/10' : 'text-sky-500 hover:text-sky-600 hover:bg-sky-500/10'}`}
      onClick={() => setBrowse({ ...browse, step: target })}
    >
      {label}
    </AppButton>
  );
  const blank = <span className="text-orange-500 dark:text-orange-400 font-medium bg-orange-500/10 px-2 py-1 rounded-md">_</span>;
  const colon = <span className="text-stone-400">:</span>;
  const prompt = {
    book: t('bible.pickBook'),
    startChapter: t('bible.pickStartChapter'),
    startVerse: t('bible.pickStartVerse'),
    endChapter: t('bible.pickEndChapter'),
    endVerse: t('bible.pickEndVerse'),
  }[step];

  const pickChapter = (n: number) => {
    if (step === 'startChapter') setBrowse({ ...browse, start: [n, 0], end: null, endChapter: null, step: 'startVerse' });
    else setBrowse({ ...browse, endChapter: n, end: null, step: 'endVerse' });
  };
  const pickVerse = (n: number) => {
    // The end chapter starts as the start's; the end is then picked in it.
    if (step === 'startVerse') return setBrowse({ ...browse, start: [start![0], n], end: null, endChapter: start![0], step: 'endVerse' });
    // An end before the start swaps them.
    const picked: [number, number] = [browse.endChapter!, n];
    if (start && before(picked, start)) setBrowse({ ...browse, start: picked, end: start, endChapter: start[0] });
    else setBrowse({ ...browse, end: picked });
  };
  // Whether a verse of `chapter` is in the chosen range: the start alone until there is an end.
  const pickedIn = (chapter: number) => (v: number) => {
    if (!start || start[1] === 0) return false;
    if (!end) return chapter === start[0] && v === start[1];
    const p: [number, number] = [chapter, v];
    return !before(p, start) && !before(end, p);
  };
  const verseChapter = verseChapterOf(browse);
  const hasStartVerse = !!start && start[1] > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="browse">
      <div className="shrink-0">
        <AppButton
          variant="plain"
          aria-label={t('common.back')}
          title={t('common.back')}
          onClick={onBack}
          className="mb-2 -ml-1 cursor-pointer p-2.5 bg-surface text-stone-700 dark:text-stone-200 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
        >
          <ChevronLeftIcon className="size-5" />
        </AppButton>
        <div className="flex items-center gap-x-0.5 ml-1">
          {crumb(bookName(book), 'book')}
          {start && (
            <>
              {crumb(String(start[0]), 'startChapter')}
              {colon}
              {hasStartVerse ? (
                <>
                  {crumb(String(start[1]), 'startVerse')}
                  <span className="text-stone-400 mx-0.5">—</span>
                  {browse.endChapter !== null && (
                    <>
                      {crumb(String(browse.endChapter), 'endChapter')}
                      {colon}
                      {end ? crumb(String(end[1]), 'endVerse') : blank}
                    </>
                  )}
                </>
              ) : (
                blank
              )}
            </>
          )}
        </div>
        <p className="text-sm text-orange-500 dark:text-orange-400 mt-3 px-3">{prompt}</p>
      </div>
      <div className="mt-3 flex-1 min-h-0 flex flex-col">
        {step === 'book' && <BookPicker books={books} onPick={(b) => setBrowse({ book: b, step: 'startChapter', start: null, end: null, endChapter: null })} />}
        {(step === 'startChapter' || step === 'endChapter') && read?.chapters && <ChapterPicker key={step} chapters={read.chapters} label={prompt} onPick={pickChapter} />}
        {verseChapter !== null && read?.verses && <VersePicker key={`${step}${verseChapter}`} verses={read.verses} label={prompt} picked={pickedIn(verseChapter)} onPick={pickVerse} />}
      </div>
    </div>
  );
}

/** The chapter whose verses a browse shows, if it shows a chapter's verses. */
const verseChapterOf = (b: Browse) => (b.step === 'startVerse' ? b.start![0] : b.step === 'endVerse' ? b.endChapter : null);

/**
 * What the tab asks the core's bibleView besides the books: a browsed book's chapters, the chapter's verses and the
 * passage chosen (start to end, or the start verse alone); else a search's passage, from the reference planned among
 * the translation's books (BIBLE-R11). Null when it needs nothing more.
 */
function bibleAsk(browse: Browse | null, query: string, books: string[] | null | undefined) {
  if (browse) {
    const chapter = verseChapterOf(browse);
    const picked = browse.start && browse.start[1] > 0;
    return { book: browse.book, ...(chapter !== null && { chapter }), ...(picked && { passage: { books: [browse.book], from: browse.start, to: browse.end ?? browse.start } }) };
  }
  const plan = books && query.trim() ? verseSearchPlan(query, books) : null;
  return plan && { passage: { books: plan.codes, from: plan.from, to: plan.to } };
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
  active,
}: {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
  active: boolean;
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
  const adding = useRef(false);
  useFocusWhenShown(search, active);

  const bible = bibles?.find((b) => b.id === bibleId) ?? bibles?.[0] ?? null;
  const hash = bible?.contentHash;
  // The text's books, then what the browse or the search needs of it, each from the stored books it needs; a
  // translation this device does not keep is fetched by the worker, for this window only (docs/bibles-and-themes.md).
  const books = useDataReading((d) => (hash ? d.view<BibleRead | null>('bibleView', { hash }).then((r) => r?.books ?? null) : Promise.resolve(null)), [hash, bible?.stored], TEXT_TABLES);
  const wanted = bibleAsk(browse, query, books);
  const asked = JSON.stringify([hash, wanted]);
  const answer = useDataReading(
    (d) => (hash && wanted ? d.view<BibleRead | null>('bibleView', { hash, ...wanted }) : Promise.resolve(null)).then((read) => ({ asked, read })),
    [asked, bible?.stored],
    TEXT_TABLES,
  );
  // What was read for what is asked now, undefined while it is read: never the last book's chapters under this one.
  const read = answer?.asked === asked ? (answer.read ?? undefined) : undefined;

  if (!bibles) return null;
  if (!bibles.length || !bible) {
    return (
      <div data-testid="no-bibles">
        <EmptyTab icon={<BookOpenIcon className="size-12 text-stone-300 dark:text-stone-600" />}>
          <p>{t('bible.none')}</p>
          <p className="max-w-xs leading-relaxed">{t('bible.noneText')}</p>
        </EmptyTab>
      </div>
    );
  }

  // A search's verses (none for a query that names no passage); undefined while they are read.
  const found = browse || !query.trim() ? [] : wanted ? read?.passage : [];
  const shown = (found ?? []).slice(0, MAX_VERSES_PER_ITEM);
  const chosen = browse ? (read?.passage ?? []) : shown;
  // The output's own slides and the item's title (`bibleSlidesView`), as adding them freezes them.
  const preview = chosen.length ? bibleSlides(bible.abbreviation, chosen) : null;
  const slides = preview?.slides ?? [];
  const title = preview?.title ?? '';

  const reset = () => {
    setQuery('');
    setBrowse(null);
    search.current?.focus();
  };

  const add = async () => {
    // Once at a time, as SongTab.razor's isAdding: a held key adds one item.
    if (!chosen.length || adding.current) return;
    adding.current = true;
    try {
      await addChosen();
    } finally {
      adding.current = false;
    }
  };
  const addChosen = async () => {
    if (!browse && found && found.length > shown.length) {
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
    toast(t('presentation.added', { name: title }));
    onAdded(itemId);
    reset();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isAddKey(e)) {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
      {dialog}
      {/* Search and the translation give way to the browsing (BibleTextTab.razor). */}
      <div className={browse ? 'hidden' : 'shrink-0 flex gap-2'}>
        <SearchField
          inputRef={search}
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
            className="appearance-none h-full py-2.5 pl-4 pr-8 rounded-full border border-stone-300 dark:border-stone-600 bg-white dark:bg-raised text-stone-900 dark:text-stone-100 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20"
          >
            {bibles.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="size-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
        </div>
      </div>
      <div className="mt-3 flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        <div className="w-full md:w-1/2 min-w-0 md:min-h-0 flex flex-col md:pr-3">
          {books === undefined && <p className="loading-line py-8 text-center text-sm text-stone-400">{t('bible.downloading')}</p>}
          {books === null && <p className="py-8 text-center text-sm text-stone-400">{t('bible.unavailable')}</p>}
          {books && query.trim() && found && !found.length && (
            <div className="text-center text-stone-400 text-sm py-2">
              <p>{t('bible.noHits')}</p>
              <div className="text-xs mt-6">
                <p>{t('bible.tryReference')}</p>
                <p className="mt-1 text-stone-500 dark:text-stone-400">{t('bible.examples')}</p>
              </div>
            </div>
          )}
          {books && !!found?.length && (
            <div className="md:flex-1 md:min-h-0 md:overflow-y-auto">
              <ol className="flex flex-col gap-1.5 text-sm" aria-label={t('bible.results')}>
                {shown.map((v) => (
                  <li key={`${v.b}${v.c}:${v.v}`} className="px-3 py-2 rounded-lg bg-raised/70 dark:bg-raised/50">
                    <span className="text-sky-500 font-semibold whitespace-nowrap">
                      {bookName(v.b)} {v.c}:{v.v}
                    </span>{' '}
                    <span className="text-stone-700 dark:text-stone-300">{v.t}</span>
                  </li>
                ))}
              </ol>
              {found.length > shown.length && <p className="text-center text-stone-400 text-xs py-1">{t('bible.showing', { n: shown.length, total: found.length })}</p>}
            </div>
          )}
          {books && !query.trim() && !browse && <BookPicker books={books} onPick={(book) => setBrowse({ book, step: 'startChapter', start: null, end: null, endChapter: null })} />}
          {books && !query.trim() && browse && <BrowsePicker browse={browse} books={books} read={read} setBrowse={setBrowse} onBack={() => setBrowse(null)} />}
        </div>
        <div className="w-full md:w-1/2 min-w-0 md:min-h-0 md:overflow-y-auto overflow-x-hidden md:pl-3 pt-3 md:pt-0">
          {!slides.length && (
            <div className="flex flex-col items-center justify-center h-full py-8 text-sm text-stone-400 dark:text-stone-500 select-none">
              <BookOpenIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />
              <p>{t('bible.noneSelected')}</p>
            </div>
          )}
          {!!slides.length && (
            <>
              <h3 className="mb-4 px-1 font-semibold text-sm/5">{title}</h3>
              <ol className="flex flex-col gap-2" aria-label={title}>
                {slides.slice(0, PREVIEW_SLIDES).map((s, i) => (
                  <li key={s.key} className={tileClass({ interactive: false })} aria-label={`${title} ${i + 1}`}>
                    <SlideView slide={s} theme={theme} />
                  </li>
                ))}
              </ol>
              {slides.length > PREVIEW_SLIDES && <p className="mt-2 text-center text-xs text-stone-400">{t('bible.moreSlides', { n: slides.length - PREVIEW_SLIDES })}</p>}
            </>
          )}
        </div>
      </div>
      <AddFooter
        name={preview?.label}
        label={preview ? t('presentation.addSong', { name: preview.label }) : undefined}
        onAdd={chosen.length ? () => void add() : undefined}
      />
    </div>
  );
}
