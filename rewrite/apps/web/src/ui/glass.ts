// The round glass of the 2.0 layout's floating buttons (docs/layout-2-0.md), as iOS 27 draws them.

/** A surface floating on the page: the bar's round buttons, the arrows and Rensa under the picture. */
export const GLASS = 'bg-white/70 dark:bg-surface/60 backdrop-blur-md shadow-[inset_0_0.5px_0_rgba(255,255,255,0.22),0_8px_28px_rgba(0,0,0,0.25)]';

/** Glass tinted with the app's colour, as iOS 27 draws a floating "new": seen at once, quieter than a filled button. */
export const TINTED_GLASS = 'bg-sky-100/80 dark:bg-sky-950/70 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/30 backdrop-blur-md shadow-[0_8px_28px_rgba(2,132,199,0.25)]';

/**
 * A button lifted off the page, as macOS's push buttons and iOS 26's controls: white and a soft shadow, no border
 * (Lars, 2026-11-02), smaller than the floating glass's so a form with many buttons stays light.
 */
export const LIFTED =
  'bg-surface dark:bg-raised shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_14px_rgba(0,0,0,0.10)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_14px_rgba(0,0,0,0.35)] hover:bg-raised dark:hover:bg-raised-2';

/** A way back, as iOS 27 draws it: a round ‹ alone, lifted. */
export const ROUND_BACK = `size-9 touch:size-11 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 no-underline ${LIFTED}`;

/**
 * A shadow in a button's own colour, as a coloured tile casts on a light page (Lars, 2026-11-02): it lifts the button
 * without a grey cloud under it.
 */
export const SKY_SHADOW = 'shadow-[0_6px_18px_-6px_rgba(14,165,233,0.55)]';
export const RED_SHADOW = 'shadow-[0_6px_18px_-6px_rgba(239,68,68,0.5)]';
export const GREEN_SHADOW = 'shadow-[0_6px_18px_-6px_rgba(16,185,129,0.55)]';
