// The slides group of wave 3 (ADR 0008, docs/core-back-to-typescript.md): an item's slides, a passage's preview and the
// Bible tab's reads, presenting's keys and marks, a theme, and a search hit's marking, as the Rust core answered them.
import { bibleSlidesView, bibleView, verseSearchPlanView } from './slides-bible.ts';
import { highlightView } from './slides-highlight.ts';
import { itemSlidesView } from './slides-items.ts';
import { presentingKeyView, slideMarksView } from './slides-presenting.ts';
import type { PureView, View } from './sql.ts';
import { themeView } from './slides-themes.ts';

export const slidesViews: Record<string, View> = { itemSlidesView, bibleView, themeView };
export const slidesPureViews: Record<string, PureView> = { bibleSlidesView, verseSearchPlanView, presentingKeyView, slideMarksView, highlightView };
