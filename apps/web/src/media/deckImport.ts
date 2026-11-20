import { useState } from 'react';
import type { SlidesTarget } from '../db/protocol.ts';
import { useDb } from '../db/react.tsx';
import { t, type TextKey } from '../i18n.ts';
import { renderDeck, SlidesRefused, type SlidesProblem } from './slides.ts';

const refusedText: Record<SlidesProblem | 'other', TextKey> = {
  powerpoint: 'slides.powerPoint',
  oldPowerpoint: 'slides.oldPowerPoint',
  type: 'slides.onlyPdf',
  size: 'slides.tooLarge',
  name: 'slides.nameTooLong',
  pages: 'slides.tooManyPages',
  invalid: 'slides.failed',
  other: 'slides.failed',
};

/**
 * A PDF rendered here, or a PowerPoint deck drawn by the host, kept as a deck (`SlidesTarget`): whether one is under
 * way, why the last was refused, and what to know of one kept (a chart, which may not look as in PowerPoint).
 */
export function useDeckImport() {
  const db = useDb();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (file: File | undefined, target: SlidesTarget): Promise<boolean> => {
    if (!file || importing) return false;
    setError(null);
    setNotice(null);
    setImporting(true);
    try {
      const { slides, charts } = await renderDeck(file, target);
      await db.addSlides(slides);
      if (charts) setNotice(t('slides.charts'));
      return true;
    } catch (e) {
      if (!(e instanceof SlidesRefused)) console.error('slide import failed', e);
      setError(t(refusedText[e instanceof SlidesRefused ? e.problem : 'other']));
      return false;
    } finally {
      setImporting(false);
    }
  };
  return { importing, error, notice, run };
}
