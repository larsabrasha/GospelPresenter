import type { AnchorHTMLAttributes, ButtonHTMLAttributes, LabelHTMLAttributes } from 'react';
import { SpinnerIcon } from './icons.tsx';

/**
 * The button styles of the current app (Components/AppButton.razor, ButtonVariant.cs).
 * `plain` has none, for a button that draws itself, such as a menu choice.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'neutral' | 'cancel' | 'danger' | 'icon' | 'dangerIcon' | 'pill' | 'pillActive' | 'plain';

const PILL = 'whitespace-nowrap text-sm px-4 py-2.5 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-default';
const TAB = 'flex-1 shrink-0 flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm cursor-pointer transition-all whitespace-nowrap';

/** The classes of a variant, for an element that is not an AppButton but should look like one. */
export function buttonClasses(variant: ButtonVariant = 'primary', filled = false): string {
  switch (variant) {
    case 'primary':
      return `${PILL} bg-sky-500 text-white hover:bg-sky-600`;
    case 'secondary':
      return `${PILL} text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50`;
    case 'neutral':
      return `${PILL} text-neutral-600 dark:text-neutral-400 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600`;
    case 'cancel':
      return `${PILL} text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-600`;
    case 'danger':
      return filled
        ? `${PILL} bg-red-500 text-white hover:bg-red-600`
        : `${PILL} text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60`;
    case 'icon':
      return 'size-8 flex items-center justify-center rounded-full cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300';
    case 'dangerIcon':
      return 'size-8 flex items-center justify-center rounded-full cursor-pointer text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 disabled:opacity-50 disabled:cursor-default';
    case 'pillActive':
      return `${TAB} bg-white dark:bg-neutral-600 dark:text-white shadow font-medium`;
    case 'pill':
      return `${TAB} hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-500 dark:text-neutral-400`;
    case 'plain':
      return '';
  }
}

interface Common {
  variant?: ButtonVariant;
  /** For `danger`: the filled red button of a confirmation. */
  filled?: boolean;
}

type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined; asLabel?: false; loading?: boolean };
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
