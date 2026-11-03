import type { ReactNode, SelectHTMLAttributes } from 'react';
import { AppButton } from './AppButton.tsx';
import { ChevronDownIcon, ChevronRightIcon } from './icons.tsx';
import { CARD } from './List.tsx';
import { SWITCH } from './Toggle.tsx';

// A page of settings as iOS's Settings and macOS's System Settings lay one out (Lars, 2026-11-02): groups of rows, a
// small grey caption over each card, hairlines between its rows, what the group does in grey under it, and no box
// around a single choice.

/** A row of a group: its name at the left, its value or control at the right. */
export const GROUP_ROW = 'flex items-center justify-between gap-3 px-4 min-h-11 py-2 text-sm';

/** An action as a row of a group, in sky, as iOS's ("Rensa cache", "Skapa inbjudningslänk"). */
export const ACTION_ROW = `${GROUP_ROW} w-full text-left text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06] disabled:text-stone-400 dark:disabled:text-stone-500 disabled:cursor-default disabled:hover:bg-transparent`;

/** A destructive action as a group of its own, red and centred, as iOS's "Radera …". */
export const DANGER_ROW = `${GROUP_ROW} w-full justify-center text-red-600 dark:text-red-400 cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06]`;

/** A group's small grey caption, over its card. */
export const CAPTION = 'px-4 text-sm/5 font-semibold text-stone-500 dark:text-stone-400';

/** An action under a group, in sky text with its icon, no box of its own ("Lägg till del", "Ladda upp fil"). */
export const TEXT_ACTION =
  'self-start flex items-center gap-1.5 px-4 min-h-11 text-sm text-sky-600 dark:text-sky-400 cursor-pointer hover:underline disabled:text-stone-400 dark:disabled:text-stone-500 disabled:cursor-default disabled:no-underline';

export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      {title && <h2 className={CAPTION}>{title}</h2>}
      <div className={`${CARD} flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator`}>{children}</div>
      {footer && <div className="px-4 text-xs text-stone-500 dark:text-stone-400">{footer}</div>}
    </section>
  );
}

/** A pop-up menu as macOS's at the end of a row: the chosen value in a pill, ▾ after it. */
export function PopUp({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative shrink-0">
      <select
        {...rest}
        className="appearance-none h-9 pl-4 pr-8 rounded-full tabular-nums bg-raised dark:bg-raised-2 text-stone-900 dark:text-stone-100 cursor-pointer disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {children}
      </select>
      <ChevronDownIcon className="size-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
    </span>
  );
}

/** A row that opens something, a sheet by `onClick` or a page by `href`: its name, what it holds in grey, and ›. */
export function OpeningRow({ label, value, onClick, href, testId }: { label: string; value?: string; onClick?: () => void; href?: string; testId?: string }) {
  return (
    <AppButton
      variant="plain"
      {...(href ? { href } : { onClick })}
      data-testid={testId}
      className={`${GROUP_ROW} w-full text-left no-underline text-inherit cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06]`}
    >
      <span className="shrink-0">{label}</span>
      <span className="flex-1 min-w-0 flex items-center justify-end gap-2 text-stone-500 dark:text-stone-400">
        {value && <span className="truncate tabular-nums">{value}</span>}
        <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
      </span>
    </AppButton>
  );
}

/** A setting that is on or off: a row of its group, with what it does in grey under its name. */
export function SwitchRow({ title, description, checked, disabled, onChange }: { title: string; description?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`${GROUP_ROW} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
      <span>
        <span className="block">{title}</span>
        {description && <span className="block text-xs text-stone-500 dark:text-stone-400 mt-0.5">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className={SWITCH} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
