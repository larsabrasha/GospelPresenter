import { useState } from 'react';
import type { SlidesTarget } from '../db/protocol.ts';
import { useDb } from '../db/react.tsx';
import { t, type TextKey } from '../i18n.ts';
import { renderPdf, SlidesRefused, type SlidesProblem } from './slides.ts';

const refusedText: Record<SlidesProblem | 'other', TextKey> = {
  powerpoint: 'slides.powerPoint',
  type: 'slides.onlyPdf',
  size: 'slides.tooLarge',
  name: 'slides.nameTooLong',
  pages: 'slides.tooManyPages',
  invalid: 'slides.failed',
  other: 'slides.failed',
};

/** A PDF rendered here and kept as a deck (`SlidesTarget`): whether one is under way, and why the last was refused. */
export function useDeckImport() {
  const db = useDb();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (file: File | undefined, target: SlidesTarget): Promise<boolean> => {
    if (!file || importing) return false;
    setError(null);
    setImporting(true);
    try {
      await db.addSlides(await renderPdf(file, target));
      return true;
    } catch (e) {
      if (!(e instanceof SlidesRefused)) console.error('slide import failed', e);
      setError(t(refusedText[e instanceof SlidesRefused ? e.problem : 'other']));
      return false;
    } finally {
      setImporting(false);
    }
  };
  return { importing, error, run };
}
