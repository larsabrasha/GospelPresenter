// How the 2.0 layout's buttons stand off the page (docs/layout-2-0.md, Lars, 2026-11-02): a shadow only in a bar or a
// toolbar, and on the floating +, never in the content. Lifted (a soft shadow) for a bar's buttons, on a computer and a
// phone alike, and the live picture's; in the content every button is flat: filled for the one that matters, tinted
// for a quiet one in a colour, grey for the rest.

/**
 * A floating "new", as iOS 26 puts it at the bottom right: filled in the app's colour so it is seen (Lars, 2026-11-02),
 * with the shadow of what floats, in its own colour.
 */
export const FLOATING_PRIMARY = 'bg-sky-500 hover:bg-sky-600 text-white shadow-[0_8px_24px_rgba(14,165,233,0.45)]';

/**
 * A bar's button lifted off the page, as iOS 26's bar buttons: white and a soft shadow, no border (Lars, 2026-11-02),
 * lighter than the floating glass's.
 */
const LIFT_SHADOW = 'shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_14px_rgba(0,0,0,0.10)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_14px_rgba(0,0,0,0.35)]';
export const LIFTED = `bg-surface dark:bg-raised ${LIFT_SHADOW} hover:bg-raised dark:hover:bg-raised-2`;

/** A way back, as iOS 27 draws it: a round ‹ alone, lifted. */
export const ROUND_BACK = `size-9 touch:size-11 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 no-underline ${LIFTED}`;

/** Stäng, the round ✕ at a dialog's or a sheet's top right: as the ‹, its mark as clear as the text (Lars, 2026-11-03). */
export const ROUND_CLOSE = `size-9 touch:size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-stone-700 dark:text-stone-200 ${LIFTED}`;

/**
 * A quiet button in a colour, as iOS's and macOS's tinted buttons: a wash of the colour and its words in it, flat, with
 * no shadow (Lars, 2026-11-02: a coloured shadow under a quiet button looked heavy).
 */
export const SKY_TINT = 'text-sky-600 dark:text-sky-300 bg-sky-500/12 dark:bg-sky-400/15 hover:bg-sky-500/18 dark:hover:bg-sky-400/22';
export const RED_TINT = 'text-red-600 dark:text-red-300 bg-red-500/10 dark:bg-red-400/15 hover:bg-red-500/16 dark:hover:bg-red-400/22';

/**
 * A shadow in a filled bar button's own colour, as a coloured tile casts on a light page (Lars, 2026-11-02): it lifts
 * ▶ and ■ as the bar's other buttons without a grey cloud under them.
 */
export const RED_SHADOW = 'shadow-[0_6px_18px_-6px_rgba(239,68,68,0.5)]';
export const GREEN_SHADOW = 'shadow-[0_6px_18px_-6px_rgba(16,185,129,0.55)]';
