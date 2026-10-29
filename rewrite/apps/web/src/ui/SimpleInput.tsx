import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { CalendarIcon, ChevronDownIcon, ClockIcon } from './icons.tsx';

/**
 * A small grey pill of a field, with an icon beside it: a calendar for a date,
 * a clock for a time (Components/SimpleInput.razor). The icon is a sibling,
 * not laid over the field: WebKit ignores padding on date and time inputs.
 */
export function SimpleInput({ icon, className, type = 'text', ...rest }: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  const shown = icon ?? (type === 'date' ? <CalendarIcon className="size-4" /> : type === 'time' ? <ClockIcon className="size-4" /> : null);
  return (
    <div
      className={`flex items-center gap-1.5 h-9 rounded-full bg-neutral-100 dark:bg-neutral-700 text-sm focus-within:ring-2 focus-within:ring-sky-500 ${shown ? 'pl-3 pr-4' : 'px-4'} ${className ?? ''}`}
    >
      {shown && <span className="flex items-center shrink-0 pointer-events-none text-neutral-400 dark:text-neutral-500">{shown}</span>}
      <input
        {...rest}
        type={type}
        className={`min-w-0 bg-transparent dark:scheme-dark text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none${type === 'date' || type === 'time' ? ' native-picker-hidden' : ''}`}
      />
    </div>
  );
}

/** The same pill as a select (Components/SimpleSelect.razor). */
export function SimpleSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <select
        {...rest}
        className="appearance-none h-9 pl-4 pr-8 rounded-full bg-neutral-100 dark:bg-neutral-700 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {children}
      </select>
      <ChevronDownIcon className="size-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
    </div>
  );
}
