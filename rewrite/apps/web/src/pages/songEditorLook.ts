// The song editor's look (Components/SongEditor.razor), shared by its parts and its arrangements.

/** The light card each block sits in. */
export const CARD = 'bg-surface dark:text-stone-100 rounded-xl border-[0.5px] border-separator';

/** A label's coloured pill; grey when the part has none. */
export const PILL = 'rounded-full px-2.5 py-0.5 text-xs font-semibold text-white whitespace-nowrap';

/** The label of the part a new song starts with, one of the default labels (packages/core/src/labels.ts). */
export const FIRST_PART_LABEL = 'Verse 1';
