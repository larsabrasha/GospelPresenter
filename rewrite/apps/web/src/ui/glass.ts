// The round glass of the 2.0 layout's floating buttons (docs/layout-2-0.md), as iOS 27 draws them.

/** A surface floating on the page: the bar's round buttons, the arrows and Rensa under the picture. */
export const GLASS = 'bg-white/70 dark:bg-surface/60 backdrop-blur-md shadow-[inset_0_0.5px_0_rgba(255,255,255,0.22),0_8px_28px_rgba(0,0,0,0.25)]';

/** Glass tinted with the app's colour, as iOS 27 draws a floating "new": seen at once, quieter than a filled button. */
export const TINTED_GLASS = 'bg-sky-100/80 dark:bg-sky-950/70 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/30 backdrop-blur-md shadow-[0_8px_28px_rgba(2,132,199,0.25)]';
