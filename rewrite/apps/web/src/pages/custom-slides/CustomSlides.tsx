import { useRef } from 'react';
import { blankPage, type Theme } from '@gp/core';
import { listCustomSlides, type LibraryCustomSlide } from '../../db/customSlides.ts';
import { defaultTheme } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { useDeckImport } from '../../media/deckImport.ts';
import { AddButton, RoundButton } from '../../ui/AddButton.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { ArrowDownTrayIcon, ArrowsRightLeftIcon, SlideshowIcon } from '../../ui/icons.tsx';
import { Library } from '../../ui/Library.tsx';
import { freshName, markCreated } from '../../ui/justCreated.ts';
import { href, navigate } from '../../ui/router.ts';
import { SlideView } from '../../ui/SlideView.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { trashTexts } from '../Images.tsx';
import { pageSlide } from './PageNavigator.tsx';

/** A slide's first page, small, in the organisation's theme. */
export function FirstPage({ slide, theme }: { slide: LibraryCustomSlide; theme: Theme | undefined }) {
  return (
    <span className="block w-full aspect-video rounded-lg overflow-hidden">
      <SlideView slide={pageSlide(slide.pages[0] ?? blankPage())} theme={theme} label={false} credits={false} />
    </span>
  );
}

const PDF = 'application/pdf,.pdf';

/**
 * Bildspel (docs/custom-slides.md): the organisation's slideshows, made here or imported from a PDF, as a grid of
 * their first pages; a tap opens one's editor, + makes a new one, named first, and opens it, and Importera (or a
 * drop) takes a PDF. A slideshow of a PDF's pages has Ersätt med ny PDF in its menu: after a question, its pages
 * are the new PDF's, what was put on them gone, in every presentation that shows it.
 */
export function CustomSlides() {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const slides = useData(listCustomSlides, []);
  const theme = useData(defaultTheme, []);
  /** + makes "Nytt bildspel" at once with one blank page, and opens it with its name picked (Lars, 2026-11-04). */
  const create = async () => {
    const id = newId();
    const name = freshName(t('customSlides.new'), (slides ?? []).map((s) => s.name));
    if (await trySave(db.mutate('createCustomSlide', { id, name, pages: [blankPage()], at: Date.now() }))) {
      markCreated(id);
      navigate({ page: 'customSlide', id });
    }
  };
  const { importing, error, run } = useDeckImport();
  const picker = useRef<HTMLInputElement>(null);
  /** What the next picked PDF is for: a new slideshow, or the pages of this one. */
  const replacing = useRef<LibraryCustomSlide | null>(null);
  const byName = (a: LibraryCustomSlide, b: LibraryCustomSlide) => a.name.localeCompare(b.name, 'sv', { numeric: true });
  const pick = (slide: LibraryCustomSlide | null) => {
    replacing.current = slide;
    picker.current?.click();
  };
  const picked = async (file: File | undefined) => {
    const slide = replacing.current;
    if (!slide) await run(file, { deckId: newId(), into: 'library' });
    else if (await run(file, { deckId: slide.id, into: 'replace' })) toast(t('slideDecks.replaced', { name: slide.name }));
  };
  const replace = async (slide: LibraryCustomSlide) => {
    if (await ask({ title: t('slideDecks.replace'), text: t('slideDecks.replaceAsk', { name: slide.name }), bold: slide.name, confirm: t('slideDecks.replaceConfirm') })) pick(slide);
  };

  return (
    <>
      {dialog}
      <input ref={picker} type="file" accept={PDF} hidden data-testid="slide-deck-file" onChange={(e) => (void picked(e.target.files?.[0]), (e.target.value = ''))} />
      <Library
        title={t('nav.customSlides')}
        items={slides}
        layout="grid"
        renderTile={(s) => <FirstPage slide={s} theme={theme} />}
        open={(s) => href({ page: 'customSlide', id: s.id })}
        sorts={[
          { key: 'changed', label: t('library.sort.changed'), compare: (a, b) => b.updatedAt - a.updatedAt || byName(a, b) },
          { key: 'newest', label: t('library.sort.newest'), compare: (a, b) => b.createdAt - a.createdAt || byName(a, b) },
          { key: 'name', label: t('library.sort.name'), compare: byName },
        ]}
        manage
        renderActions={(s, row) =>
          s.pages.some((page) => page.backgroundPage) && (
            <AppButton variant="plain" role="menuitem" className={row} onClick={() => void replace(s)}>
              <ArrowsRightLeftIcon className="size-4" />
              {t('slideDecks.replace')}
            </AppButton>
          )
        }
        rename={{ title: t('library.renameTitle'), label: t('song.name'), maxLength: 200, run: (s, name) => db.mutate('updateCustomSlide', { id: s.id, name, at: Date.now() }) }}
        remove={{ ...trashTexts('customSlides.trashed'), run: (s) => db.mutate('trashCustomSlide', { id: s.id, at: Date.now() }) }}
        add={
          <>
            <RoundButton text={t('slides.importShort')} title={t('slides.import')} icon={<ArrowDownTrayIcon className="size-5" />} disabled={importing} onClick={() => pick(null)} />
            <AddButton label={t('customSlides.new')} onClick={() => void create()} />
          </>
        }
        drop={{ label: t('slides.dropHere'), accept: PDF, multiple: false, onFiles: (files) => void run(files[0], { deckId: newId(), into: 'library' }) }}
        notices={
          <>
            {(importing || error) && (
              <p className={`px-5 text-sm ${error ? 'text-red-500 dark:text-red-400' : 'text-stone-500 dark:text-stone-400'}`} role={error ? 'alert' : 'status'}>
                {error ?? t('slides.importing')}
              </p>
            )}
          </>
        }
        loading={t('common.loading')}
        empty={{ icon: <SlideshowIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('customSlides.empty'),
          text: t('customSlides.emptyText'),
          action: (
            <>
              <AppButton onClick={() => void create()}>{t('customSlides.emptyNew')}</AppButton>
              <AppButton variant="secondary" disabled={importing} onClick={() => pick(null)}>
                {t('slides.import')}
              </AppButton>
            </>
          ),
        }}
        noMatch={t('customSlides.noMatch')}
        count={(n) => t(n === 1 ? 'customSlides.count.one' : 'customSlides.count.many', { n })}
        testId="custom-slide"
      />
    </>
  );
}
