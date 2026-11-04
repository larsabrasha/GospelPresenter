import { useRef } from 'react';
import { listSlideDecks, type LibrarySlideDeck } from '../db/slideDecks.ts';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { useDeckImport } from '../media/deckImport.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ArrowsRightLeftIcon, RectangleStackIcon } from '../ui/icons.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { Library } from '../ui/Library.tsx';
import { useToast } from '../ui/Toast.tsx';
import { trashTexts } from './Images.tsx';

const PDF = 'application/pdf,.pdf';

/** A deck's first page, small, with how many pages it has. */
export function DeckTile({ deck }: { deck: LibrarySlideDeck }) {
  const url = useBlobUrl(deck.pages[0]?.thumb ?? null);
  return (
    <span className="relative block w-full aspect-video rounded-lg overflow-hidden bg-black">
      {url && <img src={url} alt="" draggable={false} className="size-full object-contain" />}
      <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 text-[11px]/4 text-white">{t('slideDecks.pages', { n: deck.pages.length })}</span>
    </span>
  );
}

/**
 * PowerPoint (docs/media-and-files.md "Slide decks"): the organisation's slide decks, PDFs whose pages were rendered
 * at import, as a grid of their first pages. + imports a PDF; a deck's menu replaces its pages with a new PDF's,
 * which every presentation that shows it then shows. A tap looks at its first page.
 */
export function SlideDecks() {
  const db = useDb();
  const toast = useToast();
  const decks = useData(listSlideDecks, []);
  const { importing, error, run } = useDeckImport();
  const picker = useRef<HTMLInputElement>(null);
  const replacing = useRef<LibrarySlideDeck | null>(null);
  const byName = (a: LibrarySlideDeck, b: LibrarySlideDeck) => a.name.localeCompare(b.name, 'sv', { numeric: true });
  const replace = async (file: File | undefined) => {
    const deck = replacing.current;
    if (deck && (await run(file, { deckId: deck.id, into: 'replace' }))) toast(t('slideDecks.replaced', { name: deck.name }));
  };

  return (
    <>
      <input ref={picker} type="file" accept={PDF} hidden data-testid="slide-deck-replace" onChange={(e) => (void replace(e.target.files?.[0]), (e.target.value = ''))} />
      <Library
        title={t('nav.slideDecks')}
        items={decks}
        layout="grid"
        renderTile={(d) => <DeckTile deck={d} />}
        preview={(d) => ({ kind: 'image', full: d.pages[0]?.full ?? '', thumb: d.pages[0]?.thumb ?? '' })}
        sorts={[
          { key: 'changed', label: t('library.sort.changed'), compare: (a, b) => b.updatedAt - a.updatedAt || byName(a, b) },
          { key: 'newest', label: t('library.sort.newest'), compare: (a, b) => b.createdAt - a.createdAt || byName(a, b) },
          { key: 'name', label: t('library.sort.name'), compare: byName },
        ]}
        manage
        renderActions={(d, row) => (
          <AppButton
            variant="plain"
            role="menuitem"
            className={row}
            onClick={() => {
              replacing.current = d;
              picker.current?.click();
            }}
          >
            <ArrowsRightLeftIcon className="size-4" />
            {t('slideDecks.replace')}
          </AppButton>
        )}
        rename={{ title: t('library.renameTitle'), label: t('library.fileName'), maxLength: 200, run: (d, name) => db.mutate('updateSlideDeck', { id: d.id, name, at: Date.now() }) }}
        remove={{ ...trashTexts('slideDecks.trashed'), run: (d) => db.mutate('trashSlideDeck', { id: d.id, at: Date.now() }) }}
        add={<ImportFilesButton round accept={PDF} busy={importing} testId="slide-deck-file" onFiles={(files) => void run(files[0], { deckId: newId(), into: 'library' })} />}
        notices={
          (importing || error) && (
            <p className={`px-5 text-sm ${error ? 'text-red-500 dark:text-red-400' : 'text-stone-500 dark:text-stone-400'}`} role={error ? 'alert' : 'status'}>
              {error ?? t('slides.importing')}
            </p>
          )
        }
        loading={t('common.loading')}
        empty={{ icon: <RectangleStackIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('slideDecks.empty') }}
        noMatch={t('slideDecks.noMatch')}
        count={(n) => t(n === 1 ? 'slideDecks.count.one' : 'slideDecks.count.many', { n })}
        drop={{ label: t('slides.dropHere'), accept: PDF, multiple: false, onFiles: (files) => void run(files[0], { deckId: newId(), into: 'library' }) }}
        testId="slide-deck"
      />
    </>
  );
}
