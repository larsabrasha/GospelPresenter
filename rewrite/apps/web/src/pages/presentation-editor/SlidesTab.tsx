import { useState } from 'react';
import { useDb } from '../../db/react.tsx';
import { t, type TextKey } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { renderPdf, SlidesRefused, type SlidesProblem } from '../../media/slides.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { DropHint, DropZone } from '../../ui/DropZone.tsx';
import { ArrowDownTrayIcon, PresentationChartOutlineIcon } from '../../ui/icons.tsx';
import { useToast } from '../../ui/Toast.tsx';
import type { TabProps } from './AddItemDialog.tsx';

const refusedText: Record<SlidesProblem | 'other', TextKey> = {
  powerpoint: 'slides.powerPoint',
  type: 'slides.onlyPdf',
  size: 'slides.tooLarge',
  name: 'slides.nameTooLong',
  pages: 'slides.tooManyPages',
  invalid: 'slides.failed',
  other: 'slides.failed',
};

/**
 * The add-item modal's PowerPoint tab (AddItem/Slides/SlidesTab.razor): a
 * PDF, picked or dropped, rendered here into one picture per page (D29). The
 * modal stays open after the add, as for every tab (D15).
 */
export function SlidesTab({ presentationId, afterItemId, onAdded }: TabProps) {
  const db = useDb();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFile = async (file: File | undefined) => {
    if (!file || importing) return;
    setError(null);
    setImporting(true);
    try {
      const itemId = newId();
      await db.addSlides(await renderPdf(file, { itemId, presentationId, afterItemId }));
      toast(t('presentation.added', { name: file.name }));
      onAdded(itemId);
    } catch (e) {
      if (!(e instanceof SlidesRefused)) console.error('slide import failed', e);
      setError(t(refusedText[e instanceof SlidesRefused ? e.problem : 'other']));
    } finally {
      setImporting(false);
    }
  };

  return (
    <DropZone className="flex flex-col items-center justify-center h-full gap-6 px-4 py-8" label={t('slides.dropHere')} enabled={!importing} onFiles={(files) => void importFile(files[0])}>
      {importing ? (
        <div className="flex flex-col items-center gap-3 text-neutral-500 dark:text-neutral-400" role="status">
          <PresentationChartOutlineIcon className="size-12 text-neutral-300 dark:text-neutral-600 animate-pulse" />
          <span className="text-sm font-medium">{t('slides.importing')}</span>
        </div>
      ) : (
        <>
          <AppButton asLabel filled className="inline-flex items-center gap-2">
            <ArrowDownTrayIcon className="size-5 shrink-0" />
            {t('slides.import')}
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              data-testid="slides-file"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </AppButton>
          <DropHint text={t('slides.dropAffordance')} className="hidden sm:block -mt-4" />
          {error && (
            <p className="text-sm text-red-500 dark:text-red-400 text-center max-w-xs" role="alert">
              {error}
            </p>
          )}
          <div className="text-xs text-neutral-400 dark:text-neutral-500 text-center max-w-xs leading-relaxed space-y-3">
            <p>{t('slides.help1')}</p>
            <p>{t('slides.help2')}</p>
            <p>{t('slides.help3')}</p>
          </div>
        </>
      )}
    </DropZone>
  );
}
