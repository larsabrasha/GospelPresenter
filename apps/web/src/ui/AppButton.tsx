import type { AnchorHTMLAttributes, ButtonHTMLAttributes, LabelHTMLAttributes, Ref } from 'react';
import { SpinnerIcon } from './icons.tsx';
import { RED_TINT, SKY_TINT } from './glass.ts';

/**
 * The button styles of the current app (Components/AppButton.razor, ButtonVariant.cs).
 * `plain` has none, for a button that draws itself, such as a menu choice.
 */
type ButtonVariant = 'primary' | 'secondary' | 'neutral' | 'cancel' | 'danger' | 'icon' | 'dangerIcon' | 'pill' | 'pillActive' | 'plain';

// One height for every button and chosen row: 36 px, 44 by touch (Lars, 2026-11-02).
const PILL = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm h-9 touch:h-11 px-4 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-default';
const TAB = 'flex-1 shrink-0 flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm cursor-pointer transition-all whitespace-nowrap';

/** The classes of a variant, for an element that is not an AppButton but should look like one. */
function buttonClasses(variant: ButtonVariant = 'primary', filled = false): string {
  switch (variant) {
    case 'primary':
      return `${PILL} bg-sky-500 text-white hover:bg-sky-600`;
    case 'secondary':
      return `${PILL} ${SKY_TINT}`;
    case 'neutral':
      return `${PILL} text-stone-700 dark:text-stone-300 bg-raised hover:bg-raised-2`;
    case 'cancel':
      return `${PILL} text-stone-500 dark:text-stone-400 hover:bg-raised-2`;
    case 'danger':
      return filled
        ? `${PILL} bg-red-500 text-white hover:bg-red-600`
        : `${PILL} ${RED_TINT}`;
    case 'icon':
      return 'size-8 flex items-center justify-center rounded-full cursor-pointer hover:bg-raised-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300';
    case 'dangerIcon':
      return 'size-8 flex items-center justify-center rounded-full cursor-pointer text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 disabled:opacity-50 disabled:cursor-default';
    case 'pillActive':
      return `${TAB} bg-white dark:bg-raised-2 dark:text-white shadow font-medium`;
    case 'pill':
      return `${TAB} hover:bg-raised-2 text-stone-500 dark:text-stone-400`;
    case 'plain':
      return '';
  }
}

interface Common {
  variant?: ButtonVariant;
  /** For `danger`: the filled red button of a confirmation. */
  filled?: boolean;
}

type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined; asLabel?: false; loading?: boolean; ref?: Ref<HTMLButtonElement> };
type AsLink = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; asLabel?: false };
/** A label that looks like a button, e.g. around a hidden file input. */
type AsLabel = Common & LabelHTMLAttributes<HTMLLabelElement> & { href?: undefined; asLabel: true; disabled?: boolean };

/**
 * The app's button, and the only place a <button> is made (ADR 0007,
 * decision 11; the lint rule refuses one anywhere else): a link with `href`,
 * a label with `asLabel`, otherwise a button (type "button" unless given).
 * `loading` disables it and shows a spinner.
 */
export function AppButton(props: AsButton | AsLink | AsLabel) {
  if (props.href !== undefined) {
    const { variant, filled, className, ...rest } = props;
    return <a {...rest} className={join(buttonClasses(variant, filled), 'no-underline', className)} />;
  }
  if (props.asLabel) {
    const { variant, filled, className, asLabel: _, disabled, ...rest } = props;
    return <label {...rest} className={join(buttonClasses(variant, filled), disabled && 'opacity-50 cursor-default! pointer-events-none', className)} />;
  }
  const { variant, filled, className, loading, disabled, children, type = 'button', asLabel: _, ...rest } = props;
  return (
    <button {...rest} type={type} disabled={disabled || loading} className={join(buttonClasses(variant, filled), loading && 'inline-flex items-center gap-2', className)}>
      {loading && <SpinnerIcon className="size-4" />}
      {children}
    </button>
  );
}

function join(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
