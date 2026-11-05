import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { blankPage } from '@gp/core';
import { listCustomSlides } from '../../db/customSlides.ts';
import { defaultTheme } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { useDeckImport } from '../../media/deckImport.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { DropZone } from '../../ui/DropZone.tsx';
import { ArrowDownTrayIcon, PlusIcon, PresentationChartOutlineIcon } from '../../ui/icons.tsx';
import { matches } from '../../ui/ListSearch.tsx';
import { AddFooter, isAddKey, SearchField, useFocusWhenShown } from '../../ui/Picker.tsx';
import { navigate } from '../../ui/router.ts';
import { ctrlLabel } from '../../ui/shortcuts.ts';
import { useToast } from '../../ui/Toast.tsx';
import { FirstPage } from '../custom-slides/CustomSlides.tsx';
import { useView, ViewPicker, type View } from '../../ui/ViewPicker.tsx';
import type { TabProps } from './AddItemDialog.tsx';

const PDF = 'application/pdf,.pdf';
const SLIDES_LIST: Record<View, string> = {
  list: 'flex flex-col gap-1 p-1',
  grid: 'grid grid-cols-2 sm:grid-cols-3 gap-3 p-1',
  large: 'flex flex-col gap-4 max-w-xl mx-auto w-full p-1',
};

/** Saving as PDF, in one line and the menus behind a link, for whoever does not know them (Lars, 2026-11-04). */
function PdfHelp() {
  const [howPdf, setHowPdf] = useState(false);
  return (
    <div className="text-xs text-stone-400 dark:text-stone-500 text-center max-w-xs leading-relaxed space-y-2">
      <p>{t('slides.help')}</p>
      {howPdf ? (
        <p className="whitespace-pre-line">{t('slides.howPdfSteps')}</p>
      ) : (
        <AppButton variant="plain" className="text-sky-600 dark:text-sky-400 hover:underline cursor-pointer" onClick={() => setHowPdf(true)}>
          {t('slides.howPdf')} ›
        </AppButton>
      )}
    </div>
  );
}

/**
 * Lägg till's Bildspel (docs/custom-slides.md): the library's slideshows by their first pages, a tap picking or
 * unpicking one, Lägg till putting each picked one in as a reference. Skapa makes a new one, named as the search,
 * puts it in and opens its editor, as Sånger's Skapa does; a PDF, picked or dropped, is rendered here into one
 * picture per page (D29) and goes into the library and the presentation at once. The modal stays open after an
 * add, as for every tab (D15).
 */
