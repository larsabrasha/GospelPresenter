import { useState } from 'react';
import type { Slide } from '@gp/core';
import { t, type TextKey } from '../../i18n.ts';
import { ChoiceRow } from './EditorChrome.tsx';
import { SAMPLES } from '../theme-editor/themeModel.ts';

// What an overlay is edited over (docs/custom-slides.md, Lars 2026-11-26): a song's slide or a Bible text's, in the
// organisation's theme, so where it lies on what it will cover is seen while it is placed; or nothing, a checkerboard,
// so its own see-through ground is not taken for black. Kept in this browser only; it changes nothing in the overlay.

export type Behind = 'song' | 'bible' | 'none';

const CHOICES: [Behind, TextKey][] = [
  ['song', 'slideEditor.overSong'],
  ['bible', 'slideEditor.overBible'],
  ['none', 'slideEditor.overNone'],
];

const KEY = 'overlayBehind';

function stored(): Behind {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'bible' || v === 'none' ? v : 'song';
  } catch {
    return 'song';
  }
}

export function useBehind(): [Behind, (b: Behind) => void] {
  const [behind, setBehind] = useState<Behind>(stored);
  const choose = (b: Behind) => {
    setBehind(b);
    try {
      localStorage.setItem(KEY, b);
    } catch {
      // Kept for this visit only.
    }
  };
  return [behind, choose];
}

/** The slide drawn under the overlay: a sample of its kind, or none (the checkerboard). */
export const behindSlide = (b: Behind): Slide | null => (b === 'none' ? null : SAMPLES[b]);

/** Exempelslide, as a segmented control under the page (Lars, 2026-11-26). */
export function BehindPicker({ value, onChange, className }: { value: Behind; onChange: (b: Behind) => void; className?: string }) {
  return <ChoiceRow label={t('slideEditor.showOver')} value={value} choices={CHOICES} onChange={onChange} className={className} />;
}
