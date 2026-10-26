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
import { Button } from '../ui/Button.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
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

/** The book picker, the Old Testament then the New (BIBLE-R10), in canonical order. */
function BookPicker({ books, onPick }: { books: BibleBookText[]; onPick: (b: BibleBookText) => void }) {
  const groups = [
    { title: t('bible.oldTestament'), books: books.filter((b) => isOldTestament(b.code)) },
    { title: t('bible.newTestament'), books: books.filter((b) => !isOldTestament(b.code)) },
  ];
  return (
    <div data-testid="book-picker">
      {groups.map(
        (g) =>
          !!g.books.length && (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <div className="book-grid">
                {g.books.map((b) => (
                  <Button key={b.code} className="book-button" onClick={() => onPick(b)}>
                    {swedishBookName(b.code)}
                  </Button>
                ))}
              </div>
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
  const crumb = (label: string, target: Step, current: boolean) => (
    <Button className={current ? 'crumb current' : 'crumb'} onClick={() => setBrowse({ ...browse, step: target })}>
      {label}
    </Button>
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
      <div className="row crumbs">
        <Button onClick={onBack}>{t('common.back')}</Button>
        <strong>{name}</strong>
        {start && crumb(String(start[0]), 'startChapter', step === 'startChapter')}
        {start && start[1] > 0 && <span>:</span>}
        {start && start[1] > 0 && crumb(String(start[1]), 'startVerse', step === 'startVerse')}
        {browse.endChapter !== null && start && start[1] > 0 && <span>—</span>}
        {browse.endChapter !== null && start && start[1] > 0 && crumb(String(browse.endChapter), 'endChapter', step === 'endChapter')}
        {end && <span>:</span>}
        {end && crumb(String(end[1]), 'endVerse', step === 'endVerse')}
      </div>
      <p className="muted">{prompt}</p>
      <div className="number-grid" role="group" aria-label={prompt}>
        {options.map((n) => (
          <Button
            key={n}
            aria-pressed={(step === 'endVerse' && end?.[1] === n && end?.[0] === browse.endChapter) || (step === 'startVerse' && start?.[1] === n)}
            onClick={() => choose(n)}
          >
            {n}
          </Button>
        ))}
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
  onClose,
}: {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
  onClose: () => void;
}) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const bibles = useData(listBibles, []);
  const [bibleId, setBibleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [browse, setBrowse] = useState<Browse | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const bible = bibles?.find((b) => b.id === bibleId) ?? bibles?.[0] ?? null;
  const books = useData((d) => (bible ? bibleBooks(d, bible.contentHash) : Promise.resolve(null)), [bible?.contentHash, bible?.stored]);

  if (!bibles) return null;
  if (!bibles.length || !bible) {
    return (
      <div className="empty" data-testid="no-bibles">
        <p className="muted">{t('bible.none')}</p>
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
    await db.mutate('addBibleToPresentation', {
      itemId,
      presentationId,
      bibleId: bible.id,
      translation: bible.abbreviation,
      verses: chosen.map(({ b, c, v, t: text }) => ({ b, c, v, t: text })),
      afterItemId,
    });
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
    <>
      {dialog}
      <div className="picker" onKeyDown={onKeyDown}>
        <div className="picker-list">
          <div className="row">
            <input
              ref={search}
              autoFocus
              className="grow"
              type="search"
              maxLength={100}
              aria-label={t('bible.search')}
              placeholder={t('bible.search')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setBrowse(null);
              }}
            />
            {query && (
              <Button aria-label={t('common.clear')} onClick={() => setQuery('')}>
                ×
              </Button>
            )}
            <select
              aria-label={t('bible.translation')}
              value={bible.id}
              onChange={(e) => {
                setBibleId(e.target.value);
                setBrowse(null);
              }}
            >
              {bibles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.abbreviation}
                </option>
              ))}
            </select>
          </div>
          {!books && <p className="muted">{t('bible.downloading')}</p>}
          {books && query.trim() && !found.length && (
            <div className="empty">
              <p className="muted">{t('bible.noHits')}</p>
              <p className="muted small">
                {t('bible.tryReference')} {t('bible.examples')}
              </p>
            </div>
          )}
          {books && !!found.length && (
            <>
              {found.length > shown.length && <p className="muted small">{t('bible.showing', { n: shown.length, total: found.length })}</p>}
              <ol className="list verses" aria-label={t('bible.results')}>
                {shown.map((v) => (
                  <li key={`${v.b}${v.c}:${v.v}`}>
                    <strong>
                      {swedishBookName(v.b)} {v.c}:{v.v}
                    </strong>{' '}
                    {v.t}
                  </li>
                ))}
              </ol>
            </>
          )}
          {books && !query.trim() && !browse && <BookPicker books={books} onPick={(book) => setBrowse({ book, step: 'startChapter', start: null, end: null, endChapter: null })} />}
          {books && !query.trim() && browse && <BrowsePicker browse={browse} setBrowse={setBrowse} onBack={() => setBrowse(null)} />}
        </div>
        <div className="picker-preview">
          {!slides.length && <p className="muted">{t('bible.noneSelected')}</p>}
          {!!slides.length && (
            <>
              <h3>{bibleTitle(chosen)}</h3>
              <ol className="thumbs grid" aria-label={bibleTitle(chosen)}>
                {slides.slice(0, PREVIEW_SLIDES).map((s, i) => (
                  <li key={s.key} className="thumb" aria-label={`${bibleTitle(chosen)} ${i + 1}`}>
                    <SlideView slide={s} theme={theme} />
                  </li>
                ))}
              </ol>
              {slides.length > PREVIEW_SLIDES && <p className="muted small">{t('bible.moreSlides', { n: slides.length - PREVIEW_SLIDES })}</p>}
            </>
          )}
        </div>
      </div>
      <p className="muted small">{t('presentation.addHint')}</p>
      <div className="row end">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {!!chosen.length && (
          <Button variant="primary" onClick={() => void add()}>
            {t('presentation.addSong', { name: bibleLabel(chosen) })}
          </Button>
        )}
      </div>
    </>
  );
}