export function SlidesTab({ presentationId, afterItemId, onAdded, onClose, active }: TabProps) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const slides = useData(listCustomSlides, []);
  const theme = useData(defaultTheme, []);
  const { importing, error, run } = useDeckImport();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useFocusWhenShown(search, active);
  const [picked, setPicked] = useState<string[]>([]);
  // A list, a grid or large, as in Bildspel (ui/ViewPicker.tsx), this device's choice.
  const [view, setView] = useView('slidesPicker:view', 'grid');
  const busy = useRef(false);
  const shown = slides?.filter((s) => matches(query, s.name)) ?? [];
  const chosen = (slides ?? []).filter((s) => picked.includes(s.id)).toSorted((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id));
  const names = chosen.map((s) => s.name).join(', ');

  /** Each after the one before, in the order they were picked. */
  const addAll = async (ids: string[]) => {
    let after = afterItemId;
    for (const slideId of ids) {
      const itemId = newId();
      if (!(await trySave(db.mutate('addCustomSlideToPresentation', { itemId, presentationId, slideId, afterItemId: after })))) return false;
      after = itemId;
      onAdded(itemId);
    }
    return true;
  };
  const add = async () => {
    if (!chosen.length || busy.current) return;
    busy.current = true;
    try {
      if (await addAll(chosen.map((s) => s.id))) toast(t('presentation.videoAdded', { name: names }));
      setPicked([]);
    } finally {
      busy.current = false;
    }
  };
  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const id = newId();
      if (!(await trySave(db.mutate('createCustomSlide', { id, name: query.trim() || t('customSlides.new'), pages: [blankPage()], at: Date.now() })))) return;
      if (!(await addAll([id]))) return;
      onClose();
      navigate({ page: 'customSlide', id });
    } finally {
      busy.current = false;
    }
  };
  const importFile = async (file: File | undefined) => {
    const itemId = newId();
    if (!(await run(file, { deckId: newId(), into: { itemId, presentationId, afterItemId } }))) return;
    toast(t('presentation.added', { name: file!.name }));
    onAdded(itemId);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!isAddKey(e)) return;
    e.preventDefault();
    void add();
  };

  return (
    <DropZone className="flex-1 min-h-0 flex flex-col" label={t('slides.dropHere')} accept={PDF} multiple={false} enabled={!importing} onFiles={(files) => void importFile(files[0])}>
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="shrink-0 flex flex-wrap items-center gap-3 max-sm:gap-2 pb-4">
          <SearchField className="max-sm:basis-full" inputRef={search} label={t('images.search')} value={query} onChange={setQuery} />
          <ViewPicker value={view} onChange={setView} />
          {/* Skapa and Importera PDF at the search's right, as the pictures' Importera (Lars, 2026-11-05). */}
          <AppButton variant="secondary" className="inline-flex items-center gap-1.5" onClick={() => void create()}>
            <PlusIcon className="size-4" />
            <span className="max-sm:sr-only">{t('common.create')}</span>
          </AppButton>
          <AppButton asLabel variant="secondary" disabled={importing} className="inline-flex items-center gap-1.5">
            <ArrowDownTrayIcon className="size-4 shrink-0" />
            <span className="max-sm:sr-only">{t('slides.import')}</span>
            <input
              type="file"
              accept={PDF}
              hidden
              data-testid="slides-file"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </AppButton>
        </div>
        {importing && (
          <p className="flex items-center gap-2 pb-3 text-sm text-stone-500 dark:text-stone-400" role="status">
            <PresentationChartOutlineIcon className="size-5 text-stone-300 dark:text-stone-600 animate-pulse" />
            {t('slides.importing')}
          </p>
        )}
        {error && (
          <p className="pb-3 text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!slides && <p className="loading-line flex items-center justify-center py-12 text-stone-400 text-sm">{t('common.loading')}</p>}
          {slides && !slides.length && (
            <div className="flex flex-col items-center gap-4 py-10 text-sm text-stone-500 dark:text-stone-400">
              <p>{t('customSlides.empty')}</p>
            </div>
          )}
          <ul className={SLIDES_LIST[view]} aria-label={t('nav.customSlides')}>
            {shown.map((s) => (
              <li key={s.id} className="min-w-0">
                <AppButton
                  variant="plain"
                  role="checkbox"
                  aria-checked={picked.includes(s.id)}
                  aria-label={s.name}
                  className={`w-full rounded-lg cursor-pointer ring-2 ${picked.includes(s.id) ? 'ring-sky-500' : 'ring-transparent'} ${view === 'list' ? 'flex items-center gap-3 p-1 text-left' : ''}`}
                  onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                >
                  {view === 'list' ? (
                    <>
                      <span className="w-20 shrink-0">
                        <FirstPage slide={s} theme={theme} />
                      </span>
                      <span className="text-sm truncate">{s.name}</span>
                    </>
                  ) : (
                    <FirstPage slide={s} theme={theme} />
                  )}
                </AppButton>
                {view !== 'list' && <p className="mt-1 text-xs text-center truncate text-stone-500 dark:text-stone-400">{s.name}</p>}
              </li>
            ))}
          </ul>
          <div className="flex justify-center py-4">
            <PdfHelp />
          </div>
        </div>
        <AddFooter
          hint={t('presentation.addHint', { key: ctrlLabel('Enter') })}
          name={chosen.length ? names : undefined}
          label={chosen.length ? t('presentation.addImage', { name: names }) : undefined}
          onAdd={chosen.length ? () => void add() : undefined}
        />
      </div>
    </DropZone>
  );
}
